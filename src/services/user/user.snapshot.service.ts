import logger from "../../middleware/logger.js";
import { user_service } from "../user.service.js";
import { db } from "../../server.js";

class UserSnapshotServiceClass {
    private toNumber = (val: any) => parseFloat(String(val).replace(/,/g, "")) || 0;

    /**
     * Calculates and saves the net worth snapshot for a single user
     */
    async capture_user_snapshot(user_id: string) {
        try {
            logger.info(`Capturing net worth snapshot for user: ${user_id}`);

            // 1. Get Live Data from Database
            const user_data = await user_service.get_all_user_data(user_id, {
                user_assets: true,
                user_loan: true,
            });

            if (!user_data) {
                logger.warn(`No user data found for ${user_id}, skipping snapshot.`);
                return;
            }

            // 2. Get Live Mutual Fund Data from database (mfHolding) with fallback to stored assets
            const holdings = await db.mfHolding.findMany({
                where: { user_id },
                select: { current_value: true },
            });
            let mf_current_value = holdings.reduce(
                (sum: number, h) => sum + this.toNumber(h.current_value),
                0
            );
            if (mf_current_value === 0 && user_data.user_assets?.mutual_funds) {
                mf_current_value = this.toNumber(user_data.user_assets?.mutual_funds);
            }

            // 3. Calculate Totals
            const assets =
                mf_current_value +
                this.toNumber(user_data.user_assets?.fd) +
                this.toNumber(user_data.user_assets?.stocks) +
                this.toNumber(user_data.user_assets?.gold) +
                this.toNumber(user_data.user_assets?.cash_saving) +
                this.toNumber(user_data.user_assets?.mutual_funds) + // if user have any previously calculated mutual fund value, we can consider that as well
                this.toNumber(user_data.user_assets?.real_estate);

            const liabilities = user_data.user_loan?.reduce(
                (sum: number, loan: any) => sum + this.toNumber(loan.outstanding_amount),
                0
            ) || 0;

            const net_worth = assets - liabilities;

            const now = new Date();
            const month = now.getMonth() + 1; // 1-12
            const year = now.getFullYear();

            // 4. Save to Database
            const snapshot = await db.userNetWorthSnapshot.upsert({
                where: {
                    userId_month_year: {
                        userId: user_id,
                        month,
                        year,
                    },
                },
                update: {
                    netWorth: String(net_worth),
                    assets: String(assets),
                    liabilities: String(liabilities),
                },
                create: {
                    userId: user_id,
                    netWorth: String(net_worth),
                    assets: String(assets),
                    liabilities: String(liabilities),
                    month,
                    year,
                },
            });

            logger.info(`Snapshot saved for ${user_id}: NW=${net_worth}`);
            return snapshot;

        } catch (error) {
            logger.error(`Failed to capture snapshot for user ${user_id}:`, error);
            throw error;
        }
    }

    /**
     * Captures snapshots for all active users (intended for Cron Job)
     */
    async capture_all_users_snapshots() {
        const users = await db.user.findMany({
            select: { id: true }
        });

        logger.info(`Starting bulk snapshot capture for ${users.length} users...`);

        let success = 0;
        let failed = 0;

        for (const user of users) {
            try {
                await this.capture_user_snapshot(user.id);
                success++;
            } catch (err) {
                failed++;
            }
        }

        logger.info(`Bulk snapshot complete. Success: ${success}, Failed: ${failed}`);
        return { success, failed };
    }
}

export const user_snapshot_service = new UserSnapshotServiceClass();
