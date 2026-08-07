import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { CreateMfPurchasePlanInput } from "../../lib/zod-schemas/mf-purchase-plan.schema.js";

// 1-year plan - 12 monthly installments (or 12 daily ones, if daily frequency is picked)
const NUMBER_OF_INSTALLMENTS = 12;

// Thin Fintech Primitives client - no DB writes here, controller orchestrates persistence.
// initiated_by/initiated_via/systematic/payment_method/gateway are constants for this product.
class FintechPrimitiveMfPurchasePlanServiceClass {

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

    /** POST /v2/mf_purchase_plans - 1-year plan (12 installments), mandate-funded, ondc gateway. */
    create_purchase_plan = async (
        input: CreateMfPurchasePlanInput,
        mf_investment_account: string,
        mandate_id: string,
        user_ip: string
    ) => {
        const payload = {
            mf_investment_account,
            scheme: input.scheme,
            frequency: input.frequency,
            amount: input.amount,
            installment_day: input.installment_day ?? null, // must be null for frequency = daily
            folio_number: input.folio_number,
            purpose: input.purpose,
            number_of_installments: NUMBER_OF_INSTALLMENTS,
            systematic: true,
            payment_method: "mandate",
            payment_source: mandate_id,
            auto_generate_installments: true,
            initiated_by: "investor",
            initiated_via: "mobile_app",
            gateway: "ondc",
            euin: env.EUIN,
            user_ip,
        };

        logger.debug("Creating FP mf_purchase_plan", { payload });

        try {
            const response = await axios.post(`${this.base_url}/v2/mf_purchase_plans`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mf_purchase_plan create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP mf_purchase_plan ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create MF purchase plan", 502, "MF_PURCHASE_PLAN_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_mf_purchase_plan_service = new FintechPrimitiveMfPurchasePlanServiceClass();
