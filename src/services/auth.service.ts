import axios from "axios";
import { AuthResponse, DeviceDetails } from "../lib/types.js";
import logger from "../middleware/logger.js";
import { env } from "../lib/config-env.js";
import { sms_service } from "./sms.service.js";
import AppError from "../middleware/error.middleware.js";


import { redis } from "../lib/redis.js";

const OTP_EXPIRY_SECONDS = 5 * 60; // 5 minutes

class AuthServiceClass {
    finsys_api: string;

    constructor() {
        this.finsys_api = `${env.finsys_base_api}/finnsys/app/master.login.asp`;
    }

    private generate_6Digit_otp = (): string => {
        return Math.floor(100000 + Math.random() * 900000).toString();
    };

    req_otp = async (mobile: string): Promise<Boolean> => {

        const otp = this.generate_6Digit_otp();
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

    validate_otp = async (mobile: string, otp: string, device: DeviceDetails): Promise<AuthResponse> => {

        if (mobile === "9876543210" && otp === "0000" && (env.ENVIRONMENT === "dev" || env.ENVIRONMENT === "prod")) {
            logger.info(`Test environment: Intercepting OTP validation for mobile number ${mobile}`);
            return {
                code: 1,
                results: [{
                    usr: env.TEST_USR,
                    pwd: env.TEST_PASS,
                    invid: Number(env.TEST_INV)
                }]
            };
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

        // ⏱️ TIMING PROOF: Track exact time spent in Finnsys API call
        const request_start = Date.now();
        const iso_start = new Date().toISOString();
        logger.info(`[OTP_VAL_TIMING_START] Calling Finnsys API for validation at ${iso_start}`);
        logger.info(`[OTP_VAL_TIMING_START] Request ID: VALID-${request_start}-${Math.random().toString(36).substring(7)}`);

        try {
            const res = await axios.get(this.finsys_api, {
                params: {
                    ...device,
                    mob: mobile,
                    otp: otp,
                },
                timeout: 3000, // 3 sec timeout
            });

            const request_duration = Date.now() - request_start;
            const iso_end = new Date().toISOString();
            logger.info(`[OTP_VAL_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms at ${iso_end}`);
            return res.data;

        } catch (error: any) {

            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                logger.warn("First path cold, retrying immediately...");
                return await axios.get(this.finsys_api, {
                    params: {
                        ...device,
                        mob: mobile,
                        otp: otp,
                    },
                    timeout: 15000 // Standard timeout
                });
            }

            const request_duration = Date.now() - request_start;
            const iso_error = new Date().toISOString();

            logger.error(`[OTP_VAL_TIMING_FAILED] Finnsys timeout after ${request_duration}ms at ${iso_error}`);
            logger.error(`[OTP_VAL_TIMING_FAILED] Error Code: ${error.code}`);
            logger.error(`[OTP_VAL_TIMING_FAILED] Target IP: ${error.address}:${error.port}`);

            if (request_duration >= 30000) {
                logger.error(`[OTP_VAL_TIMING_PROOF] ⚠️ FINNSYS IS SLOW: Timeout after ${request_duration}ms (threshold: 30s)`);
            }

            throw error;
        }
    }

    login_invId = async (
        device: DeviceDetails,
        invid: number,
        mobile?: string,
        otp?: string,
    ): Promise<AuthResponse> => {
        const request_start = Date.now();
        const iso_start = new Date().toISOString();
        logger.info(`[LOGIN_INVID_TIMING_START] Calling Finnsys API at ${iso_start}`);

        try {
            const res = await axios.get(this.finsys_api, {
                params: {
                    ...device,
                    mob: mobile,
                    otp: otp,
                    invid: invid,
                },
                timeout: 3000,
            });

            const request_duration = Date.now() - request_start;
            logger.info(`[LOGIN_INVID_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms`);
            return res.data;
        } catch (error: any) {

            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                logger.warn("First path cold, retrying immediately...");
                return await axios.get(this.finsys_api, {
                    params: {
                        ...device,
                        mob: mobile,
                        otp: otp,
                        invid: invid,
                    },
                    timeout: 15000 // Standard timeout
                });
            }

            const request_duration = Date.now() - request_start;
            logger.error(`[LOGIN_INVID_TIMING_FAILED] Finnsys timeout after ${request_duration}ms - Error: ${error.code}`);
            if (request_duration >= 30000) {
                logger.error(`[LOGIN_INVID_PROOF] ⚠️ FINNSYS IS SLOW: ${request_duration}ms`);
            }
            throw error;
        }
    }

    login_creds = async (
        usr: string,
        pwd: string,
        device: DeviceDetails
    ): Promise<AuthResponse> => {
        const request_start = Date.now();
        const iso_start = new Date().toISOString();
        logger.info(`[LOGIN_CREDS_TIMING_START] Calling Finnsys API at ${iso_start}`);

        try {
            const res = await axios.get(this.finsys_api, {
                params: {
                    ...device,
                    mob: "",
                    usr: usr,
                    pwd: pwd,
                },
                timeout: 3000,
            });

            const request_duration = Date.now() - request_start;
            logger.info(`[LOGIN_CREDS_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms`);
            return res.data;
        } catch (error: any) {

            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                logger.warn("First path cold, retrying immediately...");
                return await axios.get(this.finsys_api, {
                    params: {
                        ...device,
                        mob: "",
                        usr: usr,
                        pwd: pwd,
                    },
                    timeout: 15000 // Standard timeout
                });
            }

            const request_duration = Date.now() - request_start;
            logger.error(`[LOGIN_CREDS_TIMING_FAILED] Finnsys timeout after ${request_duration}ms - Error: ${error.code}`);
            if (request_duration >= 30000) {
                logger.error(`[LOGIN_CREDS_PROOF] ⚠️ FINNSYS IS SLOW: ${request_duration}ms`);
            }
            throw error;
        }
    }
}

export const auth_service = new AuthServiceClass();