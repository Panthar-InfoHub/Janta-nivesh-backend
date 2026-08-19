import { z } from "zod";

// POST /v2/mf_redemption_plans (SWP). Server-resolved/constant, so not client input:
//   mf_investment_account -> User.investment_account
//   number_of_installments -> 12 (1 year)
//   systematic / generate_first_installment_now / auto_generate_installments /
//   gateway / initiated_by / initiated_via / user_ip
// scheme/folio_number are NOT client input either - they're resolved server-side from the
// purchase plan being redeemed against (you can only redeem from a folio you hold, so letting
// the client name a folio would be an ownership hole).
// Only "monthly" frequency is supported per the docs (note 7).
export const create_mf_redemption_plan_schema = z.object({
    purchase_plan_id: z.string().min(1),   // fp_plan_id of the PURCHASE plan
    amount: z.number().positive(),
    frequency: z.literal("monthly"),
    // Loose sanity bound only - see the note in mf-purchase-plan.schema.ts. The per-fund list is
    // MfSchemePlan.sip_monthly_dates, enforced in mf-threshold-validation.service.ts.
    installment_day: z.number().int().min(1).max(31),
});

export type CreateMfRedemptionPlanInput = z.infer<typeof create_mf_redemption_plan_schema>;

// What the FP client actually posts - the client input with purchase_plan_id swapped out for
// the scheme/folio_number resolved from it. Keeps the FP service a thin client with no
// knowledge of our DB.
export type ResolvedMfRedemptionPlanInput = {
    scheme: string;
    folio_number: string;
    amount: number;
    frequency: "monthly";
    installment_day: number;
};

export const verify_redemption_plan_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
});
