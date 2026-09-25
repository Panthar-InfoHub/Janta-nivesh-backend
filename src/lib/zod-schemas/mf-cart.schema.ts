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

export const bundle_cart_selection_schema = z.object({
    mf_product_id: z.string().min(1, "MF product id is required"),
    allocation_percentage: z.number().min(0).max(100),
});

const base_add_bundle_to_cart_schema = z
    .object({
        bundle_id: z.string().min(1, "bundle_id is required"),

        cart_type: z.enum(["LUMPSUM", "SIP"]),

        amount: z
            .number()
            .positive("Amount must be greater than 0"),

        frequency: z
            .enum(["MONTHLY", "DAILY"])
            .optional(),

        installment_day: z
            .number()
            .int("Installment day must be an integer")
            .min(1, "Installment day must be at least 1")
            .max(31, "Installment day cannot be greater than 31")
            .optional(),

        clear_existing: z.boolean().optional().default(true),

        selections: z
            .array(bundle_cart_selection_schema)
            .min(1, "At least one fund selection is required"),
    })
    .superRefine((data, ctx) => {
        const total = data.selections.reduce(
            (sum, s) => sum + s.allocation_percentage,
            0,
        );
        if (Math.abs(total - 100) > 0.5) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["selections"],
                message: "selections' allocation_percentage must sum to 100",
            });
        }

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

export const add_bundle_to_cart_schema = z.preprocess((val: any) => {
    if (val && typeof val === "object") {
        const copy = { ...val };
        if (!copy.cart_type && copy.type) {
            copy.cart_type = copy.type;
        }
        if (copy.installment_day === undefined && copy.sip_day !== undefined) {
            copy.installment_day = Number(copy.sip_day);
        }
        if (!copy.frequency && copy.sip_freq) {
            if (copy.sip_freq === "OM") copy.frequency = "MONTHLY";
            else if (copy.sip_freq === "D" || copy.sip_freq === "DZ")
                copy.frequency = "DAILY";
            else copy.frequency = copy.sip_freq;
        }
        return copy;
    }
    return val;
}, base_add_bundle_to_cart_schema);

export type AddBundleToCartInput = z.infer<
    typeof base_add_bundle_to_cart_schema
>;

