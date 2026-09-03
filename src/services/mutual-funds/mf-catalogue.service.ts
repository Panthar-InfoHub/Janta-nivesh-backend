import { db } from "../../server.js";
import type { pagination } from "../../lib/types.js";

/**
 * Section tags. Each is a named slice of the catalogue the discovery screens render, and the
 * value doubles as the query param the "see all" screen passes to GET /api/v2/mf/funds?tag=.
 *
 * Only `popular` resolves to real funds today - every category tag needs a category/sector field
 * on MfProduct, which the curated catalogue doesn't carry yet (DISC-0 in Todo.md). They're
 * declared here so the response shape is final and the frontend can build against it; each
 * returns an empty list until that column lands.
 */
export const MF_SECTION_TAGS = [
    "popular",
    "large_cap",
    "mid_cap",
    "small_cap",
    "flexi_cap",
    "multi_cap",
    "others",
    "debt", //index
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

export type GetFundsOptions = {
    tag?: MfSectionTag;
    search?: string;
    category?: FundCategory;
    amount_type?: AmountType;
    page: number;
    limit: number;
};

// Funds with a complete return history. A fund under five years old legitimately has a null
// return_5y, and ranking it beside funds with a full track record compares things that aren't
// comparable - so those are excluded rather than sorted to the bottom.
const COMPLETE_METRICS = {
    metrics: {
        is: {
            return_1y: { not: null },
            return_3y: { not: null },
            return_5y: { not: null },
        },
    },
    scheme_plan: {
        is: {
            plan_type: 'regular',
            option: 'growth'
        }
    }
};

const FUND_CARD_SELECT = {
    id: true,
    name: true,
    isin: true,
    img_url: true,
    latest_nav: true,
    latest_nav_date: true,
    metrics: {
        select: {
            return_1y: true,
            return_3y: true,
            return_5y: true,
            return_6m: true,
            return_90d: true,
            return_30d: true,
            nav_change_pct: true,
        },
    },
} as const;

// Read-side of the curated catalogue - what the app's discovery screens query. Separate from
// mf-product.service.ts, which owns the admin import and id lookups.
class MfCatalogueServiceClass {

    /**
     * Unified query method for catalogue browsing, search, category, and amount filters.
     */
    get_funds = async ({
        tag = "popular",
        search,
        category = "all",
        amount_type,
        page,
        limit,
    }: GetFundsOptions) => {
        // Base scheme_plan conditions: regular growth
        const scheme_plan_is: Record<string, any> = {
            plan_type: "regular",
            option: "growth",
        };

        // 1. Tag / Sub-category filter (unless 'popular' which shows all subcategories)
        if (tag && tag !== "popular") {
            scheme_plan_is.sub_category = MF_SECTION_TITLES[tag];
        }

        // 2. Fund Category filter (equity, debt, liquid)
        if (category && category !== "all") {
            scheme_plan_is.fund_category = { equals: category, mode: "insensitive" };
        }

        // 3. Amount / SIP threshold filter
        if (amount_type === "daily_10") {
            scheme_plan_is.sip_daily_allowed = true;
            scheme_plan_is.sip_daily_amount_min = { lte: 10 };
        } else if (amount_type === "monthly_100") {
            scheme_plan_is.sip_monthly_allowed = true;
            scheme_plan_is.sip_monthly_amount_min = { lte: 100 };
        }

        const where: any = {
            ...COMPLETE_METRICS,
            scheme_plan: {
                is: scheme_plan_is,
            },
        };

        // 4. Search query (name or isin)
        if (search && search.trim().length > 0) {
            const trimmed = search.trim();
            where.OR = [
                { name: { contains: trimmed, mode: "insensitive" } },
                { isin: { contains: trimmed, mode: "insensitive" } },
            ];
        }

        const [total, funds] = await Promise.all([
            db.mfProduct.count({ where }),
            db.mfProduct.findMany({
                where,
                select: FUND_CARD_SELECT,
                orderBy: search ? { name: "asc" as const } : { metrics: { return_3y: "desc" as const } },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            tag,
            title: MF_SECTION_TITLES[tag],
            search: search ? search.trim() : undefined,
            category,
            amount_type,
            funds,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    };

    /** One tag's funds, paginated. Backs GET /api/v2/mf/funds?tag=... (the "see all" screen). */
    get_funds_by_tag = async (tag: MfSectionTag, { page, limit }: pagination) => {
        return this.get_funds({ tag, page, limit });
    };

    /** Search funds by name or ISIN, paginated. */
    search_funds = async (query: string, { page, limit }: pagination) => {
        return this.get_funds({ search: query, page, limit });
    };

    /**
     * All sections at once for the home screen - each capped at `per_section` since the carousels
     * only show a handful before the "see all" arrow.
     */
    get_sections = async (per_section = 5) => {
        const sections = await Promise.all(
            MF_SECTION_TAGS.map(tag => this.get_funds_by_tag(tag, { page: 1, limit: per_section }))
        );

        // Keyed by tag so the frontend can address a section directly rather than scanning an array.
        return Object.fromEntries(
            sections.map(section => [section.tag, {
                tag: section.tag,
                title: section.title,
                funds: section.funds,
            }])
        );
    }
}

export const mf_catalogue_service = new MfCatalogueServiceClass();
