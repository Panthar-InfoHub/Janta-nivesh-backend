import { NextFunction, Request, Response } from "express";
import * as fs from 'fs';
import path from "path";
import logger from "../middleware/logger.js";
import { db } from "../server.js";

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

        // Process EVERYTHING now, no slicing.
        for (const row of data) {
            try {
                await db.mfProduct.updateMany({
                    where: { amc_name: row.mutual_fund_name },
                    data: { img_url: row.logo_url }
                });
                successCount++;

                // Log every 500 rows so you know it's not frozen
                if (successCount % 500 === 0) {
                    logger.info(`✔ Progress: ${successCount} records updated...`);
                }
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


export const amount_data_migration = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = path.join(process.cwd(), 'data/lump_sum_data.json');

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

                // Find all products that match this scheme_id
                const products = await db.mfProduct.findMany({
                    where: { scheme_id: schemeId },
                    select: { id: true }
                });

                if (products.length === 0) {
                    skipCount++;
                    failedIds.push(schemeId);
                    continue;
                }

                logger.debug("Updating the values for products ==> ", products)
                // Update each product individually to allow nested updates
                for (const product of products) {
                    await db.mfProduct.update({
                        where: { id: product.id },
                        data: {
                            display_name_001: row.display_name_001,
                            display_name_002: row.dislpay_name_002, // NOTE: matches 'dislpay_name_002' typo from JSON
                            transaction_rules: {
                                // Use upsert in case the rule doesn't exist yet
                                upsert: {
                                    create: {
                                        min_lumpsum_add_on_amount: Number(row.min_add_on_amt) ?? 0,
                                        min_redem_qty: Number(row.min_redem_qty) ?? 0,
                                        min_redem_amount: Number(row.min_redem_amt) ?? 0,
                                    },
                                    update: {
                                        min_lumpsum_add_on_amount: Number(row.min_add_on_amt) ?? 0,
                                        min_redem_qty: Number(row.min_redem_qty) ?? 0,
                                        min_redem_amount: Number(row.min_redem_amt) ?? 0,
                                    }
                                }
                            }
                        }
                    });

                    logger.debug(`Updated the values for id : ${product.id}`)
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