import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

export type FpHoldingScheme = {
    isin: string;
    name?: string;
    type?: string;
    holdings?: { as_on?: string; units?: number; redeemable_units?: number };
    market_value?: { as_on?: string; amount?: number; redeemable_amount?: number };
    invested_value?: { as_on?: string; amount?: number };
    payout?: { as_on?: string; amount?: number };
    nav?: { as_on?: string; value?: number };
};

export type FpHoldingFolio = {
    folio_number: string;
    schemes: FpHoldingScheme[];
};

export type FpSchemeWiseReturnRow = {
    isin: string;
    scheme_name?: string;
    plan_type?: string;
    investment_option?: string;
    as_on?: string;
    nav?: number;
    invested_amount?: number;
    current_value?: number;
    unrealized_gain?: number;
    absolute_return?: number;
    average_buying_value?: number;
    units?: number;
    xirr?: number;
};

// Thin client for the two "Investor Reports" endpoints the portfolio screens are built on. Both
// are read-only rollups FP already computes (units, current value, XIRR) - no math happens here,
// this just maps FP's response shape into plain objects. mf-holding-sync.service.ts is what
// actually persists these into our own MfHolding table.
class FintechPrimitiveMfReportsServiceClass {

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
     * GET /api/oms/reports/holdings - folio -> scheme breakdown: units, market value, invested
     * value, NAV. This is the only FP report that's actually per-folio - scheme_wise_returns below
     * merges folios of the same scheme into one row, so it can't answer "what does THIS folio hold".
     */
    get_holdings = async (mf_investment_account: string): Promise<FpHoldingFolio[]> => {
        logger.debug("Fetching FP holdings report", { mf_investment_account });

        try {
            const response = await axios.get(`${this.base_url}/api/oms/reports/holdings`, {
                params: { investment_account_id: mf_investment_account },
                headers: await this.auth_headers(),
            });

            logger.debug("FP holdings report response ==> ", response.data);
            return response.data?.folios ?? [];
        } catch (error: any) {
            logger.error("Error fetching FP holdings report ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch holdings report", 502, "MF_HOLDINGS_REPORT_FAILED");
        }
    };

    /**
     * POST /v2/transactions/reports/scheme_wise_returns - per-scheme XIRR/returns, folio-merged.
     * Used only for `xirr`, which get_holdings doesn't carry - everything else about a specific
     * holding comes from get_holdings. Response rows are (columns[], rows[][]) pairs; zipped here
     * rather than assumed-ordered so a column reorder on FP's side doesn't silently scramble fields.
     */
    get_scheme_wise_returns = async (mf_investment_account: string): Promise<FpSchemeWiseReturnRow[]> => {
        logger.debug("Fetching FP scheme-wise returns", { mf_investment_account });

        try {
            const response = await axios.post(
                `${this.base_url}/v2/transactions/reports/scheme_wise_returns`,
                { mf_investment_account },
                { headers: await this.auth_headers({ "Content-Type": "application/json" }) }
            );

            logger.debug("FP scheme-wise returns response ==> ", response.data);

            const columns: string[] = response.data?.data?.columns ?? [];
            const rows: any[][] = response.data?.data?.rows ?? [];

            return rows.map((row) => {
                const record: any = {};
                columns.forEach((col, i) => { record[col] = row[i]; });
                return record as FpSchemeWiseReturnRow;
            });
        } catch (error: any) {
            logger.error("Error fetching FP scheme-wise returns ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch scheme-wise returns", 502, "MF_SCHEME_WISE_RETURNS_FAILED");
        }
    };
}

export const fintech_primitive_mf_reports_service = new FintechPrimitiveMfReportsServiceClass();
