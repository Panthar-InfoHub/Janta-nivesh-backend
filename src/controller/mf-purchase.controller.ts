import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { create_mf_purchase_schema } from "../lib/zod-schemas/mf-purchase.schema.js";
import { fintech_primitive_mf_purchase_service } from "../services/fintech-primitive/mf_purchase.service.js";
import { user_service } from "../services/user.service.js";

class MfPurchaseControllerClass {

    /** No persistence yet, per current scope - straight passthrough to FP, normalized response envelope only. */
    create_purchase = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mf_purchase_schema.parse(req.body);
            let raw_ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "127.0.0.1";
            const user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip).split(",")[0].replace("::ffff:", "").trim();

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.investment_account) {
                throw new AppError("Investment account not set up yet - complete the profile stage first", 400, "INVESTMENT_ACCOUNT_MISSING");
            }

            logger.info("Creating MF purchase", { user_id, scheme: input.scheme, amount: input.amount });

            const purchase = await fintech_primitive_mf_purchase_service.create_purchase(input, user.investment_account, user_ip);

            res.status(200).json({
                success: true,
                message: "MF purchase created",
                data: purchase
            });
            return;
        } catch (error) {
            logger.error("Error in create_purchase controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_purchase_controller = new MfPurchaseControllerClass();
