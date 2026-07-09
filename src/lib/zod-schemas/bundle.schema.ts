import { z } from "zod";

export const bundle_slot_schema = z.object({
    allocation_percentage: z.number().min(0).max(100),
    default_rank: z.number().int().positive(),
});

export const bundle_category_schema = z.object({
    category_name: z.string().min(1),
    display_name: z.string().min(1),
    total_percentage: z.number().min(0).max(100),
    slots: z.array(bundle_slot_schema).min(1, "At least one slot is required in a category"),
});

export const create_bundle_zod_schema = z.object({
    bundle_name: z.string().min(1, "Bundle name is required"),
    bundle_description: z.string().min(1, "Bundle description is required"),
    equity_percentage: z.number().min(0).max(100).optional().default(0),
    hybrid_percentage: z.number().min(0).max(100).optional().default(0),
    commodity_percentage: z.number().min(0).max(100).optional().default(0),
    debt_percentage: z.number().min(0).max(100).optional().default(0),
    meta_data: z.object({
        risk_level: z.string(),
        investment_growth: z.string(),
        investment_time: z.string(),
    }),
    categories: z.array(bundle_category_schema).min(1, "At least one category is required in a bundle"),
});

export type CreateBundleInput = z.infer<typeof create_bundle_zod_schema>;

// ─── Add Bundle to Cart ───────────────────────────────────────────────────────

export const bundle_selection_schema = z.object({
    mf_product_id: z.string(),
    allocation_percentage: z.number().min(0).max(100),
});

const selections_sum_to_100 = (selections: z.infer<typeof bundle_selection_schema>[]) => {
    const total = selections.reduce((sum, s) => sum + s.allocation_percentage, 0);
    return Math.abs(total - 100) <= 0.5;
};

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
    selections: z.array(bundle_selection_schema).min(1, "At least one fund selection is required"),
});

export const add_bundle_lumpsum_schema = z.object({
    type: z.literal("LUMPSUM"),
    bundle_id: z.string().min(1, "bundle_id is required"),
    amount: z.number().positive("amount must be positive"),
    selections: z.array(bundle_selection_schema).min(1, "At least one fund selection is required"),
});

export const add_bundle_to_cart_schema = z.discriminatedUnion("type", [
    add_bundle_sip_schema,
    add_bundle_lumpsum_schema,
]).refine((data) => selections_sum_to_100(data.selections), {
    message: "selections' allocation_percentage must sum to 100",
    path: ["selections"],
});

export type AddBundleToCartInput = z.infer<typeof add_bundle_to_cart_schema>;
