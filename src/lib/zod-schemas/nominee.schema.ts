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

export const nominee_input_schema = z.object({
    nominee_name: z.string().min(1, "Nominee name is required"),
    relationship: z.enum(NOMINEE_RELATIONSHIP_VALUES),
    percentage_allocation: z.number().min(0).max(100),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD"),
    // Required by FP for non-minor nominees
    document_type: z.enum(NOMINEE_DOCUMENT_TYPES),
    document_number: z.string().min(1),
    email_address: z.string().email(),
    phone_number: nominee_phone_schema,
    address: nominee_address_schema,
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
