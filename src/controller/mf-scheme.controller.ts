import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { db } from "../server.js";

class MfSchemeControllerClass {

    /**
     * Public - no login_require, same as v1's mutual_fund_controller.get_mutual_fund_by_id.
     *
     * Reads MfSchemePlan (kept in sync by the mf-scheme-plan-sync job), not a live FP call - same
     * "backend is the source of truth" reasoning as the portfolio endpoints. `id` in the response
     * is our own MfProduct id, not FP's - the switch-plan flow and the rest of this app's routes
     * take our id, not an ISIN, so the fund detail screen needs it to act on what it's showing.
     */
    get_scheme_by_isin = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const isin = req.params.isin as string;
            if (!isin) {
                throw new AppError("ISIN is required", 400, "ISIN_REQUIRED");
            }

            logger.info("Fetching fund scheme by ISIN", { isin });

            const scheme_plan = await db.mfSchemePlan.findUnique({ where: { isin } });

            if (!scheme_plan) {
                throw new AppError(
                    "Fund scheme not found - it may not have synced yet",
                    404,
                    "MF_SCHEME_PLAN_NOT_FOUND"
                );
            }

            // Destructure scheme_plan's own id out too, not just mf_product_id/raw_response -
            // otherwise it survives in ...rest and silently overwrites `id: mf_product_id` below
            // (object spread applies in order, and this key would come after it).
            const { id: _scheme_plan_id, mf_product_id, raw_response, ...rest } = scheme_plan;

            res.status(200).json({
                success: true,
                message: "Fund scheme fetched",
                data: { id: mf_product_id, ...rest }
            });
            return;
        } catch (error) {
            logger.error("Error in get_scheme_by_isin controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_scheme_controller = new MfSchemeControllerClass();
