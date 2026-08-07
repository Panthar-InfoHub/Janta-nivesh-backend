import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

type CreateAddressInput = {
    line1: string;
    line2?: string;
    line3?: string;
    city?: string;
    state?: string;
    postal_code: string;
    country: string;
    nature?: "residential" | "business_location";
};

// Thin FP client. All fields except `nature` are immutable once set on FP's side (per docs).
class FintechPrimitiveAddressServiceClass {

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

    /** POST /v2/addresses */
    create_address = async (profile_id: string, input: CreateAddressInput) => {
        const payload = { profile: profile_id, ...input };

        logger.debug("Creating FP address", { profile_id });

        try {
            const response = await axios.post(`${this.base_url}/v2/addresses`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP address create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP address ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to register address", 502, "FP_ADDRESS_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_address_service = new FintechPrimitiveAddressServiceClass();
