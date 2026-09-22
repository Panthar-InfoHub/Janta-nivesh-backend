import { z } from "zod";

export const add_mf_cart_item_schema = z.object({
    mf_product_id: z.string().min(1, "MF product id is required"),

    cart_type: z.enum(["LUMPSUM", "SIP"]),

    amount: z
        .number()
        .positive("Amount must be greater than 0"),

    frequency: z
        .enum(["MONTHLY", "WEEKLY", "DAILY"])
        .optional(),

    installment_day: z
        .number()
        .int("Installment day must be an integer")
        .min(1, "Installment day must be at least 1")
        .max(31, "Installment day cannot be greater than 31")
        .optional(),
}).superRefine((data, ctx) => {
    if (data.cart_type === "LUMPSUM") {
        if (data.frequency !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["frequency"],
                message: "Frequency is not applicable for LUMPSUM",
            });
        }

        if (data.installment_day !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["installment_day"],
                message: "Installment day is not applicable for LUMPSUM",
            });
        }
    }
});

export const update_mf_cart_item_schema = z
    .object({
        amount: z
            .number()
            .positive("Amount must be greater than 0")
            .optional(),

        installment_day: z
            .number()
            .int("Installment day must be an integer")
            .min(1, "Installment day must be at least 1")
            .max(31, "Installment day cannot be greater than 31")
            .optional(),
    })
    .refine(
        (data) =>
            data.amount !== undefined ||
            data.installment_day !== undefined,
        {
            message: "At least amount or installment_day is required",
        },
    );

export type AddMfCartItemInput = z.infer<
    typeof add_mf_cart_item_schema
>;

export type UpdateMfCartItemInput = z.infer<
    typeof update_mf_cart_item_schema
>;

export const confirm_lumpsum_checkout_schema = z.object({
    batch_id: z.string().min(1, "batch_id is required"),
    otp: z.string().length(6, "OTP must be 6 digits"),
    payment_postback_url: z
        .string()
        .url("Invalid payment_postback_url")
        .optional(),
});

export type ConfirmLumpsumCheckoutInput = z.infer<
    typeof confirm_lumpsum_checkout_schema
>;
