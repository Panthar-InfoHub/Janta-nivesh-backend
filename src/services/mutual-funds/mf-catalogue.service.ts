import { db } from "../../server.js";
import type { pagination } from "../../lib/types.js";

export {
    MF_SECTION_TAGS,
    type MfSectionTag,
    MF_SECTION_TITLES,
    FUND_CATEGORIES,
    type FundCategory,
    AMOUNT_TYPES,
    type AmountType,
    INVESTMENT_MODES,
    type InvestmentMode,
} from "../../lib/zod-schemas/mf-catalogue.schema.js";

import {
    MF_SECTION_TAGS,
    MF_SECTION_TITLES,
    type MfSectionTag,
    type FundCategory,
    type AmountType,
    type InvestmentMode,
} from "../../lib/zod-schemas/mf-catalogue.schema.js";

export type GetFundsOptions = {
    tag?: MfSectionTag;
    search?: string;
    category?: FundCategory;
    amount_type?: AmountType;
    investment_mode?: InvestmentMode;
    page: number;
    limit: number;
};

// Flexible metrics: fund has at least 1Y, 3Y, or 5Y return track record.
// Prevents newer, high-performing funds under 5 years old from being completely excluded.
const FLEXIBLE_METRICS = {
    metrics: {
        is: {
            OR: [
                { return_1y: { not: null } },
                { return_3y: { not: null } },
                { return_5y: { not: null } },
            ],
        },
    },
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
     * Unified query method for catalogue browsing, search, category, amount filters, and transaction eligibility.
     */
    get_funds = async ({
        tag = "popular",
        search,
        category = "all",
        amount_type,
        investment_mode = "both",
        page,
        limit,
    }: GetFundsOptions) => {
        // Base scheme_plan conditions: active regular growth
        const scheme_plan_is: Record<string, any> = {
            plan_type: "regular",
            option: "growth",
            active: true,
        };

        // 1. Tag / Sub-category filter (unless 'popular' which shows all subcategories)
        if (tag && tag !== "popular") {
            scheme_plan_is.sub_category = MF_SECTION_TITLES[tag];
        }

        // 2. Fund Category filter (equity, debt, liquid)
        if (category && category !== "all") {
            scheme_plan_is.fund_category = { equals: category, mode: "insensitive" };
        }

        // 3. Amount / SIP threshold filter & Transaction Mode Eligibility
        if (amount_type === "daily_10") {
            scheme_plan_is.sip_daily_allowed = true;
            scheme_plan_is.sip_daily_amount_min = { lte: 10 };
        } else if (amount_type === "monthly_100") {
            scheme_plan_is.sip_monthly_allowed = true;
            scheme_plan_is.sip_monthly_amount_min = { lte: 100 };
        } else if (investment_mode === "sip") {
            scheme_plan_is.sip_monthly_allowed = true;
        } else if (investment_mode === "lumpsum") {
            scheme_plan_is.lumpsum_allowed = true;
        } else if (investment_mode === "any") {
            scheme_plan_is.OR = [
                { lumpsum_allowed: true },
                { sip_monthly_allowed: true },
            ];
        } else {
            // Default "both": must allow both lumpsum and monthly SIP, ensuring 100% eligibility for cart & bundles
            scheme_plan_is.lumpsum_allowed = true;
            scheme_plan_is.sip_monthly_allowed = true;
        }

        const where: any = {
            ...FLEXIBLE_METRICS,
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
                orderBy: search
                    ? { name: "asc" as const }
                    : { metrics: { return_3y: { sort: "desc" as const, nulls: "last" as const } } },
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
            investment_mode,
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
