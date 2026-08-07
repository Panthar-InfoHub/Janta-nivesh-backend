import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { fintech_primitive_mf_scheme_service } from "../services/fintech-primitive/mf_scheme.service.js";

class MfSchemeControllerClass {

    /** Public - no login_require, same as v1's mutual_fund_controller.get_mutual_fund_by_id. */
    get_scheme_by_isin = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const isin = req.params.isin as string;
            if (!isin) {
                throw new AppError("ISIN is required", 400, "ISIN_REQUIRED");
            }

            logger.info("Fetching fund scheme by ISIN", { isin });

            const scheme = await fintech_primitive_mf_scheme_service.get_scheme_by_isin(isin);

            res.status(200).json({
                success: true,
                message: "Fund scheme fetched",
                data: scheme
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
