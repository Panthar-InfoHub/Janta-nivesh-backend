import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { ResolvedMfRedemptionPlanInput } from "../../lib/zod-schemas/mf-redemption-plan.schema.js";

// 1-year plan - 12 monthly installments, mirroring the purchase plan default
const NUMBER_OF_INSTALLMENTS = 12;

// Thin Fintech Primitives client for SWP (systematic withdrawal). No payment_method/
// payment_source here - redemptions pay out, no mandate involved.
class FintechPrimitiveMfRedemptionPlanServiceClass {

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

    /**
     * POST /v2/mf_redemption_plans - monthly only per the docs, folio_number mandatory.
     * Takes the *resolved* input - the controller derives scheme/folio_number from the purchase
     * plan being redeemed against, so this stays a thin client with no knowledge of our DB.
     */
    create_redemption_plan = async (
        input: ResolvedMfRedemptionPlanInput,
        mf_investment_account: string,
        user_ip: string
    ) => {
        const payload = {
            mf_investment_account,
            scheme: input.scheme,
            folio_number: input.folio_number,
            frequency: input.frequency,
            amount: input.amount,
            installment_day: input.installment_day ?? null,
            number_of_installments: NUMBER_OF_INSTALLMENTS,
            systematic: true,
            // docs note 7: generate_installment_now = true is NOT available for redemption plans
            generate_first_installment_now: false,
            auto_generate_installments: true,
            initiated_by: "investor",
            initiated_via: "mobile_app",
            gateway: "ondc",
            user_ip,
        };

        logger.debug("Creating FP mf_redemption_plan", { payload });

        try {
            const response = await axios.post(`${this.base_url}/v2/mf_redemption_plans`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mf_redemption_plan create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP mf_redemption_plan ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create MF redemption plan", 502, "MF_REDEMPTION_PLAN_CREATE_FAILED");
        }
    }

    /** PATCH /v2/mf_redemption_plans - moves review_completed -> confirmed by attaching consent. */
    confirm_redemption_plan = async (fp_plan_id: string, consent: { email: string; isd_code: string; mobile: string }) => {
        const payload = { id: fp_plan_id, state: "confirmed", consent };

        logger.debug("Confirming FP mf_redemption_plan", { fp_plan_id });

        try {
            const response = await axios.patch(`${this.base_url}/v2/mf_redemption_plans`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP mf_redemption_plan confirm response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error confirming FP mf_redemption_plan ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to confirm MF redemption plan", 502, "MF_REDEMPTION_PLAN_CONFIRM_FAILED");
        }
    }

    /** GET /v2/mf_redemption_plans/:id */
    get_redemption_plan = async (fp_plan_id: string) => {
        logger.debug("Fetching FP mf_redemption_plan", { fp_plan_id });

        try {
            const response = await axios.get(`${this.base_url}/v2/mf_redemption_plans/${fp_plan_id}`, {
                headers: await this.auth_headers(),
            });

            logger.debug("FP mf_redemption_plan fetch response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching FP mf_redemption_plan ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch MF redemption plan", 502, "MF_REDEMPTION_PLAN_FETCH_FAILED");
        }
    }
}

export const fintech_primitive_mf_redemption_plan_service = new FintechPrimitiveMfRedemptionPlanServiceClass();
