import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

// Thin Fintech Primitives client - no DB writes here, controller orchestrates persistence.
// mandate_type/provider_name are hardcoded ("UPI"/"CYBRILLAPOA") - this app doesn't support
// E_MANDATE or any gateway other than ondc.
class FintechPrimitiveMandateServiceClass {

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

    /** POST /api/pg/mandates - creates the mandate, returns { id }. */
    create_mandate = async (input: { bank_account_id: number; mandate_limit: number; valid_from?: string; valid_to?: string; }) => {
        const payload = {
            mandate_type: "UPI",
            bank_account_id: input.bank_account_id,
            mandate_limit: input.mandate_limit,
            provider_name: "CYBRILLAPOA",
            ...(input.valid_from ? { valid_from: input.valid_from } : {}),
            ...(input.valid_to ? { valid_to: input.valid_to } : {}),
        };

        logger.debug("Creating FP mandate", { payload });

        try {
            const response = await axios.post(`${this.base_url}/api/pg/mandates`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mandate create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP mandate ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create mandate", 502, "MANDATE_CREATE_FAILED");
        }
    }

    /** GET /api/pg/mandates/:id - current mandate state (mandate_status, umrn, approved_at, rejected_reason, ...). */
    get_mandate = async (mandate_id: string | number) => {
        logger.debug("Fetching FP mandate", { mandate_id });

        try {
            const response = await axios.get(`${this.base_url}/api/pg/mandates/${mandate_id}`, {
                headers: await this.auth_headers(),
            });

            logger.debug("FP mandate fetch response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching FP mandate ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch mandate status", 502, "MANDATE_FETCH_FAILED");
        }
    }

    /** POST /api/pg/payments/emandate/auth - returns { token_url, id } - token_url opens in a webview for bank-side authorization. */
    authorize_mandate = async (mandate_id: number, payment_postback_url?: string) => {
        const payload = {
            mandate_id,
            ...(payment_postback_url ? { payment_postback_url } : {}),
        };

        logger.debug("Authorizing FP mandate", { mandate_id });

        try {
            const response = await axios.post(`${this.base_url}/api/pg/payments/emandate/auth`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mandate authorize response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error authorizing FP mandate ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to authorize mandate", 502, "MANDATE_AUTHORIZE_FAILED");
        }
    }
}

export const fintech_primitive_mandate_service = new FintechPrimitiveMandateServiceClass();
