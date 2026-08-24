import { z } from "zod";

export const create_mf_switch_plan_schema = z.object({
    source_mf_product_id: z.string().min(1),
    destination_mf_product_id: z.string().min(1),
    folio_number: z.string().min(1),
    amount: z.number().positive(),
    frequency: z.literal("monthly"),
    installment_day: z.number().int().min(1).max(31),
});

export type CreateMfSwitchPlanInput = z.infer<
    typeof create_mf_switch_plan_schema
>;

export type ResolvedMfSwitchPlanInput = {
    switch_out_scheme: string;
    switch_in_scheme: string;
    folio_number: string;
    amount: number;
    frequency: "monthly";
    installment_day: number;
};

export const verify_switch_plan_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
});

export type VerifySwitchPlanConfirmationOtpInput = z.infer<
    typeof verify_switch_plan_confirmation_otp_schema
>;