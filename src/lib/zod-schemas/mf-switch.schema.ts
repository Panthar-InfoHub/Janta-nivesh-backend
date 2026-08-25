import { z } from "zod";

export const create_mf_switch_schema = z.object({
    source_mf_product_id: z.string().min(1),
    destination_mf_product_id: z.string().min(1),
    folio_number: z.string().min(1),

    amount: z.number().int().positive().optional(),
    units: z.number().positive().optional(),
}).refine(
    (value) => !(value.amount !== undefined && value.units !== undefined),
    {
        message: "Provide either amount or units, not both",
        path: ["amount"],
    }
);

export type CreateMfSwitchInput = z.infer<
    typeof create_mf_switch_schema
>;

export type ResolvedMfSwitchInput = {
    switch_out_scheme: string;
    switch_in_scheme: string;
    folio_number: string;
    amount?: number;
    units?: number;
};

export const verify_switch_confirmation_otp_schema = z.object({
    otp: z.string().length(4),
});

export type VerifyMfSwitchConfirmationOtpInput = z.infer<
    typeof verify_switch_confirmation_otp_schema
>;