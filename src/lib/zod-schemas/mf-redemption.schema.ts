import { z } from "zod";

export const create_mf_redemption_schema = z.object({
    mf_product_id: z.string().min(1),
    folio_number: z.string().min(1),
    amount: z.number().int().positive().optional(),
    units: z.number().positive().optional(),
    partner: z.string().optional(),
}).refine(
    (data) => !(data.amount !== undefined && data.units !== undefined),
    {
        message: "Provide either amount or units, not both",
        path: ["amount"],
    }
);

export type CreateMfRedemptionInput = z.infer<
    typeof create_mf_redemption_schema
>;

export type ResolvedMfRedemptionInput = Omit<
    CreateMfRedemptionInput,
    "mf_product_id"
> & {
    scheme: string;
};

export const verify_redemption_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
});

export type VerifyRedemptionConfirmationOtpInput = z.infer<
    typeof verify_redemption_confirmation_otp_schema
>;