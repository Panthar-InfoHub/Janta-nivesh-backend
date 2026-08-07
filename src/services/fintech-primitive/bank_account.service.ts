import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

// Thin FP client. All fields immutable once set (per docs). Response's `id` (bac_...) is what
// goes into investment_account.folio_defaults.payout_bank_account; `old_id` (numeric) is the
// separate id mandate creation's bank_account_id field wants - same object, two identifiers.
class FintechPrimitiveBankAccountServiceClass {

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

    /** POST /v2/bank_accounts */
    create_bank_account = async (profile_id: string, input: {
        primary_account_holder_name: string;
        account_number: string;
        type: "savings" | "current" | "nre" | "nro";
        ifsc_code: string;
    }) => {
        const payload = { profile: profile_id, ...input };

        logger.debug("Creating FP bank_account", { profile_id });

        try {
            const response = await axios.post(`${this.base_url}/v2/bank_accounts`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP bank_account create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP bank_account ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to register bank account", 502, "FP_BANK_ACCOUNT_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_bank_account_service = new FintechPrimitiveBankAccountServiceClass();
