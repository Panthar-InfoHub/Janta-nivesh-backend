import { NextFunction, Request, Response } from "express";
import { isIPv4 } from "net";

import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";

import {
    create_mf_redemption_schema,
    verify_redemption_confirmation_otp_schema,
    type ResolvedMfRedemptionInput,
} from "../lib/zod-schemas/mf-redemption.schema.js";

import { fintech_primitive_mf_redemption_service } from "../services/fintech-primitive/mf_redemption.service.js";
import { mf_transaction_plan_service } from "../services/mf-transaction-plan.service.js";
import { mf_threshold_validation_service } from "../services/mutual-funds/mf-threshold-validation.service.js";
import { mf_product_service } from "../services/mutual-funds/mf-product.service.js";
import { plan_confirmation_otp_service } from "../services/plan-confirmation-otp.service.js";
import { user_service } from "../services/user.service.js";

class MfRedemptionControllerClass {

    create_redemption = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id!;

            const input = create_mf_redemption_schema.parse(req.body);

            const raw_ip =
                req.headers["x-forwarded-for"] ||
                req.ip ||
                req.socket.remoteAddress ||
                "127.0.0.1";

            let user_ip = (
                Array.isArray(raw_ip) ? raw_ip[0] : raw_ip
            )
                .split(",")[0]
                .replace("::ffff:", "")
                .trim();

            if (!isIPv4(user_ip)) {
                user_ip = "127.0.0.1";
            }

            const user = await user_service.get_user_by_id(user_id);

            if (!user?.investment_account) {
                throw new AppError(
                    "Investment account not set up yet - complete the profile stage first",
                    400,
                    "INVESTMENT_ACCOUNT_MISSING",
                );
            }

            const product = await mf_product_service.get_by_id(
                input.mf_product_id,
            );

            if (!product) {
                throw new AppError(
                    "Fund not found in the catalogue",
                    404,
                    "MF_PRODUCT_NOT_FOUND",
                );
            }

            if (!input.folio_number) {
                throw new AppError(
                    "Folio number is required for redemption",
                    400,
                    "FOLIO_NUMBER_REQUIRED",
                );
            }

            const { mf_product_id, ...rest } = input;

            const resolved_input: ResolvedMfRedemptionInput = {
                ...rest,
                scheme: product.isin,
            };

            if (resolved_input.amount !== undefined) {
                await mf_threshold_validation_service.validate_redemption(
                    product.isin,
                    resolved_input.amount,
                );
            }

            logger.info("Creating MF redemption", {
                user_id,
                scheme: product.isin,
                folio_number: resolved_input.folio_number,
                amount: resolved_input.amount,
                units: resolved_input.units,
            });

            const redemption =
                await fintech_primitive_mf_redemption_service.create_redemption(
                    resolved_input,
                    user.investment_account,
                    user_ip,
                );

            if (!redemption?.id) {
                logger.error(
                    "FP mf_redemption response missing id ==> ",
                    redemption,
                );

                throw new AppError(
                    "Failed to create MF redemption",
                    502,
                    "MF_REDEMPTION_CREATE_FAILED",
                );
            }

            const saved =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "REDEMPTION",
                    redemption,
                    false,
                );

            res.status(200).json({
                success: true,
                message: "MF redemption created",
                data: {
                    fp_id: saved.fp_id,
                    user_id: saved.user_id,
                    plan_type: saved.plan_type,
                    systematic: saved.systematic,
                    mf_investment_account:
                        saved.mf_investment_account,
                    scheme: saved.scheme,
                    folio_number: saved.folio_number,
                    amount: saved.amount,
                    units: saved.units,
                    state: saved.state,
                    fp_created_at: saved.fp_created_at,
                },
            });

            return;
        } catch (error) {
            logger.error(
                "Error in create_redemption controller:",
                error,
            );

            next(error);
            return;
        }
    };

    fetch_redemption = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id!;
            const fp_id = req.params.id as string;

            const existing =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_id,
                );

            if (!existing) {
                throw new AppError(
                    "MF redemption not found",
                    404,
                    "MF_REDEMPTION_NOT_FOUND",
                );
            }

            if (
                existing.plan_type !== "REDEMPTION" ||
                existing.systematic
            ) {
                throw new AppError(
                    "Transaction is not a one-shot redemption",
                    400,
                    "MF_REDEMPTION_NOT_ALLOWED",
                );
            }

            const redemption =
                await fintech_primitive_mf_redemption_service.get_redemption(
                    fp_id,
                );

            const updated =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "REDEMPTION",
                    redemption,
                    false,
                );

            res.status(200).json({
                success: true,
                message: "MF redemption fetched",
                data: updated,
            });

            return;
        } catch (error) {
            logger.error(
                "Error in fetch_redemption controller:",
                error,
            );

            next(error);
            return;
        }
    };

    request_confirmation_otp = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id!;
            const fp_id = req.params.id as string;

            const redemption =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_id,
                );

            if (!redemption) {
                throw new AppError(
                    "MF redemption not found",
                    404,
                    "MF_REDEMPTION_NOT_FOUND",
                );
            }

            if (
                redemption.plan_type !== "REDEMPTION" ||
                redemption.systematic
            ) {
                throw new AppError(
                    "Transaction is not a one-shot redemption",
                    400,
                    "MF_REDEMPTION_NOT_ALLOWED",
                );
            }

            if (redemption.state !== "PENDING") {
                throw new AppError(
                    `Redemption must be in pending state to confirm, currently ${redemption.state}`,
                    400,
                    "MF_REDEMPTION_NOT_PENDING",
                );
            }

            const user =
                await user_service.get_user_by_id(user_id);

            if (!user?.phone_no) {
                throw new AppError(
                    "User has no verified phone number on file",
                    400,
                    "USER_PHONE_MISSING",
                );
            }

            await plan_confirmation_otp_service.request_otp(
                user_id,
                fp_id,
                user.phone_no,
            );

            res.status(200).json({
                success: true,
                message: "OTP sent",
                data: null,
            });

            return;
        } catch (error) {
            logger.error(
                "Error in redemption request_confirmation_otp controller:",
                error,
            );

            next(error);
            return;
        }
    };

    verify_confirmation_otp = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id!;
            const fp_id = req.params.id as string;

            const { otp } =
                verify_redemption_confirmation_otp_schema.parse(
                    req.body,
                );

            const redemption =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_id,
                );

            if (!redemption) {
                throw new AppError(
                    "MF redemption not found",
                    404,
                    "MF_REDEMPTION_NOT_FOUND",
                );
            }

            if (
                redemption.plan_type !== "REDEMPTION" ||
                redemption.systematic
            ) {
                throw new AppError(
                    "Transaction is not a one-shot redemption",
                    400,
                    "MF_REDEMPTION_NOT_ALLOWED",
                );
            }

            if (redemption.state !== "PENDING") {
                throw new AppError(
                    `Redemption must be in pending state to confirm, currently ${redemption.state}`,
                    400,
                    "MF_REDEMPTION_NOT_PENDING",
                );
            }

            const user =
                await user_service.get_user_by_id(user_id);

            if (!user?.email || !user?.phone_no) {
                throw new AppError(
                    "User email and phone number are required to confirm",
                    400,
                    "USER_CONTACT_INFO_MISSING",
                );
            }

            await plan_confirmation_otp_service.verify_otp(
                user_id,
                fp_id,
                otp,
            );

            const confirmed =
                await fintech_primitive_mf_redemption_service.confirm_redemption(
                    fp_id,
                    {
                        email: user.email,
                        isd_code: "91",
                        mobile: user.phone_no,
                    },
                );

            const updated =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "REDEMPTION",
                    confirmed,
                    false,
                );

            await mf_transaction_plan_service.mark_consent_given(
                updated.id,
            );

            res.status(200).json({
                success: true,
                message: "MF redemption confirmed",
                data: updated,
            });

            return;
        } catch (error) {
            logger.error(
                "Error in redemption verify_confirmation_otp controller:",
                error,
            );

            next(error);
            return;
        }
    };
}

export const mf_redemption_controller =
    new MfRedemptionControllerClass();