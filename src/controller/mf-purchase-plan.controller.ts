import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { create_mf_purchase_plan_schema } from "../lib/zod-schemas/mf-purchase-plan.schema.js";
import { fintech_primitive_mf_purchase_plan_service } from "../services/fintech-primitive/mf_purchase_plan.service.js";
import { mf_purchase_plan_service } from "../services/mf-purchase-plan.service.js";
import { mandate_service } from "../services/mandate.service.js";
import { user_service } from "../services/user.service.js";

class MfPurchasePlanControllerClass {

    create_purchase_plan = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mf_purchase_plan_schema.parse(req.body);

            const raw_ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "127.0.0.1";
            const user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip).split(",")[0].replace("::ffff:", "").trim();

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.investment_account) {
                throw new AppError("Investment account not set up yet - complete the profile stage first", 400, "INVESTMENT_ACCOUNT_MISSING");
            }

            // An APPROVED mandate must be the payment_source before the plan can be confirmed
            const mandates = await mandate_service.get_all(user_id);
            const approved_mandate = mandates.find((m) => m.status === "SUCCESS");
            if (!approved_mandate) {
                throw new AppError("No approved mandate found - create and authorize a mandate first", 400, "APPROVED_MANDATE_REQUIRED");
            }

            logger.info("Creating MF purchase plan", { user_id, scheme: input.scheme, amount: input.amount, frequency: input.frequency });

            const plan = await fintech_primitive_mf_purchase_plan_service.create_purchase_plan(
                input, user.investment_account, approved_mandate.mandate_id, user_ip
            );

            if (!plan?.id) {
                logger.error("FP mf_purchase_plan response missing id ==> ", plan);
                throw new AppError("Failed to create MF purchase plan", 502, "MF_PURCHASE_PLAN_CREATE_FAILED");
            }

            await mf_purchase_plan_service.upsert_from_fp(user_id, plan);

            res.status(200).json({
                success: true,
                message: "MF purchase plan created",
                data: plan
            });
            return;
        } catch (error) {
            logger.error("Error in create_purchase_plan controller:", error);
            next(error);
            return;
        }
    }

    get_purchase_plans = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const purchase_plans = await mf_purchase_plan_service.get_all(user_id);

            res.status(200).json({
                success: true,
                message: "MF purchase plans fetched",
                data: { purchase_plans }
            });
            return;
        } catch (error) {
            logger.error("Error in get_purchase_plans controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_purchase_plan_controller = new MfPurchasePlanControllerClass();
