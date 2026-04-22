import { env } from "../lib/config-env.js";
import { FdCustomerType, FdPayoutFrequency, Prisma } from "../prisma/generated/prisma/client.js";
import { chunkArray, logMemoryUsage, map_mf_asset_type } from "../lib/utils.js";
import { v4 as uuidv4 } from 'uuid';
import cuid from 'cuid';
import axios from "axios";
import logger from "../middleware/logger.js";
import { db } from "../server.js";
import pLimit from "p-limit";
import { MfNavHistoryCreateManyInput } from "../prisma/generated/prisma/models.js";


class JobServiceClass {

    daily_mf_product_job = async () => {

        logMemoryUsage("START OF JOB");

        const api_res = await axios.get(`${env.FINNSYS_MASTER_URL}`, {
            params: {
                gwname: "NSE",
                ...(env.ENVIRONMENT === "dev" && { tot: 5 })
            }
        }).then(res => res.data);

        const api_data: any[] = api_res.result ?? [];
        if (api_data.length === 0) return logger.info("No data received.");


        const batches = chunkArray(api_data, 1000);

        try {
            // --- START OF GLOBAL TRANSACTION ---
            // Everything inside this block is "All-or-Nothing"
            await db.$transaction(async (tx) => {

                for (const batch of batches) {


                    // -> Prepare MF Product Values
                    const product_values = batch.map((mf: any) => {
                        const navDate = mf.NAV_DATE ? new Date(mf.NAV_DATE) : new Date();
                        const normalizedAssetType = map_mf_asset_type(mf.ASSET_TYPE_ID, mf.ASSET_TYPE);
                        return Prisma.sql`(
                        ${uuidv4()}, ${String(mf.SCHM_ID)}, ${mf.ISIN}, ${mf.MAPPING_CODE}, ${mf.NSE_SCHEME_CODE}, ${mf.PLATFORM_SCHEME_CODE}, ${mf.SCHEME_NAME},
                        ${mf.AMC_ID ? String(mf.AMC_ID) : null}, ${mf.AMC_CODE}, ${mf.AMC_NAME}, 
                        ${normalizedAssetType}, ${mf.SCHEME_TYPE}, ${mf.STRUCTURE}, ${mf.RISK_NAME}, 
                        ${mf.RISK_ID ? parseInt(mf.RISK_ID) : null}, ${mf.NAV ? parseFloat(mf.NAV) : null},
                        ${navDate}, ${mf.PURCHASE_ALLOWED === "Y"}, ${mf.SIP_ALLOWED === "Y"}, 
                        ${mf.REDEMPTION_ALLOWED === "Y"}, ${mf.SWITCH_ALLOWED === "Y"}, NOW()
                    )`;
                    });

                    // -> Execute Bulk Upsert for Products with RETURNING to get actual IDs back
                    // Why raw sql? Because prisma don't support upsertMany and we want to do this in 1 query for 30k records
                    // RETURNING gives us the real id for both new inserts AND conflict-updated rows — no extra findMany needed
                    const products: { id: string, scheme_id: string, isin: string | null, nse_scheme_code: string | null, mapping_code: string | null }[] = await tx.$queryRaw`
                    INSERT INTO "MfProduct" (
                        id, scheme_id, isin, mapping_code, nse_scheme_code, platform_code, scheme_name, 
                        amc_id, amc_code, amc_name, asset_type, scheme_type, 
                        structure, risk_name, risk_level, latest_nav, 
                        latest_nav_date, purchase_allowed, sip_allowed, 
                        redemption_allowed, switch_allowed, "updatedAt"
                    )
                    VALUES ${Prisma.join(product_values)}
                    ON CONFLICT (scheme_id, isin, nse_scheme_code) DO UPDATE SET
                        latest_nav = EXCLUDED.latest_nav,
                        latest_nav_date = EXCLUDED.latest_nav_date,
                        purchase_allowed = EXCLUDED.purchase_allowed,
                        sip_allowed = EXCLUDED.sip_allowed,
                        redemption_allowed = EXCLUDED.redemption_allowed,
                        switch_allowed = EXCLUDED.switch_allowed,
                        "updatedAt" = NOW()
                    RETURNING id, scheme_id, isin, nse_scheme_code, mapping_code;
                `;

                    logger.info(`Batch of ${batch.length} products upserted successfully.`);

                    // -> Create a Map for O(1) access to product IDs (built directly from RETURNING result)
                    const productMap = new Map(products.map(p => [
                        `${p.scheme_id}-${p.isin}-${p.nse_scheme_code}`.toUpperCase(),
                        p.id
                    ]));
                    logger.debug(`Product Map created with ${productMap.size} entries.`);

                    // -> Prepare & Execute Metrics and Rules Bulk Upsert

                    const metricsValues: Prisma.Sql[] = [];
                    const ruleValues: Prisma.Sql[] = [];


                    for (const mf of batch) {
                        const tripleKey = `${mf.SCHM_ID}-${mf.ISIN}-${mf.NSE_SCHEME_CODE}`.toUpperCase();
                        const pId = productMap.get(tripleKey);
                        if (!pId) continue;

                        // Metrics Data
                        metricsValues.push(Prisma.sql`(
                        ${uuidv4()}, ${pId}, 
                        ${mf.THIRTY_DAY_RETURN ? parseFloat(mf.THIRTY_DAY_RETURN) : null}, 
                        ${mf.NINTY_DAY_RETURN ? parseFloat(mf.NINTY_DAY_RETURN) : null}, 
                        ${mf.ONE_YEAR_RETURN ? parseFloat(mf.ONE_YEAR_RETURN) : null}, 
                        ${mf.CHANGE ? parseFloat(mf.CHANGE) : null}, NOW())`);

                        // Transaction Rules Data
                        const sipDates = mf.SIP_DATES ? mf.SIP_DATES.split(",").map(Number) : [];
                        const freq = mf.SYSTEMATIC_FREQUENCIES ? mf.SYSTEMATIC_FREQUENCIES.split(",") : [];
                        ruleValues.push(Prisma.sql`(${uuidv4()}, ${pId}, ${sipDates}, ${freq}, NOW())`);
                    }



                    if (metricsValues.length > 0) {
                        await tx.$executeRaw`
                        INSERT INTO "MfMetrics" (id, mf_product_id, return_30d, return_90d, return_1y, nav_change_pct, "updatedAt")
                        VALUES ${Prisma.join(metricsValues)}
                        ON CONFLICT (mf_product_id) DO UPDATE SET
                            return_30d = EXCLUDED.return_30d,
                            return_90d = EXCLUDED.return_90d,
                            return_1y = EXCLUDED.return_1y,
                            nav_change_pct = EXCLUDED.nav_change_pct,
                            "updatedAt" = NOW();
                    `;
                    }
                    logger.info(`Batch of Mf Metrics ${metricsValues.length} metrics upserted successfully.`);

                    if (ruleValues.length > 0) {
                        await tx.$executeRaw`
                        INSERT INTO "MfSchemeTransactionRules" (id, mf_product_id, sip_allowed_dates, sip_frequencies, "updatedAt")
                        VALUES ${Prisma.join(ruleValues)}
                        ON CONFLICT (mf_product_id) DO UPDATE SET
                            sip_allowed_dates = EXCLUDED.sip_allowed_dates,
                            sip_frequencies = EXCLUDED.sip_frequencies,
                            "updatedAt" = NOW();
                    `;
                    }
                    logger.info(`Batch of mf rules : ${ruleValues.length} rules upserted successfully.`);

                    // -> Append today's NAV to history (prevents need for heavy full-history job in production)
                    const navHistoryValues: Prisma.Sql[] = [];

                    for (const mf of batch) {
                        const tripleKey = `${mf.SCHM_ID}-${mf.ISIN}-${mf.NSE_SCHEME_CODE}`.toUpperCase();
                        const pId = productMap.get(tripleKey);
                        if (!pId || !mf.NAV) continue;

                        const navDate = mf.NAV_DATE ? new Date(mf.NAV_DATE) : new Date();
                        navHistoryValues.push(Prisma.sql`(
                            ${cuid()}, ${pId}, ${String(mf.MAPPING_CODE)},
                            ${parseFloat(mf.NAV)}, ${navDate}, NOW()
                        )`);
                    }

                    if (navHistoryValues.length > 0) {
                        await tx.$executeRaw`
                            INSERT INTO "MfNavHistory" (id, mf_product_id, scheme_id, nav, nav_date, "updatedAt")
                            VALUES ${Prisma.join(navHistoryValues)}
                            ON CONFLICT (mf_product_id, nav_date) DO NOTHING;
                        `;
                    }
                    logger.info(`Batch: ${navHistoryValues.length} NAV history points appended.`);

                }
            }, {
                timeout: 60000, // Increase timeout to 60s for 30k records
                maxWait: 10000
            });

            logger.info(`Daily MF Sync: ${api_data.length} synchronized atomically.`);
            return true;

        } catch (error) {
            logger.error("FATAL: Mutual Fund Job failed. Database rolled back to previous state.", error);
            throw error;
        } finally {
            logMemoryUsage("END OF JOB"); // Check if memory cleared or leaked
        }
    }




    daily_fd_job = async (token: string) => {
        try {

            const api_res = env.ENVIRONMENT === "dev"
                ? await axios.get(`${env.BLOSTEM_MASTER_URL}/binvestt/portal/fixed-deposit/templates`, {
                    headers: { 'x-partner-token': token },
                    timeout: 15000
                }).then(res => res.data)
                : await axios.get(`https://binvestt-api.blostem.com/portal/fixed-deposit/templates`, {
                    headers: { 'x-partner-token': token },
                    timeout: 15000
                }).then(res => res.data)

            const api_data: any[] = api_res.data?.data ?? [];

            // 1. Frequency Mapper to handle API typos like "ANNUALY"
            const frequencyMap: Record<string, FdPayoutFrequency> = {
                'ANNUALY': 'YEARLY',
                'ANNUALLY': 'YEARLY',
                'YEARLY': 'YEARLY',
                'MONTHLY': 'MONTHLY',
                'QUARTERLY': 'QUARTERLY',
                'HALF_YEARLY': 'HALF_YEARLY',
                'HALFYEARLY': 'HALF_YEARLY',
                'CUMULATIVE': 'CUMULATIVE',
                'ON_MATURITY': 'ON_MATURITY'
            };

            const batches = chunkArray(api_data, 25);
            let totalSynced = 0;

            for (const batch of batches) {
                try {
                    await db.$transaction(async (tx) => {
                        // --- STEP A: UPSERT ISSUERS ---
                        const issuerValues = batch.map(fd => {
                            const desc = (fd.aboutIssuer?.about?.description || '').toLowerCase();
                            const issuer_type = desc.includes('nbfc') ? 'NBFC' : 'BANK';
                            const rating_text = fd.tags?.map((t: any) => t.text).join(', ') || '';

                            return Prisma.sql`(
                            ${fd.issuerId}, 
                            ${fd.organization?.fullName || fd.displayName}, 
                            ${fd.displayName}, 
                            ${issuer_type}, 
                            ${fd.organization?.logo || ''}, 
                            ${fd.aboutIssuer?.banner || ''}, 
                            ${rating_text}, 
                            ${fd.aboutIssuer?.customerServed || ''}, 
                            'Not provided',
                            ${fd.aboutIssuer?.about?.description || ''}, 
                            '', '', NOW()
                        )`;
                        });

                        await tx.$executeRaw`
                        INSERT INTO "FdIssuer" (id, full_name, display_name, issuer_type, logo_url, banner_url, rating_text, customer_served, operating_since, about_description, support_email, support_phone, "updatedAt")
                        VALUES ${Prisma.join(issuerValues)}
                        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, "updatedAt" = NOW();
                    `;

                        // --- STEP B: UPSERT PRODUCTS ---
                        const productValues = batch.map(fd => Prisma.sql`(
                        ${fd.id}, ${fd.issuerId}, ${fd.type}, 
                        ${parseFloat(fd.minimumDeposit || 0)}, ${parseFloat(fd.maximumDeposit || 0)},
                        ${parseInt(fd.minimumTenure || 0)}, ${parseInt(fd.maximumTenure || 0)},
                        ${fd.aboutIssuer?.lockInDetails?.period || 0}, ${fd.aboutIssuer?.lockInDetails?.message || ''}, 
                        1.0, ${!!fd.aboutIssuer?.vkyc}, ${parseFloat(fd.aboutIssuer?.vkyc?.minAmountForVkyc || 0)},
                        ${JSON.stringify(fd.aboutIssuer?.invest?.content || [])}::jsonb,
                        ${JSON.stringify(fd.aboutIssuer?.questions?.content || [])}::jsonb,
                        ${JSON.stringify(fd.tags || [])}::jsonb, NOW()
                    )`);

                        await tx.$executeRaw`
                        INSERT INTO "FdProduct" (id, issuer_id, type, min_deposit, max_deposit, min_tenure_days, max_tenure_days, lock_in_period_days, withdrawal_message, premature_penalty_percent, is_vkyc_required, min_amount_for_vkyc, usps, faqs, tags, "updatedAt")
                        VALUES ${Prisma.join(productValues)}
                        ON CONFLICT (issuer_id, type) DO UPDATE SET min_deposit = EXCLUDED.min_deposit, max_deposit = EXCLUDED.max_deposit, "updatedAt" = NOW();
                    `;

                        // --- STEP C: MAP IDS FOR RATES ---
                        const currentProducts = await tx.fdProduct.findMany({
                            where: { issuer_id: { in: batch.map(b => b.issuerId) } },
                            select: { id: true, issuer_id: true, type: true }
                        });
                        const productMap = new Map(currentProducts.map(p => [`${p.issuer_id}-${p.type}`, p.id]));

                        // --- STEP D: UPSERT INTEREST RATES ---
                        const rateValues: Prisma.Sql[] = [];
                        for (const fd of batch) {
                            const pId = productMap.get(`${fd.issuerId}-${fd.type}`);
                            if (!pId) continue;

                            // Extract product-level calculator flags
                            const productHasSenior = fd.calculator?.isSeniorCitizen || false;
                            const productHasFemale = fd.calculator?.isFemale || false;

                            fd.frequencyTenureMapping?.forEach((freqGroup: any) => {
                                const apiFreq = freqGroup.frequency?.toUpperCase();
                                const mappedFreq = frequencyMap[apiFreq] || 'CUMULATIVE';

                                // Determine customer type from product calculator flags, NOT from group properties
                                let customerType: FdCustomerType = "STANDARD";

                                if (productHasSenior && productHasFemale) {
                                    customerType = "SENIOR_CITIZEN_FEMALE";
                                } else if (productHasSenior) {
                                    customerType = "SENIOR_CITIZEN";
                                } else if (productHasFemale) {
                                    customerType = "FEMALE";
                                }

                                freqGroup.tenure_mapping?.forEach((tm: any) => {
                                    rateValues.push(Prisma.sql`(
                                    ${cuid()}, ${pId}, ${mappedFreq}::"FdPayoutFrequency", ${customerType}::"FdCustomerType", 
                                    ${tm.tenure}, ${tm.year || tm.display}, ${parseFloat(tm.rates.replace('%', ''))}, 
                                    ${parseFloat(tm.annualizedYield?.replace('%', '') || '0')},
                                    ${tm.default === true}, null, NOW()
                                )`);
                                });
                            });
                        }

                        if (rateValues.length > 0) {
                            await tx.$executeRaw`
                            INSERT INTO "FdInterestRate" (
                                id, fd_product_id, payout_frequency, customer_type, 
                                tenure_days, tenure_label, interest_rate, annualized_yield, 
                                is_default_selection, is_tax_saver, "updatedAt"
                            )
                            VALUES ${Prisma.join(rateValues)}
                            ON CONFLICT (fd_product_id, payout_frequency, tenure_days, customer_type) 
                            DO UPDATE SET 
                                interest_rate = EXCLUDED.interest_rate,
                                annualized_yield = EXCLUDED.annualized_yield, 
                                "updatedAt" = NOW();
                        `;
                        }
                    }, { timeout: 30000 });

                    totalSynced += batch.length;
                    logger.info(`Batch Sync Successful: ${totalSynced}/${api_data.length}`);
                } catch (batchError) {
                    logger.error("Batch failed, skipping to next...", batchError);
                }
            }
        } catch (error: any) {
            logger.error("FATAL: FD Sync Job Failed.", error);
            throw error
        }
    };





    /**
     * Scheduled Job to fetch and store NAV history for mutual funds
     * Flow :
     * 1. Fetch all mutual fund products from the database.
     * 2. For each product, call the external API to get NAV history.
     * 3. Store the NAV history in the database.
     */
    nav_history_job = async () => {

        const endDate = (new Date()).toISOString().split('T')[0];
        const startDate = (new Date(new Date().setFullYear(new Date().getFullYear() - 5))).toISOString().split('T')[0];

        logger.debug(`NAV History Job: startDate=${startDate} endDate=${endDate}`);

        // const mf_products = await db.mfProduct.findMany({
        //     select: { id: true, scheme_id: true, mapping_code: true }
        // });

        let cursor: string | null = null;
        const BATCH_SIZE = 100;
        const limit = pLimit(2);

        while (true) {

            // Implemented cursor pagination to avoid loading all products in memory at once.....
            // Hehehe... recently learned about this


            const products: any[] = await db.mfProduct.findMany({
                take: BATCH_SIZE,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                select: { id: true, mapping_code: true },
                orderBy: { id: 'asc' }
            });

            if (products.length === 0) break;

            const tasks = products.map(product =>
                limit(() => this.process_nav_history(product, startDate, endDate))
            );

            await Promise.allSettled(tasks);

            cursor = products[products.length - 1].id;
        }
    }




    process_nav_history = async (product: { id: string, mapping_code: string }, startDate: string, endDate: string) => {
        try {
            const nav_history_data = await axios.get(`${process.env.MF_LATEST_URL}/mf/${product.mapping_code}`, {
                params: { startDate, endDate },
                timeout: 15000
            }).then(res => res.data.data);

            logger.debug(`Fetched NAV history for scheme_id: ${product.mapping_code}, Records: ${nav_history_data.length}`);

            const to_insert: MfNavHistoryCreateManyInput[] = nav_history_data.map((nav_record: any) => {
                let parsedDate: Date;
                if (typeof nav_record.date === 'string' && nav_record.date.includes('-')) {
                    const parts = nav_record.date.split('-');
                    if (parts.length === 3 && parts[0].length === 2) {
                        parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                    } else {
                        parsedDate = new Date(nav_record.date);
                    }
                } else {
                    parsedDate = new Date(nav_record.date);
                }

                if (isNaN(parsedDate.getTime())) {
                    logger.error(`Skipping ${product.mapping_code}: Invalid date format "${nav_record.date}"`);
                }

                return {
                    mf_product_id: product.id,
                    scheme_id: product.mapping_code,
                    nav_date: parsedDate,
                    nav: nav_record.nav,
                } satisfies MfNavHistoryCreateManyInput;
            });

            if (to_insert.length > 0) {
                const BATCH_SIZE = 1000;
                for (let i = 0; i < to_insert.length; i += BATCH_SIZE) {
                    await db.mfNavHistory.createMany({
                        data: to_insert.slice(i, i + BATCH_SIZE),
                        skipDuplicates: true
                    });
                }
            }

            logger.info(`NAV History Job: Inserted ${to_insert.length} records for scheme_id: ${product.mapping_code}`);
        } catch (error) {
            logger.error(`Error fetching/storing NAV history for scheme_id: ${product.mapping_code}`, error);
        }
    }






    single_nav_history_job = async (scheme_code: string) => {

        // const scheme_id: any = await this.get_only_mf_product(scheme_code).then(product => product?.mapping_code);

        const endDate = (new Date()).toISOString().split('T')[0];
        const startDate = (new Date(new Date().setFullYear(new Date().getFullYear() - 5))).toISOString().split('T')[0];

        logger.debug(`Single NAV History Job: startDate=${startDate} endDate=${endDate}`);

        const mf_product = await db.mfProduct.findFirst({
            where: { id: scheme_code },
            select: { id: true, scheme_id: true, mapping_code: true }
        });

        if (!mf_product) {
            logger.warn(`Single NAV History Job: No product found for id: ${scheme_code}`);
            return;
        }

        await this.process_nav_history(mf_product, startDate, endDate);
    }

}

export const job_service = new JobServiceClass();