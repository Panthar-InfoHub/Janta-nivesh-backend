import logger from "../../middleware/logger.js";

// Shared pure mapping helpers - reused by both the kyc_form PATCH (Cybrilla) and the
// investor_profile create (Fintech Primitives) calls, since a lot of the underlying data
// (occupation, income, PEP, residency) is collected once on the Profile screen but needs
// different enum spellings per provider.
//
// income_slab is NOT derived here - the Profile screen's Annual Income field is a dropdown
// of the exact income_slab enum values, so the client sends the slab string directly.

/** kyc_form's pep_details vocab: pep | related_pep | no_exposure */
export const map_pep_details_for_kyc_form = (is_pep_declaration_confirmed: boolean): string =>
    is_pep_declaration_confirmed ? "no_exposure" : "pep";

/** investor_profile's pep_details vocab: pep_exposed | pep_related | not_applicable */
export const map_pep_details_for_investor_profile = (is_pep_declaration_confirmed: boolean): string =>
    is_pep_declaration_confirmed ? "not_applicable" : "pep_exposed";

type KycFormPatchContext = {
    user: { email?: string | null; phone_no?: string | null };
    kyc_profile: {
        gender?: string | null;
        marital_status?: string | null;
        father_name?: string | null;
        spouse_name?: string | null;
        occupation?: string | null; // investor_profile-vocab value, reused here - see case below
        aadhaar_number?: string | null;
        place_of_birth?: string | null;
        income_slab?: string | null;
        is_pep_declaration_confirmed?: boolean | null;
        tax_residency_other_than_india?: boolean | null;
        geo_latitude?: number | null;
        geo_longitude?: number | null;
    };
};

/**
 * Builds a PATCH payload for /poa/kyc_forms containing ONLY what's actually still listed in
 * `fields_needed` - so this can be called incrementally/repeatedly without re-sending fields
 * Cybrilla already has. "identity_proof"/"address"/"signature" are deliberately not handled
 * here - those are resolved via DigiLocker / the signature-upload endpoint, not this PATCH.
 */
export const build_kyc_form_patch_payload = (
    fields_needed: string[],
    { user, kyc_profile }: KycFormPatchContext
): Record<string, any> => {
    const payload: Record<string, any> = {};

    for (const field of fields_needed) {
        switch (field) {
            case "email_address":
                if (user.email) payload.email_address = user.email;
                break;
            case "phone_number":
                if (user.phone_no) payload.phone_number = { isd: "+91", number: user.phone_no };
                break;
            case "gender":
                if (kyc_profile.gender) payload.gender = kyc_profile.gender;
                break;
            case "marital_status":
                if (kyc_profile.marital_status) payload.marital_status = kyc_profile.marital_status;
                break;
            case "father_name":
                if (kyc_profile.father_name) payload.father_name = kyc_profile.father_name;
                break;
            case "spouse_name":
                if (kyc_profile.spouse_name) payload.spouse_name = kyc_profile.spouse_name;
                break;
            case "occupation_type":
                // Reusing the investor_profile-vocab `occupation` value - kyc_form's own
                // occupation_type enum wasn't fully confirmed against Cybrilla's docs (only
                // saw "business, professional, retired, etc." truncated). Flag if rejected.
                if (kyc_profile.occupation) payload.occupation_type = kyc_profile.occupation;
                break;
            case "aadhaar_number":
                if (kyc_profile.aadhaar_number) payload.aadhaar_number = kyc_profile.aadhaar_number;
                break;
            case "country_of_birth":
                payload.country_of_birth = "in"; // India-only product, no UI needed
                break;
            case "place_of_birth":
                if (kyc_profile.place_of_birth) payload.place_of_birth = kyc_profile.place_of_birth;
                break;
            case "income_slab":
                if (kyc_profile.income_slab) payload.income_slab = kyc_profile.income_slab;
                break;
            case "pep_details":
                if (kyc_profile.is_pep_declaration_confirmed != null) {
                    payload.pep_details = map_pep_details_for_kyc_form(kyc_profile.is_pep_declaration_confirmed);
                }
                break;
            case "citizenship_countries":
                payload.citizenship_countries = ["in"];
                break;
            case "nationality_country":
                payload.nationality_country = "in";
                break;
            case "tax_residency_other_than_india":
                if (kyc_profile.tax_residency_other_than_india != null) {
                    payload.tax_residency_other_than_india = kyc_profile.tax_residency_other_than_india;
                }
                break;
            case "residential_status":
                payload.residential_status = "resident"; // no NRI support yet
                break;
            case "geolocation":
                if (kyc_profile.geo_latitude != null && kyc_profile.geo_longitude != null) {
                    payload.geolocation = { latitude: kyc_profile.geo_latitude, longitude: kyc_profile.geo_longitude };
                }
                break;
            default:
                logger.warn(`No mapping for kyc_form fields_needed item "${field}" - skipping`);
        }
    }

    return payload;
}
