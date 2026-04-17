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

        const res = await axios.get(this.finsys_api, {
            params: {
                ...device,
                mob: mobile,
            },
        });

        logger.debug("OTP Request Response:", res.data);
        return res.data;
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

        const res = await axios.get(this.finsys_api, {
            params: {
                ...device,
                mob: mobile,
                otp: otp,
            },
        });
        logger.debug("OTP Validation Response:", res.data);
        return res.data;
    }

    login_invId = async (
        device: DeviceDetails,
        invid: number,
        mobile?: string,
        otp?: string,
    ): Promise<AuthResponse> => {
        const res = await axios.get(this.finsys_api, {
            params: {
                ...device,
                mob: mobile,
                otp: otp,
                invid: invid,
            },
        });
        return res.data;
    }

    login_creds = async (
        usr: string,
        pwd: string,
        device: DeviceDetails
    ): Promise<AuthResponse> => {
        const res = await axios.get(this.finsys_api, {
            params: {
                ...device,
                mob: "",
                usr: usr,
                pwd: pwd,
            },
        });
        return res.data;
    }
}

export const auth_service = new AuthServiceClass();