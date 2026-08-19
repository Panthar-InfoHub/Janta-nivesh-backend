import { z } from "zod";

// POST /v2/mf_purchases - the actual lumpsum one-shot order (distinct from mf_purchase_plans,
// which is the SIP/systematic-recurring resource in mf-purchase-plan.schema.ts).
// mf_investment_account/user_ip/server_ip are NOT here - injected server-side (mf_investment_account
// from User.investment_account, never trust client input for it, same reasoning as phone_number).
// gateway is NOT here either - always "ondc" for this app, hardcoded in the service.
// The client names the fund by our own MfProduct id, not by ISIN - the controller derives the
// ISIN from it. That guarantees every order is against a fund in the curated catalogue: an id
// that doesn't resolve is rejected before FP is called, so no order can end up orphaned from
// MfProduct (and therefore from its scheme-plan thresholds).
export const create_mf_purchase_schema = z.object({
    mf_product_id: z.string().min(1),
    folio_number: z.string().optional(), // omit -> FP creates a new folio (requires investor consent via OTP 2FA, per docs)
    amount: z.number().int().positive(),
    scheduled_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "scheduled_on must be YYYY-MM-DD").optional(),
    partner: z.string().optional(),
});

export type CreateMfPurchaseInput = z.infer<typeof create_mf_purchase_schema>;

// What the FP client actually posts - client input with mf_product_id swapped for the ISIN
// resolved from it. Same pattern as ResolvedMfRedemptionPlanInput: keeps the FP service a thin
// client with no knowledge of our catalogue.
export type ResolvedMfPurchaseInput = Omit<CreateMfPurchaseInput, "mf_product_id"> & {
    scheme: string;
};

// Confirm step. `method` is NOT here - always UPI, hardcoded in payment.service.ts alongside
// provider_name, same treatment as gateway. amc_order_ids/bank_account_id are server-resolved.
export const verify_purchase_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
    payment_postback_url: z.string().url().optional(), // where FP redirects the investor after payment
});

export type VerifyPurchaseConfirmationOtpInput = z.infer<typeof verify_purchase_confirmation_otp_schema>;
