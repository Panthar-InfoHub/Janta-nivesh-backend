import { rateLimit, Options as RateLimitOptions } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { Request, Response } from "express";
import { redis } from "../lib/redis.js";
import logger from "./logger.js";

/**
 * Factory to create RedisStore adapter with isolated namespace prefix
 */
const create_redis_store = (prefix: string) =>
    new RedisStore({
        sendCommand: (...args: string[]) => redis.sendCommand(args) as any,
        prefix: `rl:${prefix}:`,
    });

/**
 * Standard Velvet JSON response for rate limit violations
 */
const rate_limit_handler = (message: string) => {
    return (req: Request, res: Response, _next: any, options: RateLimitOptions) => {
        logger.warn(`Rate limit exceeded on [${req.method} ${req.originalUrl || req.url}] by IP: ${req.ip}`);
        res.status(options.statusCode || 429).json({
            success: false,
            message,
            data: null,
            errorCode: "RATE_LIMIT_EXCEEDED",
        });
    };
};

/**
 * Helper to extract phone number from common request shapes (query, body)
 */
const get_phone_from_req = (req: Request): string | undefined => {
    return (
        (req.query?.mob as string)
    );
};

/**
 * Tier 1: Global API Rate Limiter
 * Applied across all API routes to mitigate volumetric abuse, scrapers, and crawling.
 * Window: 10 minutes | Max: 300 requests per IP
 */
export const global_rate_limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: create_redis_store("global"),
    skip: (req) => {
        // Skip health checks and webhooks (webhooks have provider-specific signature verification)
        const path = req.originalUrl || req.url || "";
        return path.includes("/ping") || path.includes("/webhook");
    },
    handler: rate_limit_handler("Too many requests from this IP. Please try again in a few minutes."),
});

/**
 * Tier 2: Strict Login OTP Request Limiter
 * Applied to POST /api/v2/auth/req-otp to prevent SMS toll fraud / SMS pumping.
 * Window: 10 minutes | Max: 5 OTP requests per phone number (or IP fallback)
 */
export const auth_otp_rate_limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: create_redis_store("auth_otp"),
    keyGenerator: (req) => {
        const phone = get_phone_from_req(req);
        return phone ? `phone:${phone}` : `ip:${req.ip}`;
    },
    handler: rate_limit_handler("Too many OTP requests for this mobile number. Please wait 10 minutes before trying again."),
});

/**
 * Tier 2b: Login OTP Verification Limiter
 * Applied to POST /api/v2/auth/validate-otp to prevent brute-force attacks against 6-digit OTPs.
 * Window: 10 minutes | Max: 10 attempts per phone number (or IP fallback)
 */
export const auth_validate_otp_rate_limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: create_redis_store("auth_validate"),
    keyGenerator: (req) => {
        const phone = get_phone_from_req(req);
        return phone ? `phone:${phone}` : `ip:${req.ip}`;
    },
    handler: rate_limit_handler("Too many incorrect OTP attempts. Please wait 10 minutes before trying again."),
});

/**
 * Tier 2c: Plan Confirmation OTP Limiter
 * Applied to Mutual Fund confirmation OTP endpoints to prevent SMS pumping on orders.
 * Window: 5 minutes | Max: 10 requests per user (or IP fallback)
 */
export const plan_otp_rate_limiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: create_redis_store("plan_otp"),
    keyGenerator: (req) => {
        return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    },
    handler: rate_limit_handler("Too many confirmation OTP requests. Please wait a few minutes before trying again."),
});

/**
 * Tier 3: Sensitive Transaction Limiter
 * Applied to Order placement, Cart checkouts, and Payment initiation to prevent double-submits.
 * Window: 1 minute | Max: 10 requests per user (or IP fallback)
 */
export const transaction_rate_limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: create_redis_store("tx"),
    keyGenerator: (req) => {
        return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    },
    handler: rate_limit_handler("You are performing actions too quickly. Please wait a moment and try again."),
});

