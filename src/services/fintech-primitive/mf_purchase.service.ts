import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { CreateMfPurchaseInput } from "../../lib/zod-schemas/mf-purchase.schema.js";

// Thin Fintech Primitives client for the lumpsum mf_purchase resource - distinct from
// mf_purchase_plan.service.ts (SIP/systematic). No DB writes here, per current scope.
class FintechPrimitiveMfPurchaseServiceClass {

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

    /** POST /v2/mf_purchases - gateway is always "ondc" for this app. */
    create_purchase = async (input: CreateMfPurchaseInput, mf_investment_account: string, user_ip: string) => {
        const payload = {
            mf_investment_account,
            scheme: input.scheme,
            folio_number: input.folio_number,
            amount: input.amount,
            user_ip,
            source_ref_id: input.source_ref_id ?? crypto.randomUUID(), // idempotency ref - generated since we're not persisting a transaction id yet
            euin: env.EUIN,
            scheduled_on: input.scheduled_on,
            partner: input.partner,
            gateway: "ondc",
        };

        logger.debug("Creating FP mf_purchase", { payload });

        try {
            const response = await axios.post(`${this.base_url}/v2/mf_purchases`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mf_purchase create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP mf_purchase ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create MF purchase", 502, "MF_PURCHASE_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_mf_purchase_service = new FintechPrimitiveMfPurchaseServiceClass();
