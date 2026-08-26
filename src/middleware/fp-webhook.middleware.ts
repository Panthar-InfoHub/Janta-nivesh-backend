import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import AppError from "./error.middleware.js";
import logger from "./logger.js";
import { env } from "../lib/config-env.js";

export const verify_fp_webhook_signature = (
    req: Request,
    _res: Response,
    next: NextFunction,
) => {
    try {
        const fp_signature = req.headers["fp-signature"];

        if (!fp_signature || Array.isArray(fp_signature)) {
            throw new AppError(
                "Missing FP webhook signature",
                401,
                "FP_WEBHOOK_SIGNATURE_MISSING",
            );
        }

        if (!env.FINTECH_PRIMITIVE_WEBHOOK_SECRET) {
            logger.error("FP webhook secret is not configured");

            throw new AppError(
                "FP webhook verification is not configured",
                500,
                "FP_WEBHOOK_SECRET_MISSING",
            );
        }

        const separator_index = fp_signature.indexOf(":");

        if (separator_index === -1) {
            throw new AppError(
                "Invalid FP webhook signature format",
                401,
                "FP_WEBHOOK_SIGNATURE_INVALID",
            );
        }

        const signature = fp_signature.slice(separator_index + 1);

        if (!signature) {
            throw new AppError(
                "Invalid FP webhook signature",
                401,
                "FP_WEBHOOK_SIGNATURE_INVALID",
            );
        }

        const signed_payload = JSON.stringify(req.body);

        const expected_signature = crypto
            .createHmac(
                "sha256",
                env.FINTECH_PRIMITIVE_WEBHOOK_SECRET,
            )
            .update(signed_payload)
            .digest("base64");

        const expected_buffer = Buffer.from(expected_signature);
        const received_buffer = Buffer.from(signature);

        if (
            expected_buffer.length !== received_buffer.length ||
            !crypto.timingSafeEqual(
                expected_buffer,
                received_buffer,
            )
        ) {
            logger.warn("FP webhook signature verification failed");

            throw new AppError(
                "Invalid FP webhook signature",
                401,
                "FP_WEBHOOK_SIGNATURE_INVALID",
            );
        }

        next();
    } catch (error) {
        next(error);
    }
};