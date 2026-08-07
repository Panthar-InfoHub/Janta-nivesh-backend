import { z } from "zod";

// mandate_type and provider_name are NOT client-controlled - always "UPI" / "CYBRILLAPOA"
// for this app (ondc gateway requires CYBRILLAPOA, and we only support UPI mandates).
// bank_account_id isn't client-controlled either - pulled from the user's primary bank record
// (UserBankDetails.fp_bank_account_old_id), registered with FP during the Profile stage.
export const create_mandate_schema = z.object({
    mandate_limit: z.number().int().positive().max(100000, "UPI mandate limit cannot exceed ₹1,00,000"),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "valid_from must be YYYY-MM-DD").optional(),
    valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "valid_to must be YYYY-MM-DD").optional(),
    payment_postback_url: z.string().url().optional(), // where the app redirects after bank-side auth
});

export type CreateMandateInput = z.infer<typeof create_mandate_schema>;
