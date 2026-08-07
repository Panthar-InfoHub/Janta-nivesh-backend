import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

// Thin Fintech Primitives client. Gateway is hardcoded to "cybrillapoa" - per the docs,
// that's the only gateway this endpoint currently supports fetching scheme info for.
class FintechPrimitiveMfSchemeServiceClass {

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

    /** GET /v2/mf_scheme_plans/cybrillapoa/:isin?expand=mf_scheme,mf_fund */
    get_scheme_by_isin = async (isin: string) => {
        logger.debug("Fetching FP mf_scheme_plan", { isin });

        try {
            const response = await axios.get(`${this.base_url}/v2/mf_scheme_plans/cybrillapoa/${isin}`, {
                params: { expand: "mf_scheme,mf_fund" },
                headers: await this.auth_headers(),
            });

            logger.debug("FP mf_scheme_plan response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching FP mf_scheme_plan ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch fund scheme details", 502, "MF_SCHEME_FETCH_FAILED");
        }
    }
}

export const fintech_primitive_mf_scheme_service = new FintechPrimitiveMfSchemeServiceClass();
