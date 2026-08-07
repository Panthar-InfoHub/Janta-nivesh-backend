import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

type CreateInvestorProfileInput = {
    name: string;
    date_of_birth: string; // YYYY-MM-DD
    gender: string;
    occupation: string;
    pan: string;
    place_of_birth?: string | null;
    use_default_tax_residences?: boolean | null;
    first_tax_residency?: any;
    source_of_wealth: string;
    income_slab: string;
    pep_details: string; // pep_exposed | pep_related | not_applicable
    ip_address?: string;
};

// Thin Fintech Primitives ("Janta Nivesh") API client - no DB writes here, controller
// orchestrates persistence. Uses the FP token (not Cybrilla) + x-tenant-id header.
class FintechPrimitiveInvestorProfileServiceClass {

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

    /** POST /v2/investor_profiles - create the investor's FP account profile. */
    create_investor_profile = async (input: CreateInvestorProfileInput) => {
        const payload = {
            type: "individual",
            tax_status: "resident_individual", // no NRI support yet - hardcoded
            name: input.name,
            date_of_birth: input.date_of_birth,
            gender: input.gender,
            occupation: input.occupation,
            pan: input.pan,
            country_of_birth: "IN",
            place_of_birth: input.place_of_birth ?? undefined,
            nationality_country: "IN",
            use_default_tax_residences: input.use_default_tax_residences ?? true,
            first_tax_residency: input.first_tax_residency ?? {
                country: "IN",
                taxid_type: "pan",
                taxid_number: input.pan,
            },
            source_of_wealth: input.source_of_wealth,
            income_slab: input.income_slab,
            pep_details: input.pep_details,
            ip_address: input.ip_address,
        };

        logger.debug("Creating Fintech Primitives investor_profile", { pan: input.pan });

        try {
            const response = await axios.post(`${this.base_url}/v2/investor_profiles`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("Fintech Primitives investor_profile create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating Fintech Primitives investor_profile ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create investor profile", 502, "INVESTOR_PROFILE_CREATE_FAILED");
        }
    }

    /** POST /v2/mf_investment_accounts - folio_defaults optional, can be partial (whatever we have registered so far). */
    create_investment_account = async (investor_profile_id: string, folio_defaults?: Record<string, any>) => {
        const payload = {
            primary_investor: investor_profile_id,
            holding_pattern: "single",
            ...(folio_defaults ? { folio_defaults } : {}),
        };

        logger.debug("Creating Fintech Primitives investment account", { payload });

        try {
            const response = await axios.post(`${this.base_url}/v2/mf_investment_accounts`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("Fintech Primitives investment account create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating Fintech Primitives investment account ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create investment account", 502, "INVESTMENT_ACCOUNT_CREATE_FAILED");
        }
    }

    /**
     * PATCH /v2/mf_investment_accounts - re-sets folio_defaults on an existing investment
     * account. Used for the later-nominee-add-after-skip flow, and for nominee edits/deletes
     * that need to resync nominee1/2/3.
     */
    update_investment_account = async (investment_account_id: string, primary_investor: string, folio_defaults: Record<string, any>) => {
        const payload = { id: investment_account_id, primary_investor, folio_defaults };

        logger.debug("Updating Fintech Primitives investment account", { investment_account_id });

        try {
            const response = await axios.patch(`${this.base_url}/v2/mf_investment_accounts`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("Fintech Primitives investment account update response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error updating Fintech Primitives investment account ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to update investment account", 502, "INVESTMENT_ACCOUNT_UPDATE_FAILED");
        }
    }
}

export const fintech_primitive_investor_profile_service = new FintechPrimitiveInvestorProfileServiceClass();
