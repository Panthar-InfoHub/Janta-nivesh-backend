import { z } from "zod";

// Not to be confused with onboarding.schema.ts (financial/goals onboarding).
// This file holds input schemas for the KYC/investor onboarding flow
// (basic details -> readiness -> kyc -> penny drop -> profile -> nominee).

// First stage - name + DOB. Mandatory, no skip: every user provides these before anything else,
// and the PAN stage reads them straight off KycProfile rather than re-collecting them.
export const basic_details_schema = z.object({
    full_name: z.string().min(1, "Name is required"),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date_of_birth must be YYYY-MM-DD"),
});

export type BasicDetailsInput = z.infer<typeof basic_details_schema>;

// Second stage, and the one place the user can defer the rest of onboarding. name/date_of_birth
// are no longer collected here - they come from the basic-details stage that runs first, so the
// controller reads them off KycProfile.
// Mirrors nominee_stage_schema's { skip: true } | { skip: false, ... } shape - same discriminator
// pattern, same "skip now, do it for real later" semantics (SKIPPED is not a dead end, just an
// incomplete stage the user can resubmit whenever they choose).
export const pan_verification_schema = z.discriminatedUnion("skip", [
    z.object({ skip: z.literal(true) }),
    z.object({
        skip: z.literal(false),
        pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format"),
    }),
]);

export type PanVerificationInput = z.infer<typeof pan_verification_schema>;

// PATCH /poa/kyc_forms demographic/declaration fields - independent of the DigiLocker
// proof-fetch track, both gate created -> awaiting_esign. All optional since this can be
// called incrementally (patch whatever's known so far).
// phone_number deliberately excluded - the controller always injects it from the OTP-verified
// User.phone_no, never trusts client input for it.
export const kyc_form_update_schema = z.object({
    email_address: z.string().email().optional(),
    residential_status: z.literal("resident").optional(),
    gender: z.enum(["male", "female", "transgender"]).optional(),
    marital_status: z.enum(["married", "unmarried", "others"]).optional(),
    father_name: z.string().optional(),
    spouse_name: z.string().optional(),
    occupation_type: z.string().optional(),
    aadhaar_number: z.string().optional(), // last 4 digits
    country_of_birth: z.string().optional(),
    place_of_birth: z.string().optional(),
    income_slab: z.string().optional(),
    pep_details: z.enum(["pep", "related_pep", "no_exposure"]).optional(),
    citizenship_countries: z.array(z.string()).optional(),
    nationality_country: z.string().optional(),
    tax_residency_other_than_india: z.boolean().optional(),
    non_indian_tax_residency_1: z.object({ country: z.string(), taxid_number: z.string() }).optional(),
    non_indian_tax_residency_2: z.object({ country: z.string(), taxid_number: z.string() }).optional(),
    non_indian_tax_residency_3: z.object({ country: z.string(), taxid_number: z.string() }).optional(),
    geolocation: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});

export type KycFormUpdateInput = z.infer<typeof kyc_form_update_schema>;

// Email verification stage - sits between penny drop and the Review Profile screen. The address
// has to be proven before it reaches FP/Cybrilla, so it's collected and OTP'd here rather than
// riding along with profile_stage_schema like it used to.
export const email_otp_request_schema = z.object({
    email: z.string().email(),
});

// No email field on purpose - verify_otp reads the address out of the Redis payload written by
// request-otp. Letting the client re-send it would allow verifying one address and saving another.
export const email_otp_verify_schema = z.object({
    otp: z.string().min(4).max(6),
});

// The "Review Profile" screen (Full Name/DOB/Gender/Address/Pincode/City/Occupation/
// Source of Fund/Annual Income + PEP & residency checkboxes). Feeds both the investor_profile
// create (Fintech Primitives) and whatever's still outstanding in the kyc_form PATCH (Cybrilla).
// Email is NOT here - it comes from User.email, written by the email verification stage.
export const profile_stage_schema = z.object({
    full_name: z.string().min(1),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD"),
    gender: z.enum(["male", "female", "transgender"]),
    address: z.string().min(1),
    pincode: z.string().min(1),
    city: z.string().min(1),
    marital_status: z.enum(["married", "unmarried", "others"]), //married, unmarried and others
    father_name: z.string().optional(),
    spouse_name: z.string().optional(),
    place_of_birth: z.string().min(1),
    occupation: z.enum([
        "business", "professional", "retired", "house_wife", "student",
        "public_sector_service", "private_sector_service", "government_service",
        "others", "agriculture", "doctor", "forex_dealer", "service",
    ]),
    source_of_fund: z.enum([
        "salary", "business", "gift", "ancestral_property",
        "rental_income", "prize_money", "royalty", "others",
    ]),
    // Dropdown on the Profile screen - client sends the income_slab enum value directly,
    // no bucketing needed server-side.
    income_slab: z.enum([
        "upto_1lakh", "above_1lakh_upto_5lakh", "above_5lakh_upto_10lakh",
        "above_10lakh_upto_25lakh", "above_25lakh_upto_1cr", "above_1cr",
    ]),
    // Both checkboxes gate the "Confirm and proceed" button on the screen itself - block
    // submission server-side too rather than silently defaulting an unanswered compliance question.
    pep_confirmed: z.literal(true, { message: "You must confirm you are not a PEP to proceed" }),
    residency_confirmed: z.literal(true, { message: "You must confirm your residency status to proceed" }),
    geolocation: z.object({ latitude: z.number(), longitude: z.number() }).optional(), // captured silently, GPS may be denied
});

export type ProfileStageInput = z.infer<typeof profile_stage_schema>;
