import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

type PreVerificationInput = {
    pan: string;
    name: string;
    date_of_birth: string; // YYYY-MM-DD
    bank_accounts?: Array<{
        account_number: string;
        ifsc_code: string;
        account_type: string;
        bank_account_proof?: string; // only needed for nre_savings/nro_savings, not plain savings
        verify_manually_if_required?: boolean;
    }>;
};

// Thin Cybrilla API client - no DB writes here, that's the controller's job (calls this,
// then persists via kyc-profile / user-onboarding services). Keeps the provider seam clean
// per the Finnsys -> Cybrilla migration convention (see GUIDE.md).
class CybrillaPanVerificationServiceClass {

    private base_url: string;

    constructor() {
        this.base_url = env.CYBRILLA_API_BASE_URL;
    }

    /**
     * POST /poa/pre_verifications - kicks off the PAN readiness check, optionally also
     * verifying a bank account in the same call (fired again after penny drop, once we have
     * the account details - this is the SAME resource/poll endpoint, just an extended response).
     * Async: response comes back with status "accepted" and readiness.status still null.
     * Cybrilla finishes processing later (poll or webhook - TBD, not wired up yet).
     */
    create_pre_verification = async ({ pan, name, date_of_birth, bank_accounts }: PreVerificationInput) => {
        const token = await provider_token_service.get_cybrilla_token();

        const payload = {
            investor_identifier: pan,
            pan: { value: pan },
            name: { value: name },
            date_of_birth: { value: date_of_birth },
            ...(bank_accounts ? {
                bank_accounts: bank_accounts.map((b) => ({
                    value: {
                        account_number: b.account_number,
                        ifsc_code: b.ifsc_code,
                        account_type: b.account_type,
                        // ...(b.bank_account_proof ? { bank_account_proof: b.bank_account_proof } : {}),
                    },
                    // verify_manually_if_required: b.verify_manually_if_required ?? true,
                })),
            } : {}),
        };

        logger.debug("Creating Cybrilla pre-verification (PAN readiness check)", { payload });

        try {
            const response = await axios.post(`${this.base_url}/poa/pre_verifications`, payload, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });

            logger.debug("Cybrilla pre-verification response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating Cybrilla pre-verification ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to submit PAN readiness check", 502, "PAN_READINESS_CHECK_FAILED");
        }
    }

    /**
     * GET /poa/pre_verifications/:id - poll for the outcome of a previously created
     * pre-verification. Once `completed_at` is set, `readiness`/`name`/`pan`/`date_of_birth`/
     * `bank_accounts` sub-objects should have their `status`/`reason` fields populated.
     */
    get_pre_verification = async (pre_verification_id: string) => {
        const token = await provider_token_service.get_cybrilla_token();

        logger.debug("Fetching Cybrilla pre-verification status", { pre_verification_id });

        try {
            const response = await axios.get(`${this.base_url}/poa/pre_verifications/${pre_verification_id}`, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });

            logger.debug("Cybrilla pre-verification status response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching Cybrilla pre-verification status ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch PAN readiness status", 502, "PAN_READINESS_STATUS_FETCH_FAILED");
        }
    }
}

export const cybrilla_pan_verification_service = new CybrillaPanVerificationServiceClass();
