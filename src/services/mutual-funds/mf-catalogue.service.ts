import { db } from "../../server.js";
import type { pagination } from "../../lib/types.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { redis, redis_buffer_client } from "../../lib/redis.js";
import { compress_json, decompressAndFilter } from "../../lib/utils.js";

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
    scheme_plan: {
        select: {
            lumpsum_amount_min: true,
            sip_monthly_amount_min: true,
            sip_daily_amount_min: true,
        }
    }
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
            if (!search || search.trim().length === 0) {
                scheme_plan_is.sip_daily_amount_min = { lte: 10 };
            }
        } else if (amount_type === "monthly_100") {
            scheme_plan_is.sip_monthly_allowed = true;
            if (!search || search.trim().length === 0) {
                scheme_plan_is.sip_monthly_amount_min = { lte: 100 };
            }
        } else if (investment_mode === "sip_daily" || investment_mode === "daily_sip") {
            scheme_plan_is.sip_daily_allowed = true;
        } else if (investment_mode === "sip") {
            scheme_plan_is.sip_monthly_allowed = true;
        } else if (investment_mode === "lumpsum") {
            scheme_plan_is.lumpsum_allowed = true;
        } else if (investment_mode === "any") {
            scheme_plan_is.OR = [
                { lumpsum_allowed: true },
                { sip_monthly_allowed: true },
                { sip_daily_allowed: true },
            ];
        } else {
            // Default "both": must allow both lumpsum and monthly SIP, ensuring 100% eligibility for cart & bundles
            scheme_plan_is.lumpsum_allowed = true;
            scheme_plan_is.sip_monthly_allowed = true;
            scheme_plan_is.sip_daily_allowed = true
        }

        const base_where: any = {
            ...FLEXIBLE_METRICS,
            scheme_plan: {
                is: scheme_plan_is,
            },
        };

        // 4. Search query (multi-token + pg_trgm fuzzy ranking & typo fallback)
        if (search && search.trim().length > 0) {
            const trimmed = search.trim();
            const { total, funds } = await this.search_ranked_funds(
                base_where,
                trimmed,
                page,
                limit,
            );

            return {
                tag,
                title: MF_SECTION_TITLES[tag],
                search: trimmed,
                category,
                amount_type,
                investment_mode,
                funds,
                pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
            };
        }

        const [total, funds] = await Promise.all([
            db.mfProduct.count({ where: base_where }),
            db.mfProduct.findMany({
                where: base_where,
                select: FUND_CARD_SELECT,
                orderBy: { metrics: { return_3y: { sort: "desc" as const, nulls: "last" as const } } },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            tag,
            title: MF_SECTION_TITLES[tag],
            search: undefined,
            category,
            amount_type,
            investment_mode,
            funds,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    };

    /**
     * Two-tier fuzzy search for mutual funds:
     * 1. Multi-token AND match (e.g. "Nip mid" -> "Nippon ... Mid...") ranked via pg_trgm.
     * 2. pg_trgm word_similarity / similarity typo fallback (e.g. "nipon midcp") when Tier 1 has 0 hits.
     */
    private search_ranked_funds = async (
        base_where: any,
        trimmed: string,
        page: number,
        limit: number,
    ) => {
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        const token_where = {
            ...base_where,
            AND: tokens.map((token) => ({
                OR: [
                    { name: { contains: token, mode: "insensitive" as const } },
                    { isin: { contains: token, mode: "insensitive" as const } },
                ],
            })),
        };

        const token_matches = await db.mfProduct.findMany({
            where: token_where,
            select: { id: true },
        });

        let ranked_ids: string[] = [];
        const first_prefix = `${tokens[0]?.toLowerCase() ?? ""}%`;

        if (token_matches.length > 0) {
            const candidate_ids = token_matches.map((m) => m.id);
            try {
                const rows = await db.$queryRaw<Array<{ id: string }>>`
                    SELECT id
                    FROM "MfProduct"
                    WHERE id = ANY(${candidate_ids}::text[])
                    ORDER BY
                        (lower(name) LIKE ${first_prefix}) DESC,
                        word_similarity(${trimmed}, name) DESC,
                        similarity(${trimmed}, name) DESC,
                        name ASC
                `;
                ranked_ids = rows.map((r) => r.id);
            } catch (err: any) {
                logger.warn("pg_trgm ranking failed, falling back to token order", { error: err?.message });
                ranked_ids = candidate_ids;
            }
        } else {
            // Tier 2: typo-tolerant fallback across all eligible funds for the current filter
            const eligible = await db.mfProduct.findMany({
                where: base_where,
                select: { id: true },
            });
            if (eligible.length > 0) {
                const eligible_ids = eligible.map((e) => e.id);
                const isin_like = `%${trimmed}%`;
                try {
                    const rows = await db.$queryRaw<Array<{ id: string }>>`
                        SELECT id
                        FROM "MfProduct"
                        WHERE id = ANY(${eligible_ids}::text[])
                          AND (
                              word_similarity(${trimmed}, name) > 0.25
                              OR similarity(${trimmed}, name) > 0.15
                              OR isin ILIKE ${isin_like}
                          )
                        ORDER BY
                            (lower(name) LIKE ${first_prefix}) DESC,
                            word_similarity(${trimmed}, name) DESC,
                            similarity(${trimmed}, name) DESC,
                            name ASC
                    `;
                    ranked_ids = rows.map((r) => r.id);
                } catch (err: any) {
                    logger.warn("pg_trgm fallback search failed", { error: err?.message });
                }
            }
        }

        const total = ranked_ids.length;
        const page_ids = ranked_ids.slice((page - 1) * limit, page * limit);

        if (page_ids.length === 0) {
            return { total, funds: [] };
        }

        const unsorted_funds = await db.mfProduct.findMany({
            where: { id: { in: page_ids } },
            select: FUND_CARD_SELECT,
        });

        const by_id = new Map(unsorted_funds.map((f) => [f.id, f]));
        const funds = page_ids.map((id) => by_id.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f));

        return { total, funds };
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

    /**
     * Fetch mutual fund product details by ID or ISIN with metrics and scheme plan.
     */
    get_mutual_fund_by_id = async (id: string) => {
        const cache_key = `mf:id:${id}`;

        try {
            const cached = await redis.get(cache_key);
            if (cached) {
                logger.debug(`Cache Hit for MF ID: ${id}`);
                return JSON.parse(cached as string);
            }
        } catch (err: any) {
            logger.warn(`Redis get failed for ${cache_key}: ${err?.message}`);
        }

        logger.debug(`Cache Miss for MF ID: ${id}. Fetching from DB...`);

        const product = await db.mfProduct.findFirst({
            where: {
                OR: [
                    { id },
                    { isin: id }
                ]
            },
            include: {
                metrics: {
                    select: {
                        id: true,
                        return_30d: true,
                        return_90d: true,
                        return_6m: true,
                        return_1y: true,
                        return_3y: true,
                        return_5y: true,
                        nav_change_pct: true,
                        updatedAt: true,
                    }
                },
                scheme_plan: {
                    select: {
                        id: true,
                        scheme_name: true,
                        fund_name: true,
                        gateway: true,
                        plan_type: true,
                        option: true,
                        idcw_option: true,
                        active: true,
                        lumpsum_allowed: true,
                        lumpsum_amount_min: true,
                        lumpsum_amount_max: true,
                        lumpsum_amount_multiples: true,
                        lumpsum_additional_amount_min: true,
                        withdrawal_allowed: true,
                        withdrawal_amount_min: true,
                        withdrawal_amount_max: true,
                        withdrawal_amount_multiples: true,
                        withdrawal_units_min: true,
                        withdrawal_units_multiples: true,
                        sip_daily_allowed: true,
                        sip_daily_amount_min: true,
                        sip_daily_amount_max: true,
                        sip_daily_amount_multiples: true,
                        sip_daily_installments_min: true,
                        sip_monthly_allowed: true,
                        sip_monthly_amount_min: true,
                        sip_monthly_amount_max: true,
                        sip_monthly_amount_multiples: true,
                        sip_monthly_installments_min: true,
                        sip_monthly_dates: true,
                        fund_category: true,
                        sub_category: true,
                        amfi_code: true,
                        amc_id: true,
                        close_ended: true,
                        lock_in: true,
                        lock_in_period: true,
                        purchase_allowed_v1: true,
                        redemption_allowed_v1: true,
                        instant_redemption_allowed: true,
                        sip_allowed: true,
                        stp_in_allowed: true,
                        stp_out_allowed: true,
                        switch_in_allowed: true,
                        switch_in_amount_min: true,
                        switch_in_amount_multiples: true,
                        switch_out_allowed: true,
                        switch_out_amount_min: true,
                        switch_out_amount_multiples: true,
                        switch_out_units_min: true,
                        switch_out_unit_multiples: true,
                        sip_frequency_data: true,
                        stp_frequency_data: true,
                        last_synced_at: true,
                        v1_synced_at: true,
                    }
                }
            }
        });

        if (!product) {
            throw new AppError("Mutual fund not found", 404, "MF_PRODUCT_NOT_FOUND");
        }

        try {
            await redis.set(`mf:id:${product.id}`, JSON.stringify(product), { EX: 3600 });
            if (product.isin && product.isin !== product.id) {
                await redis.set(`mf:id:${product.isin}`, JSON.stringify(product), { EX: 3600 });
            }
        } catch (err: any) {
            logger.warn(`Redis set failed for MF ID ${product.id}: ${err?.message}`);
        }

        return product;
    };

    /**
     * Fetch mutual fund NAV history by ID or ISIN, filtered by period (1m, 3m, 6m, 1y, 3y, 5y, all).
     * Uses Redis buffer compression (gzip) for O(1) high-performance delivery.
     */
    get_mutual_fund_history = async (id: string, period = "5y") => {
        // Resolve product to get true product_id if an ISIN was passed
        const product = await db.mfProduct.findFirst({
            where: {
                OR: [
                    { id },
                    { isin: id }
                ]
            },
            select: { id: true, isin: true, name: true }
        });

        if (!product) {
            throw new AppError("Mutual fund not found", 404, "MF_PRODUCT_NOT_FOUND");
        }

        const productId = product.id;
        const history_key = `mf:h:${productId}`;
        logger.info(`Fetching history for MF: ${productId} (${product.name}), period: ${period}`);

        let compressedHistory: Buffer | null = null;
        try {
            compressedHistory = await redis_buffer_client.get(history_key) as Buffer | null;
        } catch (err: any) {
            logger.warn(`Redis get failed for ${history_key}: ${err?.message}`);
        }

        if (compressedHistory) {
            logger.debug(`Cache Hit for History: ${productId}`);
            const nav_history = await decompressAndFilter(compressedHistory, period);
            return nav_history;
        }

        logger.debug(`Cache Miss for History: ${productId}. Fetching from DB...`);

        const mf_nav_history = await db.mfNavHistory.findMany({
            where: { mf_product_id: productId },
            orderBy: { nav_date: 'desc' },
            select: {
                nav: true,
                nav_date: true,
                daily_change: true,
            }
        });

        if (mf_nav_history.length === 0) {
            return [];
        }

        try {
            const compressed = await compress_json(mf_nav_history);
            await redis_buffer_client.set(history_key, compressed, { EX: 86400 });
            const filtered_history = await decompressAndFilter(compressed, period);
            return filtered_history;
        } catch (err: any) {
            logger.warn(`Redis set or compression failed for ${history_key}: ${err?.message}`);
            // Fallback: in-memory filter if compression encounters issues
            const now = new Date();
            const cutoffDate = new Date();
            switch (period) {
                case "1m": cutoffDate.setMonth(now.getMonth() - 1); break;
                case "3m": cutoffDate.setMonth(now.getMonth() - 3); break;
                case "6m": cutoffDate.setMonth(now.getMonth() - 6); break;
                case "1y": cutoffDate.setFullYear(now.getFullYear() - 1); break;
                case "3y": cutoffDate.setFullYear(now.getFullYear() - 3); break;
                case "5y": cutoffDate.setFullYear(now.getFullYear() - 5); break;
            }
            if (period === "all" || !period) return mf_nav_history;
            const cutoffTimestamp = cutoffDate.getTime();
            return mf_nav_history.filter((entry: any) => new Date(entry.nav_date).getTime() >= cutoffTimestamp);
        }
    };
}

export const mf_catalogue_service = new MfCatalogueServiceClass();
