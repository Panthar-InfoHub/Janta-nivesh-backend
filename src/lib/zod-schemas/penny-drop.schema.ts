import { z } from "zod";

// Frontend already ran the UPI verification flow with the provider directly and got back
// verified bank details - this just persists what it hands us. No FP bank_account object gets
// created here (that needs `profile`/investor_profile, which doesn't exist until Profile stage).
export const penny_drop_schema = z.object({
    account_number: z.string().min(9).max(18).regex(/^\d+$/, "account_number must be numeric"),
    ifsc_code: z.string().min(1),
    bank_name: z.string().optional(),
    account_holder_name: z.string().min(1),
    account_type: z.enum(["savings", "current", "nre", "nro"]).default("savings"),
});

export type PennyDropInput = z.infer<typeof penny_drop_schema>;
