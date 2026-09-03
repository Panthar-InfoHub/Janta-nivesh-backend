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
     * Filter for one tag. Category tags have no data source yet, so they're deliberately
     * unsatisfiable (`id: ""` never matches) rather than silently falling back to every fund -
     * an empty section is honest, a wrong one isn't.
     */
    private where_for_tag = (tag: MfSectionTag) => {
        if (tag === "popular") return COMPLETE_METRICS;

        const sub_category = MF_SECTION_TITLES[tag];
        // 3. Return COMPLETE_METRICS with the extra sub_category filter inside scheme_plan
        return {
            ...COMPLETE_METRICS,
            scheme_plan: {
                is: {
                    ...COMPLETE_METRICS.scheme_plan.is,
                    sub_category: sub_category,
                },
            },
        };
    }

    /** One tag's funds, paginated. Backs GET /api/v2/mf/funds?tag=... (the "see all" screen). */
    get_funds_by_tag = async (tag: MfSectionTag, { page, limit }: pagination) => {
        const where = this.where_for_tag(tag);

        const [total, funds] = await Promise.all([
            db.mfProduct.count({ where }),
            db.mfProduct.findMany({
                where,
                select: FUND_CARD_SELECT,
                // Nulls are excluded by `where`, so ordering on the relation is safe.
                orderBy: { metrics: { return_3y: "desc" } },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            tag,
            title: MF_SECTION_TITLES[tag],
            funds,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    }

    /** Search funds by name or ISIN, paginated. */
    search_funds = async (query: string, { page, limit }: pagination) => {
        const trimmed = query.trim();
        const where = {
            OR: [
                { name: { contains: trimmed, mode: "insensitive" as const } },
                { isin: { contains: trimmed, mode: "insensitive" as const } },
            ],
        };

        const [total, funds] = await Promise.all([
            db.mfProduct.count({ where }),
            db.mfProduct.findMany({
                where,
                select: FUND_CARD_SELECT,
                orderBy: { name: "asc" as const },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            search: trimmed,
            funds,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    }

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
