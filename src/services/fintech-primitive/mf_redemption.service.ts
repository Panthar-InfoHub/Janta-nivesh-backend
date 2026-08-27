import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";
import type { ResolvedMfRedemptionInput } from "../../lib/zod-schemas/mf-redemption.schema.js";

class FintechPrimitiveMfRedemptionServiceClass {
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

    create_redemption = async (
        input: ResolvedMfRedemptionInput,
        mf_investment_account: string,
        user_ip: string,
    ) => {
        const payload = {
            mf_investment_account,
            scheme: input.scheme,
            folio_number: input.folio_number,
            amount: input.amount ?? null,
            units: input.units ?? null,
            user_ip,
            gateway: "ondc",
            initiated_by: "investor",
            initiated_via: "mobile_app",
        };

        logger.debug("Creating FP mf_redemption", { payload });

        try {
            const response = await axios.post(
                `${this.base_url}/v2/mf_redemptions`,
                payload,
                {
                    headers: await this.auth_headers({
                        "Content-Type": "application/json",
                    }),
                },
            );

            logger.debug(
                "FP mf_redemption create response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error creating FP mf_redemption ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to create MF redemption",
                502,
                "MF_REDEMPTION_CREATE_FAILED",
            );
        }
    };

    confirm_redemption = async (
        fp_id: string,
        consent: {
            email: string;
            isd_code: string;
            mobile: string;
        },
    ) => {
        const payload = {
            id: fp_id,
            state: "confirmed",
            consent,
        };

        logger.debug("Confirming FP mf_redemption", {
            fp_id,
        });

        try {
            const response = await axios.patch(
                `${this.base_url}/v2/mf_redemptions`,
                payload,
                {
                    headers: await this.auth_headers({
                        "Content-Type": "application/json",
                    }),
                },
            );

            logger.debug(
                "FP mf_redemption confirm response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error confirming FP mf_redemption ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to confirm MF redemption",
                502,
                "MF_REDEMPTION_CONFIRM_FAILED",
            );
        }
    };

    /**
     * GET /v2/mf_redemptions/:id
     */
    get_redemption = async (fp_id: string) => {
        logger.debug("Fetching FP mf_redemption", {
            fp_id,
        });

        try {
            const response = await axios.get(
                `${this.base_url}/v2/mf_redemptions/${fp_id}`,
                {
                    headers: await this.auth_headers(),
                },
            );

            logger.debug(
                "FP mf_redemption fetch response ==> ",
                response.data,
            );

            return response.data;
        } catch (error: any) {
            logger.error(
                "Error fetching FP mf_redemption ==> ",
                error?.response?.data || error.message,
            );

            throw new AppError(
                "Failed to fetch MF redemption",
                502,
                "MF_REDEMPTION_FETCH_FAILED",
            );
        }
    };
}

export const fintech_primitive_mf_redemption_service =
    new FintechPrimitiveMfRedemptionServiceClass();