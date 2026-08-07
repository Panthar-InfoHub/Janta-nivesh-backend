import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

export type NomineeDocumentType = "pan" | "aadhaar" | "driving_licence" | "passport";

// FP has one column per proof type, not a generic "identity_proof_number" field - map our
// generic document_type to the actual related_party field name it goes in.
// Note: aadhaar_number specifically wants only the LAST 4 DIGITS per the docs, not the full number.
const DOCUMENT_TYPE_FIELD_MAP: Record<NomineeDocumentType, string> = {
    pan: "pan",
    aadhaar: "aadhaar_number",
    driving_licence: "driving_licence_number",
    passport: "passport_number",
};

type CreateRelatedPartyInput = {
    name: string;
    relationship: string;
    date_of_birth: string;
    document_type: NomineeDocumentType;
    document_number: string;
    email_address: string;
    phone_number: { isd: string; number: string };
    address: {
        line1: string;
        line2?: string;
        line3?: string;
        city?: string;
        state?: string;
        postal_code: string;
        country: string;
    };
};

// Thin FP client. name/relationship/date_of_birth/the document field/email_address/phone_number/
// address are all immutable once set on FP's side - if any change after being synced, a NEW
// related_party has to be created (see nominee_service - the caller handles that, not this file).
class FintechPrimitiveRelatedPartyServiceClass {

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

    /** POST /v2/related_parties */
    create_related_party = async (profile_id: string, input: CreateRelatedPartyInput) => {
        const document_field = DOCUMENT_TYPE_FIELD_MAP[input.document_type];

        const payload = {
            profile: profile_id,
            name: input.name,
            relationship: input.relationship,
            date_of_birth: input.date_of_birth,
            [document_field]: input.document_number,
            email_address: input.email_address,
            phone_number: input.phone_number,
            address: input.address,
        };

        logger.debug("Creating FP related_party", { profile_id, relationship: input.relationship, document_type: input.document_type });

        try {
            const response = await axios.post(`${this.base_url}/v2/related_parties`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP related_party create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP related_party ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to register nominee with provider", 502, "FP_RELATED_PARTY_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_related_party_service = new FintechPrimitiveRelatedPartyServiceClass();
