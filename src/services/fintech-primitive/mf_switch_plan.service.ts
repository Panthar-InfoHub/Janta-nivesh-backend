import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { ResolvedMfSwitchPlanInput } from "../../lib/zod-schemas/mf-switch-plan.schema.js";

const NUMBER_OF_INSTALLMENTS = 12;

class FintechPrimitiveMfSwitchPlanServiceClass {
    private base_url: string;

    constructor() {
        this.base_url = env.FINTECH_PRIMITIVE_API_BASE_URL;
    }

    private async auth_headers(extra: Record<string, string> = {}) {
        const token =
            await provider_token_service.get_fintech_primitive_token();

        return {
            Authorization: `Bearer ${token}`,
            "x-tenant-id": env.FINTECH_PRIMITIVE_TENANT_ID,
            ...extra,
        };
    }

    create_switch_plan = async (
        input: ResolvedMfSwitchPlanInput,
        mf_investment_account: string,
        user_ip: string,
    ) => {
        const payload = {
            mf_investment_account,
            folio_number: input.folio_number,
            amount: input.amount,
            switch_in_scheme: input.switch_in_scheme,
            switch_out_scheme: input.switch_out_scheme,
            frequency: input.frequency,
            installment_day: input.installment_day,
            number_of_installments: NUMBER_OF_INSTALLMENTS,
            systematic: true,
            generate_first_installment_now: false,
            auto_generate_installments: true,
            initiated_by: "investor",
            initiated_via: "mobile_app",
            gateway: "ondc",
            user_ip,
        };

        logger.debug("Creating FP mf_switch_plan", { payload });

        try {
            const response = await axios.post(
                `${this.base_url}/v2/mf_switch_plans`,
                payload,
                {
                    headers: await this.auth_headers({
                        "Content-Type": "application/json",
                    }),
                },
            );

            logger.debug(
                "FP mf_switch_plan create response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error creating FP mf_switch_plan ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to create MF switch plan",
                502,
                "MF_SWITCH_PLAN_CREATE_FAILED",
            );
        }
    };

    confirm_switch_plan = async (
        fp_plan_id: string,
        consent: {
            email: string;
            isd_code: string;
            mobile: string;
        },
    ) => {
        const payload = {
            id: fp_plan_id,
            state: "confirmed",
            consent,
        };

        logger.debug("Confirming FP mf_switch_plan", {
            fp_plan_id,
        });

        try {
            const response = await axios.patch(
                `${this.base_url}/v2/mf_switch_plans`,
                payload,
                {
                    headers: await this.auth_headers({
                        "Content-Type": "application/json",
                    }),
                },
            );

            logger.debug(
                "FP mf_switch_plan confirm response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error confirming FP mf_switch_plan ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to confirm MF switch plan",
                502,
                "MF_SWITCH_PLAN_CONFIRM_FAILED",
            );
        }
    };

    get_switch_plan = async (fp_plan_id: string) => {
        logger.debug("Fetching FP mf_switch_plan", {
            fp_plan_id,
        });

        try {
            const response = await axios.get(
                `${this.base_url}/v2/mf_switch_plans/${fp_plan_id}`,
                {
                    headers: await this.auth_headers(),
                },
            );

            logger.debug(
                "FP mf_switch_plan fetch response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error fetching FP mf_switch_plan ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to fetch MF switch plan",
                502,
                "MF_SWITCH_PLAN_FETCH_FAILED",
            );
        }
    };
}

export const fintech_primitive_mf_switch_plan_service =
    new FintechPrimitiveMfSwitchPlanServiceClass();