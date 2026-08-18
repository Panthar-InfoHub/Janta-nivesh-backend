import axios from "axios";
import logger from "../../middleware/logger.js";

const MFAPI_BASE_URL = "https://api.mfapi.in";
const REQUEST_TIMEOUT_MS = 15000;

/** One row of mfapi's master list (GET /mf). */
export type MfApiMasterRow = {
    schemeCode: number;
    schemeName: string;
    isinGrowth: string | null;
    isinDivReinvestment: string | null;
};

/** GET /mf/:scheme_code/latest - meta + a single-element data array. */
export type MfApiLatestResponse = {
    meta?: {
        fund_house?: string;
        scheme_type?: string;
        scheme_category?: string;
        scheme_code?: number;
        scheme_name?: string;
        isin_growth?: string | null;
        isin_div_reinvestment?: string | null;
    };
    data?: { date: string; nav: string }[];
    status?: string;
};

// Thin client for mfapi.in - our NAV source now that the Finnsys master feed is gone.
// No DB access here, same rule as services/cybrilla and services/fintech-primitive.
class MfApiServiceClass {

    /**
     * Full scheme master (~40k rows, several MB). Fetched once per sync run and turned into an
     * in-memory isin -> schemeCode map by the caller - mfapi has no lookup-by-isin endpoint.
     */
    get_master_list = async (): Promise<MfApiMasterRow[]> => {
        logger.debug("Fetching mfapi master scheme list");

        const response = await axios.get<MfApiMasterRow[]>(`${MFAPI_BASE_URL}/mf`, {
            timeout: 60000, // large payload, needs more room than the per-fund calls
        });

        const rows = Array.isArray(response.data) ? response.data : [];
        logger.info(`mfapi master list fetched: ${rows.length} schemes`);
        return rows;
    }

    /** Latest NAV point for one scheme. Returns null on any failure - callers keep going. */
    get_latest_nav = async (scheme_code: number): Promise<MfApiLatestResponse | null> => {
        try {
            const response = await axios.get<MfApiLatestResponse>(
                `${MFAPI_BASE_URL}/mf/${scheme_code}/latest`,
                { timeout: REQUEST_TIMEOUT_MS }
            );
            return response.data ?? null;
        } catch (error: any) {
            logger.error(`mfapi latest NAV fetch failed for scheme_code ${scheme_code}`, error?.message ?? error);
            return null;
        }
    }
}

export const mfapi_service = new MfApiServiceClass();
