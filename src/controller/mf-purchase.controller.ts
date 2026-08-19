import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { create_mf_purchase_schema, verify_purchase_confirmation_otp_schema, type ResolvedMfPurchaseInput } from "../lib/zod-schemas/mf-purchase.schema.js";
import { fintech_primitive_mf_purchase_service } from "../services/fintech-primitive/mf_purchase.service.js";
import { fintech_primitive_payment_service } from "../services/fintech-primitive/payment.service.js";
import { mf_transaction_plan_service } from "../services/mf-transaction-plan.service.js";
import { mf_threshold_validation_service } from "../services/mutual-funds/mf-threshold-validation.service.js";
import { mf_product_service } from "../services/mutual-funds/mf-product.service.js";
import { plan_confirmation_otp_service } from "../services/plan-confirmation-otp.service.js";
import { user_bank_details_service } from "../services/user-bank-details.service.js";
import { user_service } from "../services/user.service.js";
import { isIPv4 } from "net";

/**
 * Lumpsum (one-shot) MF purchase. FP's lifecycle:
 *   create -> under_review -> (async review) -> pending
 *   -> PATCH consent -> POST payment -> PATCH state:confirmed -> submitted
 * Persisted in MfTransactionPlan with `systematic: false`, which is what distinguishes these
 * rows from SIPs (both are plan_type PURCHASE).
 */
class MfPurchaseControllerClass {

    create_purchase = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mf_purchase_schema.parse(req.body);
            let raw_ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "127.0.0.1";
            let user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip).split(",")[0].replace("::ffff:", "").trim();

            if (!isIPv4(user_ip)) {
                user_ip = "127.0.0.1";
            }
            const user = await user_service.get_user_by_id(user_id);
            if (!user?.investment_account) {
                throw new AppError("Investment account not set up yet - complete the profile stage first", 400, "INVESTMENT_ACCOUNT_MISSING");
            }

            // The client names the fund by our catalogue id; the ISIN FP needs is derived here.
            // An unresolvable id is rejected before FP is called, so no order can exist against a
            // fund we don't have - which is what guarantees mf_product_id is never null on the row.
            const product = await mf_product_service.get_by_id(input.mf_product_id);
            if (!product) {
                throw new AppError("Fund not found in the catalogue", 404, "MF_PRODUCT_NOT_FOUND");
            }

            const { mf_product_id, ...rest } = input;
            const resolved_input: ResolvedMfPurchaseInput = { ...rest, scheme: product.isin };

            logger.info("Creating MF purchase", { user_id, scheme: product.isin, amount: input.amount });

            // Per-fund limits before the FP call - a clean 400 beats a 502 out of FP.
            // No-op until the scheme-plan sync populates MfSchemePlan for this fund.
            await mf_threshold_validation_service.validate_lumpsum(product.isin, input.amount);

            const purchase = await fintech_primitive_mf_purchase_service.create_purchase(resolved_input, user.investment_account, user_ip);

            if (!purchase?.id) {
                logger.error("FP mf_purchase response missing id ==> ", purchase);
                throw new AppError("Failed to create MF purchase", 502, "MF_PURCHASE_CREATE_FAILED");
            }

            const saved = await mf_transaction_plan_service.upsert_from_fp(user_id, "PURCHASE", purchase, false);

            res.status(200).json({
                success: true,
                message: "MF purchase created",
                data: {
                    fp_id: saved.fp_id,
                    user_id: saved.user_id,
                    plan_type: saved.plan_type,
                    systematic: saved.systematic,
                    mf_investment_account: saved.mf_investment_account,
                    fp_payment_id: saved.fp_payment_id,
                    fp_created_at: saved.fp_created_at,
                    scheduled_on: purchase.scheduled_on,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in create_purchase controller:", error);
            next(error);
            return;
        }
    }

    /** Polls FP for the order's current state (under_review -> pending | failed) and syncs our row. */
    fetch_purchase = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_id = req.params.id as string;

            logger.info("Fetching MF purchase status", { user_id, fp_id });

            const existing = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_id);
            if (!existing) {
                throw new AppError("MF purchase not found", 404, "MF_PURCHASE_NOT_FOUND");
            }

            const purchase = await fintech_primitive_mf_purchase_service.get_purchase(fp_id);
            const updated = await mf_transaction_plan_service.upsert_from_fp(user_id, "PURCHASE", purchase, false);

            res.status(200).json({
                success: true,
                message: "MF purchase fetched",
                data: updated
            });
            return;
        } catch (error) {
            logger.error("Error in fetch_purchase controller:", error);
            next(error);
            return;
        }
    }

    /** Step 1 of confirming a pending order - send the OTP to the user's own phone. */
    request_confirmation_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_id = req.params.id as string;

            const purchase = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_id);
            if (!purchase) {
                throw new AppError("MF purchase not found", 404, "MF_PURCHASE_NOT_FOUND");
            }
            // PENDING, not REVIEW_COMPLETED - that's the plan-family equivalent of this state.
            if (purchase.state !== "PENDING") {
                throw new AppError(`Order must be in pending state to confirm, currently ${purchase.state}`, 400, "MF_PURCHASE_NOT_PENDING");
            }

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.phone_no) {
                throw new AppError("User has no verified phone number on file", 400, "USER_PHONE_MISSING");
            }

            logger.info("Requesting MF purchase confirmation OTP", { user_id, fp_id });

            await plan_confirmation_otp_service.request_otp(user_id, fp_id, user.phone_no);

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
     * Step 2 - verify our OTP, then walk FP's three-call confirm sequence:
     *   PATCH consent  ->  POST payment  ->  PATCH state: "confirmed"
     * and hand the payment URL back for the webview.
     *
     * Each step is skipped if already done (consent_given_at / fp_payment_id), so a retry after a
     * mid-sequence failure resumes instead of re-sending immutable consent or charging twice.
     */
    verify_confirmation_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const fp_id = req.params.id as string;
            const { otp, payment_postback_url } = verify_purchase_confirmation_otp_schema.parse(req.body);

            const purchase = await mf_transaction_plan_service.get_by_fp_id(user_id, fp_id);
            if (!purchase) {
                throw new AppError("MF purchase not found", 404, "MF_PURCHASE_NOT_FOUND");
            }

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.email || !user?.phone_no) {
                throw new AppError("User email and phone number are required to confirm", 400, "USER_CONTACT_INFO_MISSING");
            }

            logger.info("Verifying MF purchase confirmation OTP", { user_id, fp_id });

            await plan_confirmation_otp_service.verify_otp(user_id, fp_id, otp);

            // 1. Consent - immutable on FP's side once set, so never re-send it on a retry.
            if (!purchase.consent_given_at) {
                await fintech_primitive_mf_purchase_service.update_purchase(fp_id, {
                    consent: {
                        email: user.email,
                        isd_code: "91",
                        mobile: user.phone_no,
                    },
                });
                await mf_transaction_plan_service.mark_consent_given(purchase.id);
            }

            logger.debug(`Consent is updated for the mf purchase --> ${purchase.fp_id}`)

            // 2. Payment. The /api/pg surface wants numeric old_ids on both sides - the order's
            // own old_id, and the bank account's (the same one mandates are created against).
            let fp_payment_id = purchase.fp_payment_id;
            let payment: any = null;

            if (!fp_payment_id) {
                if (!purchase.fp_old_id) {
                    logger.error("MF purchase has no fp_old_id, cannot create payment", { fp_id });
                    throw new AppError("Order is missing its numeric id - re-sync it before confirming", 409, "MF_PURCHASE_OLD_ID_MISSING");
                }

                const primary_bank = await user_bank_details_service.get_primary(user_id);
                if (!primary_bank?.fp_bank_account_old_id) {
                    throw new AppError("No FP-registered bank account found - complete the profile stage first", 400, "FP_BANK_ACCOUNT_MISSING");
                }

                payment = await fintech_primitive_payment_service.create_payment({
                    amc_order_ids: [purchase.fp_old_id],
                    bank_account_id: primary_bank.fp_bank_account_old_id,
                    payment_postback_url,
                });

                if (!payment?.id) {
                    logger.error("FP payment response missing id ==> ", payment);
                    throw new AppError("Failed to create payment", 502, "PAYMENT_CREATE_FAILED");
                }

                fp_payment_id = String(payment.id);
                await mf_transaction_plan_service.set_payment_id(purchase.id, fp_payment_id);
            }

            // 3. Only now can the order move to confirmed.
            const confirmed = await fintech_primitive_mf_purchase_service.update_purchase(fp_id, { state: "confirmed" });
            const updated = await mf_transaction_plan_service.upsert_from_fp(user_id, "PURCHASE", confirmed, false);

            res.status(200).json({
                success: true,
                message: "MF purchase confirmed",
                data: {
                    payment_id: fp_payment_id,
                    // Present only on the run that actually created the payment - a resumed retry
                    // has no fresh URL to hand back, since FP returns it once.
                    payment_url: payment?.token_url ?? payment?.payment_url ?? null,
                    purchase: updated,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in verify_confirmation_otp controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_purchase_controller = new MfPurchaseControllerClass();
