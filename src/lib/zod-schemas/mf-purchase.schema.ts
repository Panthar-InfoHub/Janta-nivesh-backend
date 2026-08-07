import { z } from "zod";

// POST /v2/mf_purchases - the actual lumpsum one-shot order (distinct from mf_purchase_plans,
// which is the SIP/systematic-recurring resource in mf-purchase-plan.schema.ts).
// mf_investment_account/user_ip/server_ip are NOT here - injected server-side (mf_investment_account
// from User.investment_account, never trust client input for it, same reasoning as phone_number).
// gateway is NOT here either - always "ondc" for this app, hardcoded in the service.
export const create_mf_purchase_schema = z.object({
    scheme: z.string().min(1), // ISIN
    folio_number: z.string().optional(), // omit -> FP creates a new folio (requires investor consent via OTP 2FA, per docs)
    amount: z.number().int().positive(),
    source_ref_id: z.string().optional(), // our own idempotency reference - generated server-side if not provided
    euin: z.string().nullable().optional(),
    scheduled_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "scheduled_on must be YYYY-MM-DD").optional(),
    partner: z.string().optional(),
});

export type CreateMfPurchaseInput = z.infer<typeof create_mf_purchase_schema>;
