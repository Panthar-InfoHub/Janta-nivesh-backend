import { redis } from "../lib/redis.js";
import { sms_service } from "./sms.service.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";

const OTP_EXPIRY_SECONDS = 5 * 60;

// Separate from auth_service's login OTP on purpose - this one gates confirming a specific
// transaction plan, not a session. Redis key is scoped per (user, plan), not per phone number,
// so different plans for the same user get independent OTPs.
class PlanConfirmationOtpServiceClass {

    private generate_6Digit_otp = (): string => {
        return Math.floor(100000 + Math.random() * 900000).toString();
    };

    private redis_key = (user_id: string, fp_plan_id: string) => `plan_confirm_otp:${user_id}:${fp_plan_id}`;

    /** Send confirmation OTP for Mutual Fund Purchase (Lumpsum, SIP, Cart checkout) */
    request_purchase_otp = async (user_id: string, fp_plan_id: string, phone_no: string): Promise<boolean> => {
        const otp = this.generate_6Digit_otp();
        const formatted_phone = sms_service.format_phone_no(phone_no);

        logger.debug("Requesting plan purchase confirmation OTP", { user_id, fp_plan_id });

        const sent = await sms_service.send_purchase_otp_sms(formatted_phone, otp);
        if (!sent) {
            logger.error("Failed to send purchase confirmation OTP", { user_id, fp_plan_id });
            throw new AppError("Failed to send OTP", 500, "OTP_SEND_FAILED");
        }

        await redis.set(this.redis_key(user_id, fp_plan_id), otp, { EX: OTP_EXPIRY_SECONDS });
        return true;
    };

    /** Send confirmation OTP for Mutual Fund Redemption (One-shot, SWP, Switch) */
    request_redemption_otp = async (user_id: string, fp_plan_id: string, phone_no: string): Promise<boolean> => {
        const otp = this.generate_6Digit_otp();
        const formatted_phone = sms_service.format_phone_no(phone_no);

        logger.debug("Requesting plan redemption confirmation OTP", { user_id, fp_plan_id });

        const sent = await sms_service.send_redemption_otp_sms(formatted_phone, otp);
        if (!sent) {
            logger.error("Failed to send redemption confirmation OTP", { user_id, fp_plan_id });
            throw new AppError("Failed to send OTP", 500, "OTP_SEND_FAILED");
        }

        await redis.set(this.redis_key(user_id, fp_plan_id), otp, { EX: OTP_EXPIRY_SECONDS });
        return true;
    };

    /** Generic fallback: auto-detects by fp_plan_id prefix */
    request_otp = async (user_id: string, fp_plan_id: string, phone_no: string): Promise<boolean> => {
        const isRedemption = fp_plan_id.startsWith("mfr_") || fp_plan_id.startsWith("mfrp_") || fp_plan_id.startsWith("mfs_") || fp_plan_id.startsWith("mfsp_");
        if (isRedemption) {
            return this.request_redemption_otp(user_id, fp_plan_id, phone_no);
        }
        return this.request_purchase_otp(user_id, fp_plan_id, phone_no);
    };

    verify_otp = async (user_id: string, fp_plan_id: string, otp: string): Promise<boolean> => {
        const redis_key = this.redis_key(user_id, fp_plan_id);
        const stored_otp = await redis.get(redis_key);

        if (!stored_otp) {
            logger.warn("Plan confirmation OTP expired or never requested", { user_id, fp_plan_id });
            throw new AppError("OTP has expired or was not requested", 400, "OTP_EXPIRED");
        }

        if (stored_otp !== otp) {
            logger.warn("Incorrect plan confirmation OTP", { user_id, fp_plan_id });
            throw new AppError("Invalid OTP", 400, "INVALID_OTP");
        }

        await redis.del(redis_key); // one-time use
        return true;
    }
}

export const plan_confirmation_otp_service = new PlanConfirmationOtpServiceClass();
