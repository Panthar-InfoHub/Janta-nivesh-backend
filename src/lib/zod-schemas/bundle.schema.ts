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
