import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { ResolvedMfPurchaseInput } from "../../lib/zod-schemas/mf-purchase.schema.js";

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
    create_purchase = async (input: ResolvedMfPurchaseInput, mf_investment_account: string, user_ip: string) => {
        const payload = {
            mf_investment_account,
            scheme: input.scheme,
            folio_number: input.folio_number,
            amount: input.amount,
            user_ip,
            scheduled_on: input.scheduled_on,
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

    /** GET /v2/mf_purchases/:id - polled while the order sits in under_review. */
    get_purchase = async (fp_id: string) => {
        logger.debug("Fetching FP mf_purchase", { fp_id });

        try {
            const response = await axios.get(`${this.base_url}/v2/mf_purchases/${fp_id}`, {
                headers: await this.auth_headers(),
            });

            logger.debug("FP mf_purchase fetch response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching FP mf_purchase ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch MF purchase", 502, "MF_PURCHASE_FETCH_FAILED");
        }
    }

    /**
     * PATCH /v2/mf_purchases - `state` and `consent` are both Conditional per the docs, so this
     * one method covers both steps of the confirm sequence: consent first (order stays pending),
     * then state: "confirmed" once the payment exists. Consent is immutable once set on FP's
     * side - the caller is responsible for not re-sending it.
     */
    update_purchase = async (
        fp_id: string,
        update: { consent?: { email: string; isd_code: string; mobile: string }; state?: "confirmed" }
    ) => {
        const payload = { id: fp_id, ...update };

        logger.debug("Updating FP mf_purchase", { fp_id, fields: Object.keys(update) });

        try {
            const response = await axios.patch(`${this.base_url}/v2/mf_purchases`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mf_purchase update response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error updating FP mf_purchase ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to update MF purchase", 502, "MF_PURCHASE_UPDATE_FAILED");
        }
    }
}

export const fintech_primitive_mf_purchase_service = new FintechPrimitiveMfPurchaseServiceClass();
