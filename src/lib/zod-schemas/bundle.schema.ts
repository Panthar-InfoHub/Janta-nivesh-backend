import { z } from "zod";

export const bundle_product_schema = z.object({
    mf_product_id: z.string(),
    allocation_percentage: z.number().min(0).max(100),
    min_amount: z.number().nonnegative().optional().nullable(),
});

export const create_bundle_zod_schema = z.object({
    bundle_name: z.string().min(1, "Bundle name is required"),
    bundle_products: z.array(bundle_product_schema).min(1, "At least one product is required in a bundle"),
});

export type CreateBundleInput = z.infer<typeof create_bundle_zod_schema>;

// ─── Add Bundle to Cart ───────────────────────────────────────────────────────

export const add_bundle_sip_schema = z.object({
    type: z.literal("SIP"),
    bundle_id: z.string().min(1, "bundle_id is required"),
    amount: z.number().positive("amount must be positive"),
    sip_st_date: z.string().refine((date) => {
        const now = new Date();
        const inputDate = new Date(date);
        return inputDate.getTime() - now.getTime() >= 30 * 24 * 60 * 60 * 1000;
    }, { message: "SIP start date must be at least 30 days in the future" }),
    sip_en_date: z.string().refine((date) => {
        const inputDate = new Date(date);
        const maxDate = new Date("2099-12-31");
        return inputDate <= maxDate;
    }, { message: "SIP end date must be on or before December 31, 2099" }),
    sip_freq: z.enum(["DZ", "D", "OM", "Q", "WD", "OW", "H", "Y"]),
    sip_day: z.number(),
    sip_amt: z.number().positive("sip_amt must be positive"),
});

export const add_bundle_lumpsum_schema = z.object({
    type: z.literal("LUMPSUM"),
    bundle_id: z.string().min(1, "bundle_id is required"),
    amount: z.number().positive("amount must be positive"),
});

export const add_bundle_to_cart_schema = z.discriminatedUnion("type", [
    add_bundle_sip_schema,
    add_bundle_lumpsum_schema,
]);

export type AddBundleToCartInput = z.infer<typeof add_bundle_to_cart_schema>;
