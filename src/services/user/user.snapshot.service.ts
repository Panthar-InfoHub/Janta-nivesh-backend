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

            // 2. Native MF + FD from the portfolio summary, plus externally declared assets from onboarding.
            //    Same definition as the FIRE report (fire.report.service build_actual_assets).
            //    Previously, with no MF holdings, declared MF was used as the fallback AND added again (counted twice).
            const portfolio_summary = await user_service.get_user_portfolio_summary(user_id);
            const native_mf = this.toNumber(portfolio_summary?.mutual_funds ?? 0);
            const native_fd = this.toNumber(portfolio_summary?.fixed_deposits ?? 0);

            // 3. Calculate Totals: investable assets only (real estate excluded, as in the FIRE report),
            //    so quarterly net worth / FIRE % history lines up with the current-quarter figures.
            const assets =
                native_mf +
                this.toNumber(user_data.user_assets?.mutual_funds) +
                native_fd +
                this.toNumber(user_data.user_assets?.fd) +
                this.toNumber(user_data.user_assets?.stocks) +
                this.toNumber(user_data.user_assets?.gold) +
                this.toNumber(user_data.user_assets?.cash_saving);

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
