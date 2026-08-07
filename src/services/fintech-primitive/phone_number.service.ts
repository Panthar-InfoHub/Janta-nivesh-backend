import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

// Thin FP client. isd/number/belongs_to are immutable once set (per docs).
class FintechPrimitivePhoneNumberServiceClass {

    private base_url: string;

    constructor() {
        this.base_url = env.FINTECH_PRIMITIVE_API_BASE_URL;
    }

    private async auth_headers(extra: Record<string, string> = {}) {
        const token = await provider_token_service.get_fintech_primitive_token();
        return {
            Authorization: `Bearer ${token}`,
            "x-tenant-id": env.FINTECH_PRIMITIVE_TENANT_ID,
            ...extra,
        };
    }

    /** POST /v2/phone_numbers */
    create_phone_number = async (profile_id: string, isd: string, number: string, belongs_to: string = "self") => {
        const payload = { profile: profile_id, isd, number, belongs_to };

        logger.debug("Creating FP phone_number", { profile_id });

        try {
            const response = await axios.post(`${this.base_url}/v2/phone_numbers`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP phone_number create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP phone_number ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to register phone number", 502, "FP_PHONE_NUMBER_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_phone_number_service = new FintechPrimitivePhoneNumberServiceClass();
