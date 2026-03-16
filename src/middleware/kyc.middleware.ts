import { NextFunction, Request, Response } from "express";
import AppError from "./error.middleware.js";
import logger from "./logger.js";
import { kyc_type_service } from "../services/kyc/kyc.type.service.js";

/**
 * Middleware to ensure user has completed Mutual Fund KYC
 */
export const require_mfKyc = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user_id = req.user?.id;

        if (!user_id) {
            throw new AppError("User not authenticated", 401);
        }

        const kyc_record = await kyc_type_service.get_kyc_query(user_id, { kyc_type: "mf" });

        if (!kyc_record || kyc_record.status !== "verified") {
            logger.warn(`User ${user_id} attempted access without verified MF KYC`);
            throw new AppError("Mutual Fund KYC verification required", 403, "MF_KYC_REQUIRED");
        }

        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Middleware to ensure user has completed Trading Account KYC
 */
export const require_tradingKyc = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user_id = req.user?.id;

        if (!user_id) {
            throw new AppError("User not authenticated", 401);
        }

        const kyc_record = await kyc_type_service.get_kyc_query(user_id, { kyc_type: "trading" });

        if (!kyc_record || kyc_record.status !== "verified") {
            logger.warn(`User ${user_id} attempted access without verified Trading KYC`);
            throw new AppError("Trading Account KYC verification required", 403, "TRADING_KYC_REQUIRED");
        }

        next();
    } catch (error) {
        next(error);
    }
};
