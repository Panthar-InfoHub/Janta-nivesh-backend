import { z } from "zod";

export const MF_SECTION_TAGS = [
    "popular",
    "large_cap",
    "mid_cap",
    "small_cap",
    "flexi_cap",
    "multi_cap",
    "others",
    "debt",
] as const;

export type MfSectionTag = (typeof MF_SECTION_TAGS)[number];

export const MF_SECTION_TITLES: Record<MfSectionTag, string> = {
    popular: "Popular Funds",
    large_cap: "Large Cap",
    mid_cap: "Mid Cap",
    small_cap: "Small Cap",
    flexi_cap: "Flexi Cap",
    multi_cap: "Multi Cap",
    others: "Other",
    debt: "Debt",
};

export const FUND_CATEGORIES = ["all", "equity", "debt", "liquid"] as const;
export type FundCategory = (typeof FUND_CATEGORIES)[number];

export const AMOUNT_TYPES = ["daily_10", "monthly_100"] as const;
export type AmountType = (typeof AMOUNT_TYPES)[number];

export const INVESTMENT_MODES = ["both", "sip", "lumpsum", "any"] as const;
export type InvestmentMode = (typeof INVESTMENT_MODES)[number];

// GET /api/v2/mf/funds?tag=popular&category=equity&amount_type=daily_10&investment_mode=both&search=...
export const funds_by_tag_query_schema = z.object({
    tag: z.enum(MF_SECTION_TAGS).optional().default("popular"),
    search: z.string().trim().optional(),
    category: z.enum(FUND_CATEGORIES).optional().default("all"),
    amount_type: z.enum(AMOUNT_TYPES).optional(),
    investment_mode: z.enum(INVESTMENT_MODES).optional().default("both"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().max(50).default(5),
});

export type FundsByTagQuery = z.infer<typeof funds_by_tag_query_schema>;

