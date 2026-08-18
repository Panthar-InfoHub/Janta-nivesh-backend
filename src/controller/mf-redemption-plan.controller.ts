import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { create_mf_redemption_plan_schema, verify_redemption_plan_confirmation_otp_schema, type ResolvedMfRedemptionPlanInput } from "../lib/zod-schemas/mf-redemption-plan.schema.js";
import { fintech_primitive_mf_redemption_plan_service } from "../services/fintech-primitive/mf_redemption_plan.service.js";
import { mf_transaction_plan_service } from "../services/mf-transaction-plan.service.js";
import { user_service } from "../services/user.service.js";
import { plan_confirmation_otp_service } from "../services/plan-confirmation-otp.service.js";

class MfRedemptionPlanControllerClass {

    create_redemption_plan = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mf_redemption_plan_schema.parse(req.body);

            const raw_ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "127.0.0.1";
            const user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip).split(",")[0].replace("::ffff:", "").trim();

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.investment_account) {
                throw new AppError("Investment account not set up yet - complete the profile stage first", 400, "INVESTMENT_ACCOUNT_MISSING");
            }

            // No mandate check here - redemptions pay out, nothing is collected from the investor

            // scheme/folio_number come from the purchase plan being redeemed against, never from
            // the client. The lookup is scoped by user_id, so it doubles as the ownership check
            // on that folio.
            const source_plan = await mf_transaction_plan_service.get_by_fp_id(user_id, input.purchase_plan_id);
            if (!source_plan) {
                throw new AppError("Purchase plan not found", 404, "PURCHASE_PLAN_NOT_FOUND");
            }
            if (source_plan.plan_type !== "PURCHASE") {
                throw new AppError(`Plan is a ${source_plan.plan_type} plan, not a purchase plan`, 400, "NOT_A_PURCHASE_PLAN");
            }
            if (source_plan.state !== "ACTIVE") {
                throw new AppError(`Purchase plan must be active to redeem against, currently ${source_plan.state}`, 400, "PURCHASE_PLAN_NOT_ACTIVE");
            }
            // Folio is only allotted once an installment has actually been processed - until then
            // there are no units to redeem.
            if (!source_plan.folio_number) {
                throw new AppError("No folio allotted yet - the first installment has not been processed", 400, "FOLIO_NOT_ALLOTTED_YET");
            }

            const resolved_input: ResolvedMfRedemptionPlanInput = {
                scheme: source_plan.scheme,
                folio_number: source_plan.folio_number,
                amount: input.amount,
                frequency: input.frequency,
                installment_day: input.installment_day,
            };

            logger.info("Creating MF redemption plan", {
                user_id,
                purchase_plan_id: input.purchase_plan_id,
                scheme: resolved_input.scheme,
                folio_number: resolved_input.folio_number,
                amount: resolved_input.amount,
            });

            const plan = await fintech_primitive_mf_redemption_plan_service.create_redemption_plan(
                resolved_input, user.investment_account, user_ip
            );

            if (!plan?.id) {
                logger.error("FP mf_redemption_plan response missing id ==> ", plan);
                throw new AppError("Failed to create MF redemption plan", 502, "MF_REDEMPTION_PLAN_CREATE_FAILED");
            }

            await mf_transaction_plan_service.upsert_from_fp(user_id, "REDEMPTION", plan);

            res.status(200).json({
                success: true,
                message: "MF redemption plan created",
                data: plan
            });
            return;
        } catch (error) {
            logger.error("Error in create_redemption_plan controller:", error);
            next(error);
            return;
        }
    }

    get_redemption_plans = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const redemption_plans = await mf_transaction_plan_service.get_all(user_id, "REDEMPTION");

            res.status(200).json({
                success: true,
                message: "MF redemption plans fetched",
                data: { redemption_plans }
            });
            return;
        } catch (error) {
            logger.error("Error in get_redemption_plans controller:", error);
            next(error);
            return;
        }
    }

    /** Polls FP for the plan's current state (created -> review_completed -> ...) and syncs our row. */
    fetch_redemption_plan = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_plan_id = req.params.id as string;

            logger.info("Fetching MF redemption plan status", { user_id, fp_plan_id });

            const existing = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_plan_id);
            if (!existing) {
                throw new AppError("Redemption plan not found", 404, "MF_REDEMPTION_PLAN_NOT_FOUND");
            }

            const plan = await fintech_primitive_mf_redemption_plan_service.get_redemption_plan(fp_plan_id);
            const updated = await mf_transaction_plan_service.upsert_from_fp(user_id, "REDEMPTION", plan);

            res.status(200).json({
                success: true,
                message: "MF redemption plan fetched",
                data: updated
            });
            return;
        } catch (error) {
            logger.error("Error in fetch_redemption_plan controller:", error);
            next(error);
            return;
        }
    }

    /** Step 1 of confirming a review_completed plan - send the OTP to the user's own phone. */
    request_confirmation_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_plan_id = req.params.id as string;

            const plan = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_plan_id);
            if (!plan) {
                throw new AppError("Redemption plan not found", 404, "MF_REDEMPTION_PLAN_NOT_FOUND");
            }
            if (plan.state !== "REVIEW_COMPLETED") {
                throw new AppError(`Plan must be in review_completed state to confirm, currently ${plan.state}`, 400, "MF_REDEMPTION_PLAN_NOT_REVIEW_COMPLETED");
            }

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.phone_no) {
                throw new AppError("User has no verified phone number on file", 400, "USER_PHONE_MISSING");
            }

            logger.info("Requesting redemption plan confirmation OTP", { user_id, fp_plan_id });

            await plan_confirmation_otp_service.request_otp(user_id, fp_plan_id, user.phone_no);

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

    /** Step 2 - verify the OTP, then PATCH FP with consent + state: "confirmed". */
    verify_confirmation_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_plan_id = req.params.id as string;
            const { otp } = verify_redemption_plan_confirmation_otp_schema.parse(req.body);

            const plan = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_plan_id);
            if (!plan) {
                throw new AppError("Redemption plan not found", 404, "MF_REDEMPTION_PLAN_NOT_FOUND");
            }

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.email || !user?.phone_no) {
                throw new AppError("User email and phone number are required to confirm", 400, "USER_CONTACT_INFO_MISSING");
            }

            logger.info("Verifying redemption plan confirmation OTP", { user_id, fp_plan_id });

            await plan_confirmation_otp_service.verify_otp(user_id, fp_plan_id, otp);

            const confirmed = await fintech_primitive_mf_redemption_plan_service.confirm_redemption_plan(fp_plan_id, {
                email: user.email,
                isd_code: "91",
                mobile: user.phone_no,
            });

            const updated = await mf_transaction_plan_service.upsert_from_fp(user_id, "REDEMPTION", confirmed);
            await mf_transaction_plan_service.mark_consent_given(updated.id);

            res.status(200).json({
                success: true,
                message: "Redemption plan confirmed",
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

export const mf_redemption_plan_controller = new MfRedemptionPlanControllerClass();
