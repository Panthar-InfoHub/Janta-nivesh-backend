import { z } from "zod";

export const create_mf_redemption_schema = z.object({
    mf_holding_id: z.string().min(1),
    amount: z.number().int().positive().optional(),
    units: z.number().positive().optional(),
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

export type ResolvedMfRedemptionInput = {
    scheme: string;
    folio_number: string;
    amount?: number;
    units?: number;
};

export const verify_redemption_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
});

export type VerifyRedemptionConfirmationOtpInput = z.infer<
    typeof verify_redemption_confirmation_otp_schema
>;