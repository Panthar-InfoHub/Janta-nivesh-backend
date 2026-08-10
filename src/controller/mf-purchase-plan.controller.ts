import { NextFunction, Request, Response } from "express";
import { isIPv4 } from "net";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { create_mf_purchase_plan_schema, verify_purchase_plan_confirmation_otp_schema } from "../lib/zod-schemas/mf-purchase-plan.schema.js";
import { fintech_primitive_mf_purchase_plan_service } from "../services/fintech-primitive/mf_purchase_plan.service.js";
import { mf_transaction_plan_service } from "../services/mf-transaction-plan.service.js";
import { mandate_service } from "../services/mandate.service.js";
import { user_service } from "../services/user.service.js";
import { plan_confirmation_otp_service } from "../services/plan-confirmation-otp.service.js";

class MfPurchasePlanControllerClass {

    create_purchase_plan = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mf_purchase_plan_schema.parse(req.body);

            const raw_ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "127.0.0.1";
            let user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip).split(",")[0].replace("::ffff:", "").trim();

            // Fintech Primitives only accepts IPv4 addresses. 
            // If the user connects via IPv6 (e.g. from a mobile network), we must fallback.
            if (!isIPv4(user_ip)) {
                user_ip = "127.0.0.1";
            }

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

            await mf_transaction_plan_service.upsert_from_fp(user_id, "PURCHASE", plan);

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
            const purchase_plans = await mf_transaction_plan_service.get_all(user_id, "PURCHASE");

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

    /** Polls FP for the plan's current state (created -> review_completed -> ...) and syncs our row. */
    fetch_purchase_plan = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_purchase_plan_id = req.params.id as string;

            logger.info("Fetching MF purchase plan status", { user_id, fp_purchase_plan_id });

            const existing = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_purchase_plan_id);
            if (!existing) {
                throw new AppError("Purchase plan not found", 404, "MF_PURCHASE_PLAN_NOT_FOUND");
            }

            const plan = await fintech_primitive_mf_purchase_plan_service.get_purchase_plan(fp_purchase_plan_id);
            const updated = await mf_transaction_plan_service.upsert_from_fp(user_id, "PURCHASE", plan);

            res.status(200).json({
                success: true,
                message: "MF purchase plan fetched",
                data: updated
            });
            return;
        } catch (error) {
            logger.error("Error in get_purchase_plans controller:", error);
            next(error);
            return;
        }
    }

    /** Step 1 of confirming a review_completed plan - send the OTP to the user's own phone. */
    request_confirmation_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_purchase_plan_id = req.params.id as string;

            const plan = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_purchase_plan_id);
            if (!plan) {
                throw new AppError("Purchase plan not found", 404, "MF_PURCHASE_PLAN_NOT_FOUND");
            }
            if (plan.state !== "review_completed") {
                throw new AppError(`Plan must be in review_completed state to confirm, currently ${plan.state}`, 400, "MF_PURCHASE_PLAN_NOT_REVIEW_COMPLETED");
            }

            const user = await user_service.get_user_by_id(user_id);
            logger.info("Requesting purchase plan confirmation OTP", { user_id, fp_purchase_plan_id });

            await plan_confirmation_otp_service.request_otp(user_id, fp_purchase_plan_id, user.phone_no);

            res.status(200).json({
                success: true,
                message: "OTP sent",
                data: null
            });
            return;
        } catch (error) {
            logger.error("Error in request_confirmation_otp controller:", error);
            next(error);
            return;
        }
    }

    /**
     * Step 2 - verify the OTP, then immediately call FP's Update Purchase Plan API with
     * consent + state: "confirmed". Requires an APPROVED mandate as payment_source, per the
     * docs' ondc note - the plan already has one set from create, so just re-checked here.
     */
    verify_confirmation_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_purchase_plan_id = req.params.id as string;
            const { otp } = verify_purchase_plan_confirmation_otp_schema.parse(req.body);

            const plan = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_purchase_plan_id);
            if (!plan) {
                throw new AppError("Purchase plan not found", 404, "MF_PURCHASE_PLAN_NOT_FOUND");
            }

            const mandates = await mandate_service.get_all(user_id);
            const approved_mandate = mandates.find((m) => m.status === "SUCCESS");
            if (!approved_mandate) {
                throw new AppError("No approved mandate found", 400, "APPROVED_MANDATE_REQUIRED");
            }

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.email || !user?.phone_no) {
                throw new AppError("User email and phone number are required to confirm", 400, "USER_CONTACT_INFO_MISSING");
            }

            logger.info("Verifying purchase plan confirmation OTP", { user_id, fp_purchase_plan_id });

            await plan_confirmation_otp_service.verify_otp(user_id, fp_purchase_plan_id, otp);

            const confirmed = await fintech_primitive_mf_purchase_plan_service.confirm_purchase_plan(fp_purchase_plan_id, {
                email: user.email,
                isd_code: "91",
                mobile: user.phone_no,
            });

            const updated = await mf_transaction_plan_service.upsert_from_fp(user_id, "PURCHASE", confirmed);
            await mf_transaction_plan_service.mark_consent_given(updated.id);

            res.status(200).json({
                success: true,
                message: "Purchase plan confirmed",
                data: updated
            });
            return;
        } catch (error) {
            logger.error("Error in verify_confirmation_otp controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_purchase_plan_controller = new MfPurchasePlanControllerClass();
