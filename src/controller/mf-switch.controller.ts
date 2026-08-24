import { NextFunction, Request, Response } from "express";
import { isIPv4 } from "net";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import {
    create_mf_switch_schema,
    verify_switch_confirmation_otp_schema,
    type ResolvedMfSwitchInput,
} from "../lib/zod-schemas/mf-switch.schema.js";
import { fintech_primitive_mf_switch_service } from "../services/fintech-primitive/mf_switch.service.js";
import { mf_transaction_plan_service } from "../services/mf-transaction-plan.service.js";
import { mf_product_service } from "../services/mutual-funds/mf-product.service.js";
import { user_service } from "../services/user.service.js";
import { plan_confirmation_otp_service } from "../services/plan-confirmation-otp.service.js";
import { mf_threshold_validation_service } from "../services/mutual-funds/mf-threshold-validation.service.js";
class MfSwitchControllerClass {

    create_switch = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mf_switch_schema.parse(req.body);

            const raw_ip =
                req.headers["x-forwarded-for"] ||
                req.ip ||
                req.socket.remoteAddress ||
                "127.0.0.1";

            let user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip)
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

            if (
                input.source_mf_product_id ===
                input.destination_mf_product_id
            ) {
                throw new AppError(
                    "Source and destination schemes must be different",
                    400,
                    "MF_SWITCH_SAME_SCHEME",
                );
            }

            const source_product = await mf_product_service.get_by_id(
                input.source_mf_product_id,
            );

            if (!source_product) {
                throw new AppError(
                    "Source fund not found in the catalogue",
                    404,
                    "MF_SOURCE_PRODUCT_NOT_FOUND",
                );
            }

            const destination_product = await mf_product_service.get_by_id(
                input.destination_mf_product_id,
            );

            if (!destination_product) {
                throw new AppError(
                    "Destination fund not found in the catalogue",
                    404,
                    "MF_DESTINATION_PRODUCT_NOT_FOUND",
                );
            }

            if (input.amount !== undefined) {
                await mf_threshold_validation_service.validate_redemption(
                    source_product.isin,
                    input.amount,
                );
            }

            const resolved_input: ResolvedMfSwitchInput = {
                switch_out_scheme: source_product.isin,
                switch_in_scheme: destination_product.isin,
                folio_number: input.folio_number,
                amount: input.amount,
                units: input.units,
            };

            logger.info("Creating MF switch", {
                user_id,
                switch_out_scheme: source_product.isin,
                switch_in_scheme: destination_product.isin,
                folio_number: input.folio_number,
                amount: input.amount,
                units: input.units,
            });

            const switch_order =
                await fintech_primitive_mf_switch_service.create_switch(
                    resolved_input,
                    user.investment_account,
                    user_ip,
                );

            if (!switch_order?.id) {
                logger.error(
                    "FP mf_switch response missing id ==> ",
                    switch_order,
                );

                throw new AppError(
                    "Failed to create MF switch",
                    502,
                    "MF_SWITCH_CREATE_FAILED",
                );
            }

            const saved =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "SWITCH",
                    {
                        ...switch_order,
                        scheme: switch_order.switch_out_scheme,
                        switch_in_scheme: switch_order.switch_in_scheme,
                    },
                    false,
                );

            res.status(200).json({
                success: true,
                message: "MF switch created",
                data: saved,
            });

            return;
        } catch (error) {
            logger.error(
                "Error in create_switch controller:",
                error,
            );

            next(error);
            return;
        }
    };

    fetch_switch = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id!;
            const fp_switch_id = req.params.id as string;

            const existing =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_switch_id,
                );

            if (!existing) {
                throw new AppError(
                    "MF switch not found",
                    404,
                    "MF_SWITCH_NOT_FOUND",
                );
            }

            const switch_order =
                await fintech_primitive_mf_switch_service.get_switch(
                    fp_switch_id,
                );

            const updated =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "SWITCH",
                    {
                        ...switch_order,
                        scheme: switch_order.switch_out_scheme,
                        switch_in_scheme: switch_order.switch_in_scheme,
                    },
                    false,
                );

            res.status(200).json({
                success: true,
                message: "MF switch fetched",
                data: updated,
            });

            return;
        } catch (error) {
            logger.error(
                "Error in fetch_switch controller:",
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
            const fp_switch_id = req.params.id as string;

            const switch_order =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_switch_id,
                );

            if (!switch_order) {
                throw new AppError(
                    "MF switch not found",
                    404,
                    "MF_SWITCH_NOT_FOUND",
                );
            }

            // Immediate mf_switch orders are confirmed from PENDING state.
            if (switch_order.state !== "PENDING") {
                throw new AppError(
                    `Switch must be in pending state to confirm, currently ${switch_order.state}`,
                    400,
                    "MF_SWITCH_NOT_PENDING",
                );
            }

            const user = await user_service.get_user_by_id(user_id);

            if (!user?.phone_no) {
                throw new AppError(
                    "User phone number is required to confirm",
                    400,
                    "USER_PHONE_MISSING",
                );
            }

            await plan_confirmation_otp_service.request_otp(
                user_id,
                fp_switch_id,
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
                "Error in request_switch_confirmation_otp controller:",
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
            const fp_switch_id = req.params.id as string;

            const { otp } =
                verify_switch_confirmation_otp_schema.parse(
                    req.body,
                );

            const switch_order =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_switch_id,
                );

            if (!switch_order) {
                throw new AppError(
                    "MF switch not found",
                    404,
                    "MF_SWITCH_NOT_FOUND",
                );
            }

            if (switch_order.state !== "PENDING") {
                throw new AppError(
                    `Switch must be in pending state to confirm, currently ${switch_order.state}`,
                    400,
                    "MF_SWITCH_NOT_PENDING",
                );
            }

            const user = await user_service.get_user_by_id(user_id);

            if (!user?.email || !user?.phone_no) {
                throw new AppError(
                    "User email and phone number are required to confirm",
                    400,
                    "USER_CONTACT_INFO_MISSING",
                );
            }

            await plan_confirmation_otp_service.verify_otp(
                user_id,
                fp_switch_id,
                otp,
            );

            const confirmed =
                await fintech_primitive_mf_switch_service.update_switch(
                    fp_switch_id,
                    {
                        state: "confirmed",
                        consent: {
                            email: user.email,
                            isd_code: "91",
                            mobile: user.phone_no,
                        },
                    },
                );

            const updated =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "SWITCH",
                    {
                        ...confirmed,
                        scheme: confirmed.switch_out_scheme,
                        switch_in_scheme: confirmed.switch_in_scheme,
                    },
                    false,
                );

            await mf_transaction_plan_service.mark_consent_given(
                updated.id,
            );

            res.status(200).json({
                success: true,
                message: "MF switch confirmed",
                data: updated,
            });

            return;
        } catch (error) {
            logger.error(
                "Error in verify_switch_confirmation_otp controller:",
                error,
            );

            next(error);
            return;
        }
    };
}

export const mf_switch_controller =
    new MfSwitchControllerClass();