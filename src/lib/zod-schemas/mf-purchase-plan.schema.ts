import { z } from "zod";

// POST /v2/mf_purchase_plans. Only what the SIP screen actually collects - everything else is
// server-resolved or a constant for this flow:
//   mf_investment_account -> User.investment_account
//   payment_source        -> the user's APPROVED mandate id
//   number_of_installments -> 12 (1 year)
//   systematic/payment_method/gateway/initiated_by/initiated_via/euin/user_ip -> constants or server-side
export const create_mf_purchase_plan_schema = z.object({
    scheme: z.string().min(1), // ISIN
    amount: z.number().positive(),
    frequency: z.enum(["monthly", "daily"]), // only these two are supported per the docs
    installment_day: z.number().int().min(1).max(28).optional(), // must be null for frequency = daily
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
