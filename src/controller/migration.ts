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