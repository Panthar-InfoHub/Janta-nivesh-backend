import { env } from "../lib/config-env.js";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { chunkArray, logMemoryUsage } from "../lib/utils.js";
import { v4 as uuidv4 } from 'uuid';
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
                        return Prisma.sql`(
                        ${uuidv4()}, ${String(mf.SCHM_ID)}, ${mf.ISIN}, ${mf.MAPPING_CODE}, ${mf.NSE_SCHEME_CODE}, ${mf.PLATFORM_SCHEME_CODE}, ${mf.SCHEME_NAME},
                        ${mf.AMC_ID ? String(mf.AMC_ID) : null}, ${mf.AMC_CODE}, ${mf.AMC_NAME}, 
                        ${mf.ASSET_TYPE}, ${mf.SCHEME_TYPE}, ${mf.STRUCTURE}, ${mf.RISK_NAME}, 
                        ${mf.RISK_ID ? parseInt(mf.RISK_ID) : null}, ${mf.NAV ? parseFloat(mf.NAV) : null},
                        ${navDate}, ${mf.PURCHASE_ALLOWED === "Y"}, ${mf.SIP_ALLOWED === "Y"}, 
                        ${mf.REDEMPTION_ALLOWED === "Y"}, ${mf.SWITCH_ALLOWED === "Y"}, NOW()
                    )`;
                    });

                    // -> Execute Bulk Upsert for Products?? why raw sql because prisma don't support upsertMany and we want to do this in 1 query for 30k records
                    await tx.$executeRaw`
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
                        "updatedAt" = NOW();
                `;

                    logger.info(`Batch of ${batch.length} products upserted successfully.`);

                    //->. Get UUIDs for the current batch (using the transaction client 'tx')
                    const products = await tx.mfProduct.findMany({
                        where: {
                            OR: batch.map(m => ({
                                scheme_id: String(m.SCHM_ID),
                                isin: m.ISIN,
                                nse_scheme_code: m.NSE_SCHEME_CODE
                            }))
                        },
                        select: { id: true, scheme_id: true, isin: true, nse_scheme_code: true }
                    });

                    // -> Create a Map for O(1) access to product IDs based on scheme_id
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
                    logger.info(`Batch of ${metricsValues.length} metrics upserted successfully.`);

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
                    logger.info(`Batch of ${ruleValues.length} rules upserted successfully.`);

                }
            }, {
                timeout: 60000, // Increase timeout to 60s for 30k records
                maxWait: 10000
            });

            logger.info(`Daily MF Sync: 30,000 records synchronized atomically.`);
            return true;

        } catch (error) {
            logger.error("FATAL: Mutual Fund Job failed. Database rolled back to previous state.", error);
            throw error;
        } finally {
            logMemoryUsage("END OF JOB"); // Check if memory cleared or leaked
        }
    }





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

        const mf_products = await db.mfProduct.findMany({
            select: { id: true, scheme_id: true, mapping_code: true }
        });

        let cursor: string | null = null;
        const BATCH_SIZE = 100;
        const limit = pLimit(5);

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




    process_nav_history = async (product: { id: string; scheme_id: string, mapping_code: string }, startDate: string, endDate: string) => {
        try {
            const nav_history_data = await axios.get(`${process.env.MF_LATEST_URL}/mf/${product.mapping_code}`, {
                params: { startDate, endDate }
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
                    logger.error(`Skipping ${product.scheme_id}: Invalid date format "${nav_record.date}"`);
                }

                return {
                    mf_product_id: product.id,
                    scheme_id: product.mapping_code,
                    nav_date: parsedDate,
                    nav: nav_record.nav,
                } satisfies MfNavHistoryCreateManyInput;
            });

            if (to_insert.length > 0) {
                await db.$transaction(async (tx) => {
                    const BATCH_SIZE = 1000;
                    for (let i = 0; i < to_insert.length; i += BATCH_SIZE) {
                        await tx.mfNavHistory.createMany({
                            data: to_insert.slice(i, i + BATCH_SIZE),
                            skipDuplicates: true
                        });
                    }
                });
            }

            logger.info(`NAV History Job: Inserted ${to_insert.length} records for scheme_id: ${product.scheme_id}`);
        } catch (error) {
            logger.error(`Error fetching/storing NAV history for scheme_id: ${product.scheme_id}`, error);
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