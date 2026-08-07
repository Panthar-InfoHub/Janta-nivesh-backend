import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

type CreateKycFormInput = {
    type: "fresh" | "modify";
    pan: string;
    name: string;
    date_of_birth: string; // YYYY-MM-DD
};

// Thin Cybrilla API client - no DB writes here, controller orchestrates persistence.
// Mirrors cybrilla/pan_verification.service.ts.
class CybrillaKycFormServiceClass {

    private base_url: string;

    constructor() {
        this.base_url = env.CYBRILLA_API_BASE_URL;
    }

    private async auth_headers(extra: Record<string, string> = {}) {
        const token = await provider_token_service.get_cybrilla_token();
        return { Authorization: `Bearer ${token}`, ...extra };
    }

    /**
     * POST /poa/kyc_forms - create a new kyc_form. Only call this when
     * KycProfile.cybrilla_kyc_form_id is absent or the prior one is failed/expired
     * (Cybrilla rejects creating a second in-progress form for the same PAN).
     */
    create_kyc_form = async ({ type, pan, name, date_of_birth }: CreateKycFormInput) => {
        const payload = {
            type,
            pan,
            name,
            date_of_birth,
            proof_details_callback_url: env.KYC_FORM_PROOF_CALLBACK_URL ?? "https://myapp.com/proof_details_callback",
            esign_callback_url: env.KYC_FORM_ESIGN_CALLBACK_URL ?? "https://myapp.com/esign_callback",
        };

        logger.debug("Creating Cybrilla kyc_form with payload", payload);

        try {
            const response = await axios.post(`${this.base_url}/poa/kyc_forms`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("Cybrilla kyc_form create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating Cybrilla kyc_form ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to initiate KYC form", 502, "KYC_FORM_CREATE_FAILED");
        }
    }

    /**
     * PATCH /poa/kyc_forms - fills in the demographic/declaration fields
     * (gender, marital_status, occupation_type, income_slab, pep_details, tax residency,
     * geo_location, etc.) - independent track from the DigiLocker proof fetch, both gate
     * created -> awaiting_esign.
     */
    update_kyc_form = async (kyc_form_id: string, patch: Record<string, any>) => {
        logger.debug("Patching Cybrilla kyc_form", { id: kyc_form_id, ...patch });

        try {
            const response = await axios.patch(`${this.base_url}/poa/kyc_forms`, { id: kyc_form_id, ...patch }, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("Cybrilla kyc_form patch response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error patching Cybrilla kyc_form ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to update KYC form details", 502, "KYC_FORM_UPDATE_FAILED");
        }
    }

    /** GET /poa/kyc_forms/:id - poll for current state (status, requirements.fields_needed, proof_details, esign_details, signature_provided). */
    get_kyc_form = async (kyc_form_id: string) => {
        logger.debug("Fetching Cybrilla kyc_form", { kyc_form_id });

        try {
            const response = await axios.get(`${this.base_url}/poa/kyc_forms/${kyc_form_id}`, {
                headers: await this.auth_headers(),
            });

            logger.debug("Cybrilla kyc_form fetch response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching Cybrilla kyc_form ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to fetch KYC form status", 502, "KYC_FORM_FETCH_FAILED");
        }
    }

    /** POST /poa/kyc_forms/:id/retry_proof_details_fetch - only when proof_details.status === "failed". */
    retry_proof_details_fetch = async (kyc_form_id: string) => {
        logger.debug("Retrying Cybrilla proof details fetch", { kyc_form_id });

        try {
            const response = await axios.post(
                `${this.base_url}/poa/kyc_forms/${kyc_form_id}/retry_proof_details_fetch`,
                {},
                { headers: await this.auth_headers() }
            );

            logger.debug("Cybrilla retry proof fetch response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error retrying Cybrilla proof details fetch ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to retry proof details fetch", 502, "KYC_FORM_PROOF_RETRY_FAILED");
        }
    }

    /** POST /poa/kyc_forms/:id/signature - multipart file upload (PNG/JPG/JPEG/PDF, <=5MB). */
    upload_signature = async (kyc_form_id: string, file_buffer: Buffer, file_name: string, mime_type: string) => {
        logger.debug("Uploading signature to Cybrilla kyc_form", { kyc_form_id, file_name, mime_type });

        const form_data = new FormData();
        form_data.append("file", new Blob([new Uint8Array(file_buffer)], { type: mime_type }), file_name);

        try {
            const response = await axios.post(
                `${this.base_url}/poa/kyc_forms/${kyc_form_id}/signature`,
                form_data,
                { headers: await this.auth_headers() }
            );

            logger.debug("Cybrilla signature upload response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error uploading signature to Cybrilla ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to upload signature", 502, "KYC_FORM_SIGNATURE_UPLOAD_FAILED");
        }
    }
}

export const cybrilla_kyc_form_service = new CybrillaKycFormServiceClass();
