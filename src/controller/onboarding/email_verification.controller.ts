import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { email_otp_request_schema, email_otp_verify_schema } from "../../lib/zod-schemas/kyc-onboarding.schema.js";
import { email_otp_service } from "../../services/email-otp.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";

class EmailVerificationControllerClass {

    /**
     * Email stage, step 1: send an OTP to the address the user typed on the profile screen.
     * Nothing is persisted here - the address sits in Redis alongside the OTP until it's proven,
     * because User.email is @unique and blind-indexed (see email-otp.service.ts).
     */
    request_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const { email } = email_otp_request_schema.parse(req.body);

            const onboarding = await user_onboarding_service.get_or_create(user_id);
            if (onboarding.email_status === "VERIFIED") {
                throw new AppError("Email is already verified", 400, "EMAIL_ALREADY_VERIFIED");
            }

            // Fail here rather than on a raw P2002 after the user has already typed the OTP.
            // The lookup runs against ciphertext - extended-db rewrites `email` to `email_hash`.
            const existing = await user_service.get_user_by_email(email);
            if (existing && existing.id !== user_id) {
                throw new AppError("This email is already in use", 409, "EMAIL_ALREADY_IN_USE");
            }

            const user = await user_service.get_user_by_id(user_id);

            logger.info("Sending email verification OTP", { user_id });

            await email_otp_service.request_otp(user_id, email, user?.full_name ?? undefined);

            await user_onboarding_service.update_stage(user_id, {
                email_status: "IN_PROGRESS",
                current_stage: "EMAIL_VERIFICATION",
            });

            res.status(200).json({
                success: true,
                message: "OTP sent to your email",
                data: { onboarding: await user_onboarding_service.get_status_summary(user_id) }
            });
            return;
        } catch (error) {
            logger.error("Error in request_otp controller:", error);
            next(error);
            return;
        }
    }

    /**
     * Email stage, step 2: check the OTP and promote the pending address to User.email.
     * Only once this lands does the profile stage stop rejecting with EMAIL_VERIFICATION_REQUIRED.
     */
    verify_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const { otp } = email_otp_verify_schema.parse(req.body);

            const email = await email_otp_service.verify_otp(user_id, otp);

            logger.info("Email verified, saving to user", { user_id });

            await user_service.update_user(user_id, { email });

            await user_onboarding_service.update_stage(user_id, {
                email_status: "VERIFIED",
                current_stage: "INVESTOR_PROFILE",
            });
            await user_onboarding_service.recompute_completion(user_id);

            res.status(200).json({
                success: true,
                message: "Email verified",
                data: {
                    email,
                    onboarding: await user_onboarding_service.get_status_summary(user_id),
                }
            });
            return;
        } catch (error) {
            logger.error("Error in verify_otp controller:", error);
            next(error);
            return;
        }
    }
}

export const email_verification_controller = new EmailVerificationControllerClass();
