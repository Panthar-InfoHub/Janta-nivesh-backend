import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

/** One frequency bucket inside sip_frequency_specific_data / stp_frequency_specific_data. */
export type FpV1FrequencyData = {
    /** Comma-joined day-of-month list, e.g. "[1,2,3,...,28]" - FP sends this as a STRING, not an array. */
    dates?: string;
    min_installment_amount?: number;
    max_installment_amount?: number;
    amount_multiples?: number;
    min_installments?: number;
};

export type FpV1FundScheme = {
    fund_scheme_id?: number;
    isin: string;
    name?: string;
    active?: boolean;
    delivery_mode?: string;
    amc_id?: number;
    rta_id?: number;

    fund_category?: string; // Equity | Debt | Liquid | Others
    sub_category?: string;
    amfi_code?: string;
    scheme_code?: string;
    close_ended?: boolean;
    lock_in?: boolean;
    lock_in_period?: number;
    investment_option?: string;

    purchase_allowed?: boolean;
    redemption_allowed?: boolean;
    instant_redemption_allowed?: boolean;
    sip_allowed?: boolean;
    swp_allowed?: boolean;
    stp_in_allowed?: boolean;
    stp_out_allowed?: boolean;
    switch_in_allowed?: boolean;
    switch_out_allowed?: boolean;

    min_switch_in_amount?: number;
    switch_in_amount_multiples?: number;
    min_switch_out_amount?: number;
    min_switch_out_units?: number;
    switch_out_amount_multiples?: number;
    switch_out_unit_multiples?: number;

    sip_frequency_specific_data?: Record<string, FpV1FrequencyData>;
    stp_frequency_specific_data?: Record<string, FpV1FrequencyData>;
};

// Thin client for FP's ORIGINAL (v1) fund-scheme endpoint. This is the same older /api/oms/*
// surface the Holdings Report sits on, but unlike that one it keys off the ISIN rather than a
// numeric id, so no old_id lookup is needed here.
//
// Kept separate from mf_scheme.service.ts (the /v2 client) rather than merged: the two return
// completely different shapes, and both are needed - v2 has daily-SIP/SWP thresholds v1 omits,
// v1 has category plus the switch/STP limits and extra SIP frequencies v2 omits.
class FintechPrimitiveMfSchemeV1ServiceClass {

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

    /** GET /api/oms/fund_schemes/:isin */
    get_fund_scheme_by_isin = async (isin: string): Promise<FpV1FundScheme> => {
        logger.debug("Fetching FP v1 fund_scheme", { isin });

        try {
            const response = await axios.get<FpV1FundScheme>(
                `${this.base_url}/api/oms/fund_schemes/${isin}`,
                { headers: await this.auth_headers() }
            );

            logger.debug("FP v1 fund_scheme response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching FP v1 fund_scheme ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch fund scheme details", 502, "MF_SCHEME_V1_FETCH_FAILED");
        }
    };
}

export const fintech_primitive_mf_scheme_v1_service = new FintechPrimitiveMfSchemeV1ServiceClass();
