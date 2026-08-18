import { redis } from "../lib/redis.js";
import { email_service } from "./email.service.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";

const OTP_EXPIRY_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

type EmailOtpPayload = {
    email: string;
    otp: string;
    attempts: number;
};

// Gates the onboarding email stage. Unlike auth_service's login OTP (phone, keyed per number)
// and plan_confirmation_otp_service (keyed per user+plan), this one is keyed per user only -
// a user has exactly one email verification in flight at a time.
//
// The pending address lives in this Redis payload rather than the DB on purpose: User.email is
// @unique and blind-indexed, so parking an unverified address there would burn the unique slot
// and pollute email_hash. It's only promoted to User.email once the OTP checks out.
class EmailOtpServiceClass {

    private generate_4Digit_otp = (): string => {
        return Math.floor(1000 + Math.random() * 9000).toString();
    };

    private redis_key = (user_id: string) => `email_otp:${user_id}`;
    private cooldown_key = (user_id: string) => `email_otp_cooldown:${user_id}`;

    /**
     * Sends an OTP to `email` and parks it against the user. Requesting again with a different
     * address just overwrites the payload, so a user who mistyped can correct it mid-flow.
     */
    request_otp = async (user_id: string, email: string, name?: string): Promise<boolean> => {
        const on_cooldown = await redis.get(this.cooldown_key(user_id));
        if (on_cooldown) {
            logger.warn("Email OTP requested while still on cooldown", { user_id });
            throw new AppError("Please wait before requesting another OTP", 429, "OTP_COOLDOWN_ACTIVE");
        }

        const otp = this.generate_4Digit_otp();

        logger.debug("Requesting email verification OTP", { user_id });

        // expiry_minutes is derived from the TTL below, not hardcoded - the email can never
        // promise a validity window that differs from the one Redis actually enforces.
        const sent = await email_service.send_otp_email(email, otp, OTP_EXPIRY_SECONDS / 60, name);
        if (!sent) {
            logger.error("Failed to send email verification OTP", { user_id });
            throw new AppError("Failed to send OTP", 500, "OTP_SEND_FAILED");
        }

        const payload: EmailOtpPayload = { email, otp, attempts: 0 };

        await redis.set(this.redis_key(user_id), JSON.stringify(payload), { EX: OTP_EXPIRY_SECONDS });
        await redis.set(this.cooldown_key(user_id), "1", { EX: RESEND_COOLDOWN_SECONDS });
        return true;
    }

    /**
     * Verifies the OTP and hands back the address it was sent to. Deliberately takes no email
     * argument - the address came from the request step and the server already knows it, so
     * accepting it here would let a caller verify one address and register another.
     */
    verify_otp = async (user_id: string, otp: string): Promise<string> => {
        const redis_key = this.redis_key(user_id);
        const stored = await redis.get(redis_key);

        if (!stored) {
            logger.warn("Email OTP expired or never requested", { user_id });
            throw new AppError("OTP has expired or was not requested", 400, "OTP_EXPIRED");
        }

        const payload: EmailOtpPayload = JSON.parse(stored as string);

        if (payload.otp !== otp) {
            const attempts = payload.attempts + 1;

            if (attempts >= MAX_ATTEMPTS) {
                logger.warn("Email OTP attempt limit reached, discarding OTP", { user_id, attempts });
                await redis.del(redis_key);
                throw new AppError("Too many incorrect attempts, request a new OTP", 400, "OTP_ATTEMPTS_EXCEEDED");
            }

            // KEEPTTL so a wrong guess doesn't extend the 5-minute window
            await redis.set(redis_key, JSON.stringify({ ...payload, attempts }), { KEEPTTL: true });
            logger.warn("Incorrect email OTP", { user_id, attempts });
            throw new AppError("Invalid OTP", 400, "INVALID_OTP");
        }

        await redis.del(redis_key); // one-time use
        return payload.email;
    }
}

export const email_otp_service = new EmailOtpServiceClass();
