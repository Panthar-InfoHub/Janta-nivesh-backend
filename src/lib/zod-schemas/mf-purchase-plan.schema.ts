import { z } from "zod";

// POST /v2/mf_purchase_plans. Only what the SIP screen actually collects - everything else is
// server-resolved or a constant for this flow:
//   mf_investment_account -> User.investment_account
//   payment_source        -> the user's APPROVED mandate id
//   number_of_installments -> 12 (1 year)
//   systematic/payment_method/gateway/initiated_by/initiated_via/euin/user_ip -> constants or server-side
// mf_product_id, not ISIN - see the note in mf-purchase.schema.ts. The controller resolves the
// ISIN from it, so an order can never reference a fund outside the curated catalogue.
export const create_mf_purchase_plan_schema = z.object({
    mf_product_id: z.string().min(1),
    amount: z.number().positive(),
    frequency: z.enum(["monthly", "daily"]), // only these two are supported per the docs
    // Loose sanity bound only - the real per-fund constraint is MfSchemePlan.sip_monthly_dates,
    // checked in mf-threshold-validation.service.ts. FP ships dates up to 30, so the old max(28)
    // was rejecting valid days.
    installment_day: z.number().int().min(1).max(31).optional(), // must be null for frequency = daily
    folio_number: z.string().optional(),
    purpose: z.enum(["children_education", "children_marriage", "house", "car", "travel", "retirement", "others"]).optional(),
}).refine(
    (v) => v.frequency !== "monthly" || v.installment_day !== undefined,
    { message: "installment_day is required for monthly frequency", path: ["installment_day"] }
).refine(
    (v) => v.frequency !== "daily" || v.installment_day === undefined,
    { message: "installment_day must be omitted for daily frequency", path: ["installment_day"] }
);

export type CreateMfPurchasePlanInput = z.infer<typeof create_mf_purchase_plan_schema>;

// Client input with mf_product_id swapped for the resolved ISIN - what the FP client posts.
export type ResolvedMfPurchasePlanInput = Omit<CreateMfPurchasePlanInput, "mf_product_id"> & {
    scheme: string;
};

export const verify_purchase_plan_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
});

export type VerifyPurchasePlanConfirmationOtpInput = z.infer<typeof verify_purchase_plan_confirmation_otp_schema>;

export const cancel_mf_purchase_plan_schema = z.object({
    cancellation_code: z.enum([
        "amount_not_available",
        "investment_returns_not_as_expected",
        "amc_support_not_satisfactory",
        "exit_load_not_as_expected",
        "switch_to_other_scheme",
        "fund_manager_changed",
        "investment_goal_complete",
        "mandate_not_ready",
        "invest_later",
        "customer_support_not_satisfactory",
    ]),
});

export type CancelMfPurchasePlanInput = z.infer<
    typeof cancel_mf_purchase_plan_schema
>;