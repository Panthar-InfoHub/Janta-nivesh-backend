import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { ResolvedMfSwitchInput } from "../../lib/zod-schemas/mf-switch.schema.js";

class FintechPrimitiveMfSwitchServiceClass {

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

    /**
     * POST /v2/mf_switches
     *
     * One-shot / immediate MF switch.
     * Different from mf_switch_plans, which is the systematic STP flow.
     */
    create_switch = async (
        input: ResolvedMfSwitchInput,
        mf_investment_account: string,
        user_ip: string,
    ) => {
        const payload = {
            mf_investment_account,
            folio_number: input.folio_number,
            switch_out_scheme: input.switch_out_scheme,
            switch_in_scheme: input.switch_in_scheme,
            amount: input.amount ?? null,
            units: input.units ?? null,
            initiated_by: "investor",
            initiated_via: "mobile_app",
            gateway: "ondc",
            user_ip,
        };

        logger.debug("Creating FP mf_switch", { payload });

        try {
            const response = await axios.post(
                `${this.base_url}/v2/mf_switches`,
                payload,
                {
                    headers: await this.auth_headers({
                        "Content-Type": "application/json",
                    }),
                },
            );

            logger.debug(
                "FP mf_switch create response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error creating FP mf_switch ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to create MF switch",
                502,
                "MF_SWITCH_CREATE_FAILED",
            );
        }
    };

    /**
     * GET /v2/mf_switches/:id
     */
    get_switch = async (fp_id: string) => {
        logger.debug("Fetching FP mf_switch", { fp_id });

        try {
            const response = await axios.get(
                `${this.base_url}/v2/mf_switches/${fp_id}`,
                {
                    headers: await this.auth_headers(),
                },
            );

            logger.debug(
                "FP mf_switch fetch response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error fetching FP mf_switch ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to fetch MF switch",
                502,
                "MF_SWITCH_FETCH_FAILED",
            );
        }
    };

    /**
     * PATCH /v2/mf_switches
     *
     * Sends consent and/or moves the FP order to confirmed.
     */
    update_switch = async (
        fp_id: string,
        update: {
            consent?: {
                email: string;
                isd_code: string;
                mobile: string;
            };
            state?: "confirmed";
        },
    ) => {
        const payload = {
            id: fp_id,
            ...update,
        };

        logger.debug("Updating FP mf_switch", {
            fp_id,
            fields: Object.keys(update),
        });

        try {
            const response = await axios.patch(
                `${this.base_url}/v2/mf_switches`,
                payload,
                {
                    headers: await this.auth_headers({
                        "Content-Type": "application/json",
                    }),
                },
            );

            logger.debug(
                "FP mf_switch update response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error updating FP mf_switch ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to update MF switch",
                502,
                "MF_SWITCH_UPDATE_FAILED",
            );
        }
    };
}

export const fintech_primitive_mf_switch_service =
    new FintechPrimitiveMfSwitchServiceClass();