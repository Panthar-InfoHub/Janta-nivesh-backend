import axios from "axios";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import cuid from "cuid";

// Central Server configuration with fallback
const DECENTRO_CENTRAL_SERVER_URL =
    process.env.DECENTRO_CENTRAL_SERVER_URL ||
    "https://decentro-central-proxy-prod-357888765640.asia-south1.run.app";

const DECENTRO_INTERNAL_SECRET = process.env.DECENTRO_INTERNAL_SECRET;

class DecentroServiceClass {
    /**
     * Fetch user address details from Decentro central server proxy
     * @param phone_number - Mobile number of the user (e.g. 10 digits)
     */
    get_address = async (phone_number: string) => {
        if (!phone_number) {
            throw new AppError("Phone number is required", 400, "PHONE_NUMBER_REQUIRED");
        }

        const clean_phone = phone_number.replace(/\D/g, "").slice(-10);
        if (!clean_phone || clean_phone.length !== 10) {
            throw new AppError(
                "Invalid phone number. A 10-digit mobile number is required.",
                400,
                "INVALID_PHONE_NUMBER"
            );
        }


        const payload = {
            consent: true,
            purpose: "To fetch users address details",
            mobile: clean_phone,
        };

        logger.info("Calling Decentro central server to fetch address", {
            mobile_number: clean_phone,
            url: `${DECENTRO_CENTRAL_SERVER_URL}/address`,
        });

        try {
            const response = await axios.post(
                `${DECENTRO_CENTRAL_SERVER_URL}/address`,
                payload,
                {
                    headers: {
                        "x-internal-secret": DECENTRO_INTERNAL_SECRET,
                        "Content-Type": "application/json",
                    },
                    timeout: 15000,
                }
            );

            logger.info(`Decentro central server address call success`, response.data)
            return response.data;
        } catch (error: any) {
            logger.error("Decentro central server address call failed", {
                error: error?.response?.data || error.message,
                status: error?.response?.status,
                mobile_number: clean_phone,
            });

            throw new AppError(
                error?.response?.data?.message ||
                error?.response?.data?.error ||
                "Failed to fetch address from Decentro",
                error?.response?.status || 502,
                "DECENTRO_ADDRESS_FETCH_FAILED"
            );
        }
    };
}

export const decentro_service = new DecentroServiceClass();
