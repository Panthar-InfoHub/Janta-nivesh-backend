import axios from "axios";
import logger from "../../middleware/logger.js";

const MFAPI_BASE_URL = "https://api.mfapi.in";
const AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const REQUEST_TIMEOUT_MS = 15000;

const AMFI_MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export type AmfiNavPoint = {
    nav: number;
    nav_date: Date;
};

export type AmfiNavMap = {
    by_isin: Map<string, AmfiNavPoint>;
    by_scheme_code: Map<number, AmfiNavPoint>;
};

/** One row of mfapi's master list (GET /mf). */
export type MfApiMasterRow = {
    schemeCode: number;
    schemeName: string;
    isinGrowth: string | null;
    isinDivReinvestment: string | null;
};

/**
 * GET /mf/:scheme_code/latest - meta + a single-element data array.
 * GET /mf/:scheme_code        - same shape, but data[] carries the fund's whole NAV history.
 */
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
            timeout: 120000, // large payload, needs more room than the per-fund calls
        });

        const rows = Array.isArray(response.data) ? response.data : [];
        logger.info(`mfapi master list fetched: ${rows.length} schemes`);
        return rows;
    }

    /**
     * Full NAV history for one scheme - the same endpoint as get_latest_nav minus the /latest
     * segment, so data[] carries every point the fund has rather than one.
     *
     * The endpoint also accepts startDate/endDate (ISO) to narrow the range; we deliberately pass
     * neither. The metrics job only looks back 5 years, but taking everything avoids the silent
     * null-return case where a lookback window lands right at the edge of a truncated range.
     *
     * Returns null on any failure - a bad fund is reported, never aborts the batch.
     */
    get_full_history = async (scheme_code: number): Promise<MfApiLatestResponse | null> => {
        try {
            const response = await axios.get<MfApiLatestResponse>(
                `${MFAPI_BASE_URL}/mf/${scheme_code}`,
                { timeout: 60000 } // whole-history payloads are far larger than the /latest one
            );
            return response.data ?? null;
        } catch (error: any) {
            logger.error(`mfapi NAV history fetch failed for scheme_code ${scheme_code}`, error?.message ?? error);
            return null;
        }
    }

    private parse_amfi_date = (raw: string): Date | null => {
        const parts = raw.trim().split("-");
        if (parts.length !== 3) return null;
        const [day, monRaw, year] = parts;
        const month = AMFI_MONTHS[monRaw.toLowerCase()];
        if (!month || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;
        const parsed = new Date(`${year}-${month}-${day.padStart(2, "0")}T00:00:00.000Z`);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    /**
     * Fetches AMFI's daily bulk NAV file (NAVAll.txt) in one HTTP call and indexes every
     * valid scheme by both ISIN (growth + IDCW reinvestment) and AMFI scheme_code.
     * Returns null if AMFI is unreachable so callers can fall back to mfapi.in.
     */
    get_amfi_nav_map = async (): Promise<AmfiNavMap | null> => {
        try {
            logger.info("Fetching AMFI NAVAll.txt bulk feed");
            const response = await axios.get<string>(AMFI_NAV_URL, {
                timeout: 30000,
                responseType: "text",
            });

            const text = typeof response.data === "string" ? response.data : "";
            const by_isin = new Map<string, AmfiNavPoint>();
            const by_scheme_code = new Map<number, AmfiNavPoint>();

            for (const line of text.split(/\r?\n/)) {
                if (!line.includes(";")) continue;
                const cols = line.split(";");
                if (cols.length < 6) continue;

                const scheme_code = parseInt(cols[0].trim(), 10);
                if (isNaN(scheme_code)) continue; // skips header row "Scheme Code;..."

                const nav = parseFloat(cols[cols.length - 2].trim());
                const nav_date = this.parse_amfi_date(cols[cols.length - 1]);
                if (isNaN(nav) || nav <= 0 || !nav_date) continue;

                const point: AmfiNavPoint = { nav, nav_date };
                by_scheme_code.set(scheme_code, point);

                const isin1 = cols[1].trim().toUpperCase();
                const isin2 = cols[2].trim().toUpperCase();
                if (isin1 && isin1 !== "-") by_isin.set(isin1, point);
                if (isin2 && isin2 !== "-") by_isin.set(isin2, point);
            }

            logger.info(`AMFI NAVAll.txt parsed: ${by_scheme_code.size} schemes, ${by_isin.size} ISINs`);
            return { by_isin, by_scheme_code };
        } catch (error: any) {
            logger.error("AMFI NAVAll.txt fetch failed, falling back to mfapi.in", error?.message ?? error);
            return null;
        }
    }

    /** Latest NAV point for one scheme (with backoff retry on 429/5xx). Returns null on failure. */
    get_latest_nav = async (scheme_code: number, max_retries = 2): Promise<MfApiLatestResponse | null> => {
        for (let attempt = 0; attempt <= max_retries; attempt++) {
            try {
                const response = await axios.get<MfApiLatestResponse>(
                    `${MFAPI_BASE_URL}/mf/${scheme_code}/latest`,
                    { timeout: REQUEST_TIMEOUT_MS }
                );
                return response.data ?? null;
            } catch (error: any) {
                const status = error?.response?.status;
                const retryable = status === 429 || (status >= 500 && status < 600);
                if (retryable && attempt < max_retries) {
                    const delay_ms = 1000 * Math.pow(2, attempt);
                    await new Promise((r) => setTimeout(r, delay_ms));
                    continue;
                }
                logger.error(`mfapi latest NAV fetch failed for scheme_code ${scheme_code}`, error?.message ?? error);
                return null;
            }
        }
        return null;
    }
}

export const mfapi_service = new MfApiServiceClass();
