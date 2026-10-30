import logger from "../middleware/logger.js";
import { env } from "../lib/config-env.js";
import { sms_service } from "./sms.service.js";
import AppError from "../middleware/error.middleware.js";
import { redis } from "../lib/redis.js";

const OTP_EXPIRY_SECONDS = 10 * 60; // 10 minutes

class AuthServiceClass {

    private generate_4Digit_otp = (): string => {
        return Math.floor(1000 + Math.random() * 9000).toString();
    };

    req_otp = async (mobile: string): Promise<Boolean> => {

        const otp = this.generate_4Digit_otp();
        const formatted_phone = sms_service.format_phone_no(mobile);
        const redis_key = `otp:${formatted_phone}`;

        // These credentials is only for play store testing
        if (mobile === "9876543210" && (env.ENVIRONMENT === "dev" || env.ENVIRONMENT === "prod")) {
            logger.info(`Test environment: Intercepting OTP request for mobile number ${mobile}`);
            await redis.set(redis_key, "0000", { EX: OTP_EXPIRY_SECONDS });
            return true;
        }

        try {
            const res = await sms_service.send_otp_sms(formatted_phone, otp);

            logger.info("Otp response ==> ", res)

            if (!res) {
                logger.error(`Failed to send OTP to ${mobile} via MSG91`);
                throw new AppError("Failed to send OTP", 500, "OTP_SEND_FAILED");
            }

            // Save OTP in Redis with 5-minute expiration (TTL)
            await redis.set(redis_key, otp, { EX: OTP_EXPIRY_SECONDS });
            return true;

        } catch (error: any) {

            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                logger.warn("First path cold, retrying immediately...");
                const retry_res = await sms_service.send_otp_sms(formatted_phone, otp);
                if (retry_res) {
                    await redis.set(redis_key, otp, { EX: OTP_EXPIRY_SECONDS });
                }
                return retry_res;
            }
            throw error;
        }
    }

    validate_otp = async (mobile: string, otp: string): Promise<Boolean> => {
        try {

            if (mobile === "9876543210" && otp === "0000" && (env.ENVIRONMENT === "dev" || env.ENVIRONMENT === "prod")) {
                logger.info(`Test environment: Intercepting OTP validation for mobile number ${mobile}`);
                return true
            }

            const formatted_phone = sms_service.format_phone_no(mobile);
            const redis_key = `otp:${formatted_phone}`;

            // 1. Fetch OTP from Redis
            const stored_otp = await redis.get(redis_key);

            if (!stored_otp) {
                logger.warn(`OTP validation failed: Expired or non-existent OTP for mobile ${mobile}`);
                throw new AppError("OTP has expired or was not requested", 400, "OTP_EXPIRED");
            }

            if (stored_otp !== otp) {
                logger.warn(`OTP validation failed: Incorrect OTP provided for mobile ${mobile}`);
                throw new AppError("Invalid OTP", 400, "INVALID_OTP");
            }

            // 2. Clear OTP on successful validation (one-time use)
            await redis.del(redis_key);
            return true;
        } catch (error: any) {
            logger.error(`Auth Service Error --> `, error);
            return false;
        }
    }


}

export const auth_service = new AuthServiceClass();