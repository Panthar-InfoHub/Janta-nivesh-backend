import { z } from "zod";
import { MF_SECTION_TAGS } from "../../services/mutual-funds/mf-catalogue.service.js";

export const FUND_CATEGORIES = ["all", "equity", "debt", "liquid"] as const;
export type FundCategory = (typeof FUND_CATEGORIES)[number];

export const AMOUNT_TYPES = ["daily_10", "monthly_100"] as const;
export type AmountType = (typeof AMOUNT_TYPES)[number];

// GET /api/v2/mf/funds?tag=popular&category=equity&amount_type=daily_10&search=...
export const funds_by_tag_query_schema = z.object({
    tag: z.enum(MF_SECTION_TAGS).optional().default("popular"),
    search: z.string().trim().optional(),
    category: z.enum(FUND_CATEGORIES).optional().default("all"),
    amount_type: z.enum(AMOUNT_TYPES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().max(50).default(5),
});

export type FundsByTagQuery = z.infer<typeof funds_by_tag_query_schema>;
