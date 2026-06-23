import { z } from 'zod';

export const NseRegistrationSchema = z.object({
    // --- Mandatory Identifiers ---
    client_code: z.string().min(1, "Client code is required"),
    primary_holder_first_name: z.string().min(1, "Primary holder name is required"),
    tax_status: z.string().min(1, "Tax status is mandatory"), // Determines validation logic
    primary_holder_dob_incorporation: z.string().min(1, "DOB/Incorporation date is required"),
    // 01=Business, 02=Services, 03=Professional, 04=Agriculture, 05=Retired, 06=Housewife, 07=Student, 08=Others
    occupation_code: z.enum(["01", "02", "03", "04", "05", "06", "07", "08"], {
        error: "Invalid occupation code. Must be 01–08",
    }),
    holding_nature: z.enum(["SI", "JO", "AS"], {
        error: "Holding nature must be SI (Single), JO (Joint), or AS (Anyone or Survivor)",
    }),
    // D=Demat, P=Physical
    client_type: z.enum(["D", "P"], {
        error: "Client type must be D (Demat) or P (Physical)",
    }),

    // --- Financial & Communication ---
    account_no_1: z.string().min(1, "At least one bank account is required"),
    ifsc_code_1: z.string().min(1, "IFSC code is required"),
    account_type_1: z.enum(["SB", "CB", "NE", "NO"]).default("SB"),
    default_bank_flag_1: z.enum(["Y", "N"]).default("Y"),
    div_pay_mode: z.string().min(1, "Dividend payout mode is required"),
    email: z.string().email(),
    communication_mode: z.string().min(1, "Communication mode is mandatory"),

    // --- Address & Residency ---
    city: z.string().min(1),
    state: z.string().min(1),
    pincode: z.string().min(6),
    country: z.string().default("INDIA"),

    // --- KYC & Flags ---
    primary_holder_kyc_type: z.string().min(1, "KYC compliance type is required"),
    paperless_flag: z.literal("Z").default("Z"), // Z = Paperless onboarding

    // --- Nomination ---
    nomination_opt: z.enum(["Y", "N"]),
    // Y → W (Wet Signature) | E (E-Sign) | O (OTP Authentication)
    // N → O (OTP with Declaration) | V (Video Recording)
    nomination_authentication: z.enum(["W", "E", "O", "V"], {
        error: "Invalid nomination authentication mode",
    }),
})
    .passthrough()
    .superRefine((data, ctx) => {
        if (data.nomination_opt === "Y" && !["W", "E", "O"].includes(data.nomination_authentication)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["nomination_authentication"],
                message: "When nomination_opt is Y, authentication must be W (Wet Signature), E (E-Sign), or O (OTP Authentication)",
            });
        }
        if (data.nomination_opt === "N" && !["O", "V"].includes(data.nomination_authentication)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["nomination_authentication"],
                message: "When nomination_opt is N, authentication must be O (OTP with Declaration) or V (Video Recording)",
            });
        }
    });

// Type inference for your service layer
export type NseRegistrationPayload = z.infer<typeof NseRegistrationSchema>;

export const ConfirmTradingAccountSchema = z.object({
    tax_status: z.string().min(1, "Tax status is mandatory"),
    holding_nature: z.enum(["SI", "JO", "AS"], {
        message: "Holding nature must be SI (Single), JO (Joint), or AS (Anyone or Survivor)"
    }),
    jh1_name: z.string().optional(),
    jh2_name: z.string().optional(),
    guardian_name: z.string().optional(),
});