import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

// Thin FP client. email/belongs_to are immutable once set (per docs).
class FintechPrimitiveEmailAddressServiceClass {

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

    /** POST /v2/email_addresses */
    create_email_address = async (profile_id: string, email: string, belongs_to: string = "self") => {
        const payload = { profile: profile_id, email, belongs_to };

        logger.debug("Creating FP email_address", { profile_id });

        try {
            const response = await axios.post(`${this.base_url}/v2/email_addresses`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP email_address create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP email_address ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to register email address", 502, "FP_EMAIL_ADDRESS_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_email_address_service = new FintechPrimitiveEmailAddressServiceClass();
