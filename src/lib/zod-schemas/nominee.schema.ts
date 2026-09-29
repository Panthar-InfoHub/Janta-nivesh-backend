import { z } from "zod";

// Must match FP's related_party `relationship` enum exactly - a nominee eventually becomes
// a related_party object, and that field is immutable once set on FP's side, so we can't
// afford to accept a value here that gets rejected later at nominee stage.
export const NOMINEE_RELATIONSHIP_VALUES = [
    "father", "mother", "court_appointed_legal_guardian", "aunt", "brother_in_law", "brother",
    "daughter", "daughter_in_law", "father_in_law", "grand_daughter", "grand_father",
    "grand_mother", "grand_son", "mother_in_law", "nephew", "niece", "sister", "sister_in_law",
    "son", "son_in_law", "spouse", "uncle", "others",
] as const;

// address/phone_number are literal inline values on FP's related_party (not object-id
// references, unlike folio_defaults.communication_address/communication_mobile_number).
const nominee_address_schema = z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    line3: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postal_code: z.string().min(1),
    country: z.string().default("IN"),
});

const nominee_phone_schema = z.object({
    isd: z.string().min(1),
    number: z.string().min(1),
});

// Generic proof pair - maps to related_party's type-specific field (pan | aadhaar_number |
// driving_licence_number | passport_number) at call time, not a single shared field on FP's side.
export const NOMINEE_DOCUMENT_TYPES = ["pan", "aadhaar", "driving_licence", "passport"] as const;

// Helpers to treat empty strings, nulls, and empty nested objects from form submissions as undefined
const empty_string_to_undefined = (val: unknown) =>
    val === null || (typeof val === "string" && val.trim() === "") ? undefined : val;

const empty_number_to_undefined = (val: unknown) =>
    val === null || val === "" || val === undefined ? undefined : typeof val === "string" ? Number(val) : val;

const empty_phone_to_undefined = (val: unknown) => {
    if (!val || typeof val !== "object") return undefined;
    const phone = val as Record<string, any>;
    if (!phone.number || (typeof phone.number === "string" && phone.number.trim() === "")) {
        return undefined;
    }
    return phone;
};

const empty_address_to_undefined = (val: unknown) => {
    if (!val || typeof val !== "object") return undefined;
    const addr = val as Record<string, any>;
    if (!addr.line1 || (typeof addr.line1 === "string" && addr.line1.trim() === "")) {
        return undefined;
    }
    return addr;
};

export const nominee_input_schema = z.object({
    nominee_name: z.string().min(1, "Nominee name is required"),
    relationship: z.enum(NOMINEE_RELATIONSHIP_VALUES),
    percentage_allocation: z.preprocess(
        empty_number_to_undefined,
        z.number().min(0).max(100).optional()
    ),
    dob: z.preprocess(
        empty_string_to_undefined,
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD").optional()
    ),
    // Required by FP for non-minor nominees
    document_type: z.preprocess(
        empty_string_to_undefined,
        z.enum(NOMINEE_DOCUMENT_TYPES).optional()
    ),
    document_number: z.preprocess(
        empty_string_to_undefined,
        z.string().min(1).optional()
    ),
    email_address: z.preprocess(
        empty_string_to_undefined,
        z.string().email("Invalid email address").optional()
    ),
    phone_number: z.preprocess(
        empty_phone_to_undefined,
        nominee_phone_schema.optional()
    ),
    address: z.preprocess(
        empty_address_to_undefined,
        nominee_address_schema.optional()
    ),
});

export type NomineeInput = z.infer<typeof nominee_input_schema>;

// "I will add Nominees later" vs the nominee array - one endpoint, body shape decides which.
export const nominee_stage_schema = z.discriminatedUnion("skip", [
    z.object({ skip: z.literal(true) }),
    z.object({ skip: z.literal(false), nominees: z.array(nominee_input_schema).min(1, "At least one nominee is required") }),
]);

export type NomineeStageInput = z.infer<typeof nominee_stage_schema>;

// PATCH /nominee/:id - all fields optional, partial update
export const update_nominee_schema = nominee_input_schema.partial();

export type UpdateNomineeInput = z.infer<typeof update_nominee_schema>;
