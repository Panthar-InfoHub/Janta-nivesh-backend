import axios from "axios";
import { AuthResponse, DeviceDetails } from "../lib/types.js";
import logger from "../middleware/logger.js";
import { env } from "../lib/config-env.js";


class AuthServiceClass {
    finsys_api: string;

    constructor() {
        this.finsys_api = `${env.finsys_base_api}/finnsys/app/master.login.asp`;
    }

    req_otp = async (mobile: string, device: DeviceDetails): Promise<AuthResponse> => {

        if (mobile === "9876543210" && env.ENVIRONMENT === "dev") {
            logger.info(`Test environment: Intercepting OTP request for mobile number ${mobile}`);
            return { code: 1, results: [] };
        }

        // TIMING PROOF: Track exact time spent in Finnsys API call
        const request_start = Date.now();
        const iso_start = new Date().toISOString();
        logger.info(`[OTP_TIMING_START] Calling Finnsys API at ${iso_start}`);

        try {
            const res = await axios.get(this.finsys_api, {
                params: {
                    ...device,
                    mob: mobile,
                },
                timeout: 300000, //  5 min timeout 
            });

            const request_duration = Date.now() - request_start;
            const iso_end = new Date().toISOString();
            logger.info(`[OTP_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms at ${iso_end}`);
            logger.debug("OTP Request Response:", res.data);
            return res.data;

        } catch (error: any) {
            const request_duration = Date.now() - request_start;
            const iso_error = new Date().toISOString();

            // THIS IS THE PROOF: If duration >= 30000ms, Finnsys is slow
            logger.error(`[OTP_TIMING_FAILED] Finnsys timeout after ${request_duration}ms at ${iso_error}`);
            logger.error(`[OTP_TIMING_FAILED] Error Code: ${error.code}`);
            logger.error(`[OTP_TIMING_FAILED] Error Message: ${error.message}`);
            logger.error(`[OTP_TIMING_FAILED] Target IP: ${error.address}:${error.port}`);

            if (request_duration >= 30000) {
                logger.error(`[OTP_TIMING_PROOF] FINNSYS IS SLOW: Timeout after ${request_duration}ms (threshold: 30s)`);
            }

            throw error;
        }
    }

    validate_otp = async (mobile: string, otp: string, device: DeviceDetails): Promise<AuthResponse> => {

        if (mobile === "9876543210" && otp === "0000" && env.ENVIRONMENT === "dev") {
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
                timeout: 30000, // 30 second timeout
            });

            const request_duration = Date.now() - request_start;
            const iso_end = new Date().toISOString();
            logger.info(`[OTP_VAL_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms at ${iso_end}`);
            logger.debug("OTP Validation Response:", res.data);
            return res.data;

        } catch (error: any) {
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
                timeout: 30000,
            });

            const request_duration = Date.now() - request_start;
            logger.info(`[LOGIN_INVID_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms`);
            return res.data;
        } catch (error: any) {
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
                timeout: 30000,
            });

            const request_duration = Date.now() - request_start;
            logger.info(`[LOGIN_CREDS_TIMING_SUCCESS] Finnsys responded in ${request_duration}ms`);
            return res.data;
        } catch (error: any) {
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