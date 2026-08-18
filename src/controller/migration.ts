import { NextFunction, Request, Response } from "express";
import * as fs from 'fs';
import path from "path";
import logger from "../middleware/logger.js";
import { db } from "../server.js";


export const get_all_user_data = async (req: Request, res: Response, next: NextFunction) => {
    try {

        const all_user = await db.user.findMany();

        const users = all_user.map((usr) => ({
            id: usr.id,
            name: usr.full_name
        }))

        res.status(200).send({
            users
        })

    } catch (error) {
        logger.error('Error while getting all users data', error);
        next(error);
    }

}



export const bundle_logo_data_migrate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = path.join(process.cwd(), 'bundle_logo_data.json');

        logger.debug(`Starting bundle logo data migration from file: ${filePath}`);

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        logger.info(`Total records to update: ${data.length}`);

        let successCount = 0;
        let skipCount = 0;
        const failedIds: string[] = [];

        // Process EVERYTHING now, no slicing.
        for (const row of data) {
            try {
                await db.bundle.updateMany({
                    where: { bundle_name: row.bundle_name },
                    data: { img_url: row.logo_url }
                });
                successCount++;

                // Log every 500 rows so you know it's not frozen
                // if (successCount % 500 === 0) {
                //     logger.info(`✔ Progress: ${successCount} records updated...`);
                // }
            } catch (err: any) {
                // We catch the error but DON'T 'throw' it.
                // This allows the loop to move to the next record.
                skipCount++;
                failedIds.push(row.id);
            }
        }

        logger.info(`\nMigration Finished! 🎉`);
        logger.info(`✅ Successfully updated: ${successCount}`);
        logger.info(`⚠ Skipped (Not Found): ${skipCount}`);

        if (failedIds.length > 0) {
            logger.warn(`First few missing IDs: ${failedIds.slice(0, 5).join(', ')}`);
        }

        res.status(200).json({
            message: "Migration complete",
            success: successCount,
            skipped: skipCount
        });
    } catch (error) {
        logger.error("Error in data migration: ", error);
        next(error);
    }
}




export const data_migrate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = path.join(process.cwd(), 'logo_data.json');

        logger.debug(`Starting data migration from file: ${filePath}`);

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        logger.info(`Total records to update: ${data.length}`);

        let successCount = 0;
        let skipCount = 0;
        const failedIds: string[] = [];

        // DEAD as of the Fintech Primitives migration: this keyed MfProduct by amc_name, a
        // column dropped in the Cybrilla/FP catalogue revamp. img_url itself survived, but
        // there's nothing left to match rows by, so this one-off script can no longer run.
        for (const row of data) {
            // try {
            //     await db.mfProduct.updateMany({
            //         where: { amc_name: row.mutual_fund_name },
            //         data: { img_url: row.logo_url }
            //     });
            //     successCount++;
            // } catch (err: any) {
            //     skipCount++;
            //     failedIds.push(row.id);
            // }
            skipCount++;
            failedIds.push(row.id);
        }

        logger.info(`\nMigration Finished! 🎉`);
        logger.info(`✅ Successfully updated: ${successCount}`);
        logger.info(`⚠ Skipped (Not Found): ${skipCount}`);

        if (failedIds.length > 0) {
            logger.warn(`First few missing IDs: ${failedIds.slice(0, 5).join(', ')}`);
        }

        res.status(200).json({
            message: "Migration complete",
            success: successCount,
            skipped: skipCount
        });
    } catch (error) {
        logger.error("Error in data migration: ", error);
        next(error);
    }
}


export const amount_data_migration = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = path.join(process.cwd(), 'data/sip_data.json');

        logger.debug(`Starting data migration from file: ${filePath}`);

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        logger.info(`Total records to update: ${data.length}`);

        let successCount = 0;
        let skipCount = 0;
        const failedIds: string[] = [];

        // Process EVERYTHING now, no slicing.
        for (const row of data) {
            try {
                const schemeId = String(row.SCHM_ID);

                // DEAD as of the Fintech Primitives migration: scheme_id was dropped from
                // MfProduct in the Cybrilla/FP catalogue revamp, so this lookup can no longer
                // run - the update it fed was already gutted (see the comment below).
                // const products = await db.mfProduct.findMany({
                //     where: { scheme_id: schemeId },
                //     select: { id: true }
                // });
                const products: { id: string }[] = [];

                if (products.length === 0) {
                    skipCount++;
                    failedIds.push(schemeId);
                    continue;
                }

                // Update each product individually to allow nested updates
                //
                // DEAD as of the Fintech Primitives migration: every column this backfill wrote
                // (the seven per-frequency SIP minimums) was dropped from MfSchemeTransactionRules.
                // The whole update is commented out rather than left as an empty `data: {}`, which
                // would still fire a pointless UPDATE per product. Per-scheme SIP limits now come
                // from MfSchemePlan.sip_daily_* / sip_monthly_*, sourced from FP rather than a CSV.
                for (const product of products) {
                    // await db.mfProduct.update({
                    //     where: { id: product.id },
                    //     data: {
                    //         transaction_rules: {
                    //             upsert: {
                    //                 create: {
                    //                     min_daily_sip_amount: Number(row.sip_min_amt_daily) ?? 0,
                    //                     min_weekly_sip_amount: Number(row.sip_min_amt_weekly) ?? 0,
                    //                     min_fortnightly_sip_amount: Number(row.sip_min_amt_fortnightly) ?? 0,
                    //                     min_monthly_sip_amount: Number(row.sip_min_amt_monthly) ?? 0,
                    //                     min_quarterly_sip_amount: Number(row.sip_min_amt_quarterly) ?? 0,
                    //                     min_semi_annual_sip_amount: Number(row.sip_min_amt_semi_annual) ?? 0,
                    //                     min_annual_sip_amount: Number(row.sip_min_amt_annual) ?? 0,
                    //                 },
                    //                 update: {
                    //                     min_daily_sip_amount: Number(row.sip_min_amt_daily) ?? 0,
                    //                     min_weekly_sip_amount: Number(row.sip_min_amt_weekly) ?? 0,
                    //                     min_fortnightly_sip_amount: Number(row.sip_min_amt_fortnightly) ?? 0,
                    //                     min_monthly_sip_amount: Number(row.sip_min_amt_monthly) ?? 0,
                    //                     min_quarterly_sip_amount: Number(row.sip_min_amt_quarterly) ?? 0,
                    //                     min_semi_annual_sip_amount: Number(row.sip_min_amt_semi_annual) ?? 0,
                    //                     min_annual_sip_amount: Number(row.sip_min_amt_annual) ?? 0,
                    //                 }
                    //             }
                    //         }
                    //     }
                    // });

                    logger.debug(`Skipped (migration disabled) for id : ${product.id}`)
                }
                successCount++;

                // Log every 500 rows so you know it's not frozen
                if (successCount % 500 === 0) {
                    logger.info(`✔ Progress: ${successCount} records updated...`);
                }
            } catch (err: any) {
                // We catch the error but DON'T 'throw' it.
                // This allows the loop to move to the next record.
                logger.error(`Error updating scheme ${row.SCHM_ID}: ${err.message}`);
                skipCount++;
                failedIds.push(String(row.SCHM_ID));
            }
        }

        logger.info(`\nMigration Finished! 🎉`);
        logger.info(`✅ Successfully updated: ${successCount}`);
        logger.info(`⚠ Skipped (Not Found): ${skipCount}`);

        if (failedIds.length > 0) {
            logger.warn(`First few missing IDs: ${failedIds.slice(0, 5).join(', ')}`);
        }

        res.status(200).json({
            message: "Migration complete",
            success: successCount,
            skipped: skipCount
        });
    } catch (error) {
        logger.error("Error in data migration: ", error);
        next(error);
    }
}