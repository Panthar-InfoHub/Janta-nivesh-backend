import { env } from "../lib/config-env.js";
import { FdCustomerType, FdPayoutFrequency, Prisma } from "../prisma/generated/prisma/client.js";
import { chunkArray, logMemoryUsage } from "../lib/utils.js";
import cuid from 'cuid';
import axios from "axios";
import logger from "../middleware/logger.js";
import { db } from "../server.js";
// pLimit and MfNavHistoryCreateManyInput were only used by the now-disabled NAV history jobs
// below (see the TODO there) - re-import both if that block is restored.
// import pLimit from "p-limit";
// import { MfNavHistoryCreateManyInput } from "../prisma/generated/prisma/models.js";
import { user_snapshot_service } from "./user/user.snapshot.service.js";


class JobServiceClass {

    monthly_user_snapshot_job = async () => {
        logger.info("Starting monthly user net worth snapshot job...");
        try {
            const result = await user_snapshot_service.capture_all_users_snapshots();
            logger.info(`Monthly snapshot job completed. Results: ${JSON.stringify(result)}`);
            return result;
        } catch (error) {
            logger.error("Error in monthly_user_snapshot_job:", error);
            throw error;
        }
    }

    // daily_mf_product_job (the Finnsys ~30k bulk upsert) was removed as part of the Cybrilla/FP
    // migration - replaced by POST /api/v2/admin/mf-product-import (curated JSON list) and the
    // per-ISIN sync job TODO'd in job.router.ts. Unlike the NAV jobs below, this had a clear,
    // already-decided replacement, so there was nothing worth leaving commented as a breadcrumb.




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
                    // DEBUG LOGGING: Check batch composition
                    logger.debug(`[FD SYNC] Processing batch of ${batch.length} products`);
                    logger.debug(`[FD SYNC] Batch issuer IDs: ${batch.map((fd: any) => fd.issuerId).join(', ')}`);
                    logger.debug(`[FD SYNC] Batch product types: ${batch.map((fd: any) => fd?.type).join(', ')}`);

                    await db.$transaction(async (tx) => {
                        // --- STEP A: UPSERT ISSUERS ---
                        logger.debug(`[FD SYNC] STEP A: Starting issuer upsert`);
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

                        logger.debug(`[FD SYNC] STEP A: Created ${issuerValues.length} issuer value rows (may contain duplicates)`);

                        await tx.$executeRaw`
                        INSERT INTO "FdIssuer" (id, full_name, display_name, issuer_type, logo_url, banner_url, rating_text, customer_served, operating_since, about_description, support_email, support_phone, "updatedAt")
                        VALUES ${Prisma.join(issuerValues)}
                        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, "updatedAt" = NOW();
                    `;

                        logger.debug(`[FD SYNC] STEP A: Issuer upsert completed successfully`);

                        // --- STEP B: UPSERT PRODUCTS ---
                        logger.debug(`[FD SYNC] STEP B: Starting product upsert`);
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

                        logger.debug(`[FD SYNC] STEP B: Created ${productValues.length} product value rows`);

                        await tx.$executeRaw`
                        INSERT INTO "FdProduct" (id, issuer_id, type, min_deposit, max_deposit, min_tenure_days, max_tenure_days, lock_in_period_days, withdrawal_message, premature_penalty_percent, is_vkyc_required, min_amount_for_vkyc, usps, faqs, tags, "updatedAt")
                        VALUES ${Prisma.join(productValues)}
                        ON CONFLICT (issuer_id, type) DO UPDATE SET min_deposit = EXCLUDED.min_deposit, max_deposit = EXCLUDED.max_deposit, "updatedAt" = NOW();
                    `;

                        logger.debug(`[FD SYNC] STEP B: Product upsert completed successfully`);

                        // --- STEP C: MAP IDS FOR RATES ---
                        const currentProducts = await tx.fdProduct.findMany({
                            where: { issuer_id: { in: batch.map(b => b.issuerId) } },
                            select: { id: true, issuer_id: true, type: true }
                        });
                        const productMap = new Map(currentProducts.map(p => [`${p.issuer_id}-${p.type}`, p.id]));

                        // --- STEP D: UPSERT INTEREST RATES ---
                        logger.debug(`[FD SYNC] STEP D: Starting interest rate upsert`);
                        const rateValues: Prisma.Sql[] = [];
                        const seenUniqueKeys = new Set<string>();  // Deduplicate by unique constraint
                        let duplicatesSkipped = 0;

                        for (const fd of batch) {
                            const pId = productMap.get(`${fd.issuerId}-${fd.type}`);
                            if (!pId) continue;

                            fd.frequencyTenureMapping?.forEach((freqGroup: any) => {
                                const apiFreq = freqGroup.frequency?.toUpperCase();
                                const mappedFreq = frequencyMap[apiFreq] || 'CUMULATIVE';

                                // Use FREQUENCY GROUP's flags, not product-level calculator flags
                                const groupHasSenior = freqGroup.isSeniorCitizen || false;
                                const groupHasFemale = freqGroup.isFemale || false;

                                let customerType: FdCustomerType = "STANDARD";

                                if (groupHasSenior && groupHasFemale) {
                                    customerType = "SENIOR_CITIZEN_FEMALE";
                                } else if (groupHasSenior) {
                                    customerType = "SENIOR_CITIZEN";
                                } else if (groupHasFemale) {
                                    customerType = "FEMALE";
                                }

                                freqGroup.tenure_mapping?.forEach((tm: any) => {
                                    // Unique constraint: (fd_product_id, payout_frequency, tenure_days, customer_type)
                                    const uniqueKey = `${pId}|${mappedFreq}|${tm.tenure}|${customerType}`;

                                    if (seenUniqueKeys.has(uniqueKey)) {
                                        duplicatesSkipped++;
                                    } else {
                                        seenUniqueKeys.add(uniqueKey);
                                        rateValues.push(Prisma.sql`(
                                        ${cuid()}, ${pId}, ${mappedFreq}::"FdPayoutFrequency", ${customerType}::"FdCustomerType", 
                                        ${tm.tenure}, ${tm.year || tm.display}, ${parseFloat(tm.rates.replace('%', ''))}, 
                                        ${parseFloat(tm.annualizedYield?.replace('%', '') || '0')},
                                        ${tm.default === true}, null, NOW()
                                    )`);
                                    }
                                });
                            });
                        }

                        logger.debug(`[FD SYNC] STEP D: Total unique rate rows: ${rateValues.length}, Duplicates skipped: ${duplicatesSkipped}`);

                        if (rateValues.length > 0) {
                            logger.debug(`[FD SYNC] STEP D: Created ${rateValues.length} interest rate rows`);
                            await tx.$executeRaw`
                            INSERT INTO "FdInterestRate" (
                                id, fd_product_id, payout_frequency, customer_type, 
                                tenure_days, tenure_label, interest_rate, annualized_yield, 
                                is_default_selection, is_tax_saver, "updatedAt"
                            )
                            VALUES ${Prisma.join(rateValues)}
                            ON CONFLICT (fd_product_id, payout_frequency, tenure_label, customer_type) 
                            DO UPDATE SET 
                                interest_rate = EXCLUDED.interest_rate,
                                annualized_yield = EXCLUDED.annualized_yield, 
                                "updatedAt" = NOW();
                        `;
                            logger.debug(`[FD SYNC] STEP D: Interest rate upsert completed successfully`);
                        } else {
                            logger.debug(`[FD SYNC] STEP D: No rate values to insert`);
                        }
                    }, { timeout: 30000 });

                    totalSynced += batch.length;
                    logger.info(`[FD SYNC] Batch Sync Successful: ${totalSynced}/${api_data.length}`);
                } catch (batchError) {
                    logger.error(`[FD SYNC] Batch failed with error:`, batchError);
                    logger.error(`[FD SYNC] Batch error details:`, {
                        message: (batchError as any).message,
                        code: (batchError as any).code,
                        constraint: (batchError as any).constraint
                    });
                    logger.error("Batch failed, skipping to next...", batchError);
                }
            }
        } catch (error: any) {
            logger.error("FATAL: FD Sync Job Failed.", error);
            throw error
        }
    };





    // nav_history_job / process_nav_history / single_nav_history_job disabled - all three keyed
    // NAV lookups off MfProduct.mapping_code, a Finnsys column removed by the Cybrilla/FP
    // catalogue migration. Unlike daily_mf_product_job (deleted above), NAV sourcing for the
    // curated catalogue has no decided replacement yet, so this is commented rather than removed,
    // to keep the gap visible instead of erasing it.
    // TODO: blocked on a NAV-source decision. Once chosen, rewrite process_nav_history to key
    // off product.isin instead of mapping_code (isin survives the slim-down and is unique).
    /*
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
    */

    calculate_all_mf_metrics = async () => {
        logger.info("Starting MF Metrics calculation job...");
        try {
            let cursor: string | null = null;
            const BATCH_SIZE = 500;
            let totalProcessed = 0;

            while (true) {
                const products = await db.mfProduct.findMany({
                    take: BATCH_SIZE,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    where: { latest_nav: { not: null }, latest_nav_date: { not: null } },
                    select: { id: true, latest_nav: true, latest_nav_date: true },
                    orderBy: { id: 'asc' }
                });

                if (products.length === 0) break;

                const productIds = products.map(p => p.id);

                // Fetch required nav points efficiently using Postgres LATERAL join
                const query = Prisma.sql`
                    WITH TargetDates AS (
                        SELECT 
                            id AS product_id,
                            latest_nav,
                            latest_nav_date,
                            latest_nav_date - INTERVAL '1 month' AS date_1m,
                            latest_nav_date - INTERVAL '3 months' AS date_3m,
                            latest_nav_date - INTERVAL '6 months' AS date_6m,
                            latest_nav_date - INTERVAL '1 year' AS date_1y,
                            latest_nav_date - INTERVAL '3 years' AS date_3y,
                            latest_nav_date - INTERVAL '5 years' AS date_5y
                        FROM "MfProduct"
                        WHERE id = ANY(ARRAY[${Prisma.join(productIds)}]::text[])
                    )
                    SELECT 
                        t.product_id,
                        t.latest_nav as latest_nav,
                        n_1d.nav AS nav_1d,
                        n_1m.nav AS nav_1m,
                        n_3m.nav AS nav_3m,
                        n_6m.nav AS nav_6m,
                        n_1y.nav AS nav_1y,
                        n_3y.nav AS nav_3y,
                        n_5y.nav AS nav_5y
                    FROM TargetDates t
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date < t.latest_nav_date ORDER BY nav_date DESC LIMIT 1
                    ) n_1d ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_1m ORDER BY nav_date DESC LIMIT 1
                    ) n_1m ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_3m ORDER BY nav_date DESC LIMIT 1
                    ) n_3m ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_6m ORDER BY nav_date DESC LIMIT 1
                    ) n_6m ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_1y ORDER BY nav_date DESC LIMIT 1
                    ) n_1y ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_3y ORDER BY nav_date DESC LIMIT 1
                    ) n_3y ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_5y ORDER BY nav_date DESC LIMIT 1
                    ) n_5y ON true;
                `;

                const results: any[] = await db.$queryRaw(query);

                const absReturn = (latest: number, past: number | null) => past ? Math.round(((latest / past) - 1) * 100 * 1000) / 1000 : null;
                const cagrReturn = (latest: number, past: number | null, years: number) => past ? Math.round((((Math.pow((latest / past), (1 / years))) - 1) * 100) * 1000) / 1000 : null;

                const metricsValues = results.map(row => {
                    const latest = parseFloat(row.latest_nav);
                    const nav1d = row.nav_1d ? parseFloat(row.nav_1d) : null;
                    const nav1m = row.nav_1m ? parseFloat(row.nav_1m) : null;
                    const nav3m = row.nav_3m ? parseFloat(row.nav_3m) : null;
                    const nav6m = row.nav_6m ? parseFloat(row.nav_6m) : null;
                    const nav1y = row.nav_1y ? parseFloat(row.nav_1y) : null;
                    const nav3y = row.nav_3y ? parseFloat(row.nav_3y) : null;
                    const nav5y = row.nav_5y ? parseFloat(row.nav_5y) : null;

                    return Prisma.sql`(
                        ${cuid()}, 
                        ${row.product_id}, 
                        ${absReturn(latest, nav1d)}, 
                        ${absReturn(latest, nav1m)}, 
                        ${absReturn(latest, nav3m)}, 
                        ${absReturn(latest, nav6m)}, 
                        ${absReturn(latest, nav1y)}, 
                        ${cagrReturn(latest, nav3y, 3)}, 
                        ${cagrReturn(latest, nav5y, 5)}, 
                        NOW()
                    )`;
                });

                if (metricsValues.length > 0) {
                    await db.$executeRaw`
                        INSERT INTO "MfMetrics" (id, mf_product_id, nav_change_pct, return_30d, return_90d, return_6m, return_1y, return_3y, return_5y, "updatedAt")
                        VALUES ${Prisma.join(metricsValues)}
                        ON CONFLICT (mf_product_id) DO UPDATE SET
                            nav_change_pct = EXCLUDED.nav_change_pct,
                            return_30d = EXCLUDED.return_30d,
                            return_90d = EXCLUDED.return_90d,
                            return_6m = EXCLUDED.return_6m,
                            return_1y = EXCLUDED.return_1y,
                            return_3y = EXCLUDED.return_3y,
                            return_5y = EXCLUDED.return_5y,
                            "updatedAt" = NOW();
                    `;
                }

                totalProcessed += products.length;
                cursor = products[products.length - 1].id;
                logger.info(`[MF METRICS] Processed batch of ${products.length}. Total so far: ${totalProcessed}`);
            }
            logger.info("MF Metrics calculation job completed successfully.");
        } catch (error) {
            logger.error("Error in calculate_all_mf_metrics:", error);
            throw error;
        }
    }

}

export const job_service = new JobServiceClass();