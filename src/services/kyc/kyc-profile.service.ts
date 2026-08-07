import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";
import logger from "../../middleware/logger.js";
import type { ProfileStageInput } from "../../lib/zod-schemas/kyc-onboarding.schema.js";

class KycProfileServiceClass {

    get_by_user_id = async (user_id: string) => {
        return await db.kycProfile.findUnique({ where: { user_id } });
    }

    /**
     * Typed upsert - accepts any valid KycProfile fields.
     * Usage:
     *   upsert(user_id, { pan, full_name, dob, cybrilla_pre_verification_id, ... })
     */
    upsert = async (user_id: string, data: Prisma.KycProfileUpdateInput) => {
        return await db.kycProfile.upsert({
            where: { user_id },
            create: { user: { connect: { id: user_id } }, ...(data as Prisma.KycProfileCreateInput) },
            update: data
        });
    }

    /**
     * Stage 1: persist the result of a Cybrilla POA pre-verification request
     * (PAN + name + DOB readiness check). Called right after
     * cybrilla_pan_verification_service.create_pre_verification(...).
     */
    upsert_pre_verification = async (user_id: string, input: {
        pan: string;
        full_name: string;
        dob: string;
        pre_verification_response: any;
    }) => {
        logger.debug("Persisting Cybrilla pre-verification result", { user_id, pre_verification_id: input.pre_verification_response?.id });

        return await this.upsert(user_id, {
            pan: input.pan,
            full_name: input.full_name,
            dob: input.dob,
            cybrilla_pre_verification_id: input.pre_verification_response?.id ?? null,
            cybrilla_pre_verification_status: input.pre_verification_response?.status ?? null,
            readiness_checked_at: input.pre_verification_response?.completed_at
                ? new Date(input.pre_verification_response.completed_at)
                : null,
            pre_verification_response: input.pre_verification_response
        });
    }

    /**
     * Poll result: refresh the stored pre-verification status/raw response.
     * Doesn't touch pan/full_name/dob - those were already set at creation time.
     */
    update_pre_verification_status = async (user_id: string, pre_verification: any) => {
        logger.debug("Updating Cybrilla pre-verification status", { user_id, pre_verification_id: pre_verification?.id, status: pre_verification?.status });

        return await this.upsert(user_id, {
            cybrilla_pre_verification_status: pre_verification?.status ?? null,
            readiness_checked_at: pre_verification?.completed_at
                ? new Date(pre_verification.completed_at)
                : null,
            pre_verification_response: pre_verification
        });
    }

    /**
     * Stage 2: persist the full state of a Cybrilla kyc_form (create/patch/get/retry all
     * return the same shape). Uses `undefined` for absent fields so we never blank out
     * previously-known data on a partial response - only `null` explicitly clears a field.
     */
    upsert_kyc_form = async (user_id: string, kyc_form: any) => {
        logger.debug("Persisting Cybrilla kyc_form state", { user_id, kyc_form_id: kyc_form?.id, status: kyc_form?.status });

        return await this.upsert(user_id, {
            cybrilla_kyc_form_id: kyc_form?.id ?? undefined,
            cybrilla_status: kyc_form?.status ?? null, //kyc status
            cybrilla_type: kyc_form?.type ?? null,//kyc form type : fresh or modify
            failure_reason: kyc_form?.reason ?? null,

            full_name: kyc_form?.name ?? undefined,
            dob: kyc_form?.date_of_birth ?? undefined,
            gender: kyc_form?.gender ?? undefined,
            marital_status: kyc_form?.marital_status ?? undefined,
            residential_status: kyc_form?.residential_status ?? undefined,
            father_name: kyc_form?.father_name ?? undefined,
            spouse_name: kyc_form?.spouse_name ?? undefined,
            occupation_type: kyc_form?.occupation_type ?? undefined,
            aadhaar_number: kyc_form?.aadhaar_number ?? undefined,
            country_of_birth: kyc_form?.country_of_birth ?? undefined,
            place_of_birth: kyc_form?.place_of_birth ?? undefined,
            nationality_country: kyc_form?.nationality_country ?? undefined,
            citizenship_countries: kyc_form?.citizenship_countries ?? undefined,
            income_slab: kyc_form?.income_slab ?? undefined,
            pep_details: kyc_form?.pep_details ?? undefined,
            tax_residency_other_than_india: kyc_form?.tax_residency_other_than_india ?? undefined,
            non_indian_tax_residency_1: kyc_form?.non_indian_tax_residency_1 ?? undefined,
            non_indian_tax_residency_2: kyc_form?.non_indian_tax_residency_2 ?? undefined,
            non_indian_tax_residency_3: kyc_form?.non_indian_tax_residency_3 ?? undefined,

            signature_provided: kyc_form?.signature_provided ?? undefined,
            identity_proof_type: kyc_form?.identity?.proof_type ?? undefined,
            address_proof_type: kyc_form?.address?.proof_type ?? undefined,
            proof_fetch_url: kyc_form?.proof_details?.fetch_url ?? undefined,
            proof_status: kyc_form?.proof_details?.status ?? undefined,
            esign_url: kyc_form?.esign_details?.esign_url ?? undefined,
            esign_status: kyc_form?.esign_details?.status ?? undefined,
            geo_latitude: kyc_form?.geolocation?.latitude ?? undefined,
            geo_longitude: kyc_form?.geolocation?.longitude ?? undefined,
            fields_needed: kyc_form?.requirements?.fields_needed ?? undefined,

            cybrilla_created_at: kyc_form?.created_at ? new Date(kyc_form.created_at) : undefined,
            cybrilla_updated_at: kyc_form?.updated_at ? new Date(kyc_form.updated_at) : undefined,
            review_completed_at: kyc_form?.review_completed_at ? new Date(kyc_form.review_completed_at) : undefined,
            awaiting_esign_at: kyc_form?.awaiting_esign_at ? new Date(kyc_form.awaiting_esign_at) : undefined,
            awaiting_submission_at: kyc_form?.awaiting_submission_at ? new Date(kyc_form.awaiting_submission_at) : undefined,
            submitted_at: kyc_form?.submitted_at ? new Date(kyc_form.submitted_at) : undefined,
            failed_at: kyc_form?.failed_at ? new Date(kyc_form.failed_at) : undefined,
            expires_at: kyc_form?.expires_at ? new Date(kyc_form.expires_at) : undefined,

            raw_kyc_form_response: kyc_form
        });
    }

    /**
     * Stage 4 (Review Profile): persist the screen's inputs plus everything derivable from
     * them - the checkbox -> declaration-boolean translation, and the India-only constants
     * (citizenship_countries/nationality_country/country_of_birth). income_slab comes straight
     * off the screen's dropdown, no bucketing needed.
     */
    upsert_profile_stage = async (user_id: string, input: ProfileStageInput) => {
        logger.debug("Persisting Review Profile stage", { user_id });

        return await this.upsert(user_id, {
            full_name: input.full_name,
            dob: input.dob,
            gender: input.gender,
            address: input.address,
            pincode: input.pincode,
            city: input.city,
            occupation: input.occupation,
            source_of_fund: input.source_of_fund,
            income_slab: input.income_slab,

            is_pep_declaration_confirmed: input.pep_confirmed,
            is_residency_declaration_confirmed: input.residency_confirmed,
            tax_residency_other_than_india: !input.residency_confirmed,
            residential_status: "resident", // no NRI support yet
            profile_confirmed_at: new Date(),

            investor_type: "individual",
            tax_status: "resident_individual",
            country_of_birth: "in",
            nationality_country: "in",
            citizenship_countries: ["in"],

            ...(input.geolocation ? {
                geo_latitude: input.geolocation.latitude,
                geo_longitude: input.geolocation.longitude,
            } : {}),
        });
    }
}

export const kyc_profile_service = new KycProfileServiceClass();
