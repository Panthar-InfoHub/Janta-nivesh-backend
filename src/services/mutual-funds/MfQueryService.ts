import { gzip } from "zlib";
import logger from "../../middleware/logger.js";
import { db } from "../../server.js";
import { promisify } from "util";
import { redis_buffer_client } from "../../lib/redis.js";
import { decompressAndFilter } from "../../lib/utils.js";
import { Prisma } from "../../prisma/generated/prisma/client.js";
import type { MfProductOrderByWithRelationInput, MfProductWhereInput } from "../../prisma/generated/prisma/models.js";

const gzipAsync = promisify(gzip);

export type pagination = {
    page: number;
    limit: number;
}

export class MfQueryService {

    get_mutual_funds = async ({ pagination, query, order, search }: { pagination: pagination, query?: MfProductWhereInput, order?: MfProductOrderByWithRelationInput, search?: string }) => {
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;

        logger.debug("Order in service layer ==> ", order)
        const where: any = query ? { ...query } : {};

        // Enforce that we only return funds where SIP is allowed
        where.sip_allowed = true;

        // Globally exclude these terms from all results
        const excluded_words = ['Direct', 'IDCW', 'Reinvest', 'Institutional', 'Bonus', 'SIF'];
        const exclusion_conditions = excluded_words.map(word => ({
            scheme_name: {
                not: { contains: word },
                mode: 'insensitive'
            }
        }));

        if (!where.AND) {
            where.AND = exclusion_conditions;
        } else if (Array.isArray(where.AND)) {
            where.AND = [...where.AND, ...exclusion_conditions];
        } else {
            where.AND = [where.AND, ...exclusion_conditions];
        }

        // If search is provided, we use fuzzy similarity scoring via pg_trgm
        if (search && search.trim().length > 0) {
            try {
                // 1. Extract Filter Values
                const riskValue = typeof query?.risk_level === 'object' ? query?.risk_level?.equals : query?.risk_level;
                const categoryValue = typeof query?.asset_type === 'object' ? query?.asset_type?.equals : query?.asset_type;

                // 2. Build conditions array safely
                const conditions: Prisma.Sql[] = [];

                // Base search criteria
                const searchPattern = `%${search}%`;
                conditions.push(Prisma.sql`
            (
                p.scheme_name % ${search}::text 
                OR p.scheme_type % ${search}::text 
                OR p.amc_name % ${search}::text
                OR p.scheme_name ILIKE ${searchPattern}::text
            )
        `);

                // Global Exclusions
                conditions.push(Prisma.sql`p.scheme_name NOT ILIKE '%Direct%'`);
                conditions.push(Prisma.sql`p.scheme_name NOT ILIKE '%IDCW%'`);
                conditions.push(Prisma.sql`p.scheme_name NOT ILIKE '%Reinvest%'`);
                conditions.push(Prisma.sql`p.scheme_name NOT ILIKE '%Institutional%'`);
                conditions.push(Prisma.sql`p.scheme_name NOT ILIKE '%Bonus%'`);
                conditions.push(Prisma.sql`p.amc_code NOT ILIKE '%SIF%'`);

                // Enforce sip_allowed = true
                conditions.push(Prisma.sql`p.sip_allowed = true`);

                // Conditional additions with explicit casting at binding level
                if (riskValue !== undefined && riskValue !== null) {
                    conditions.push(Prisma.sql`p.risk_level = ${Number(riskValue)}::int`);
                }
                if (categoryValue) {
                    conditions.push(Prisma.sql`p.asset_type = ${categoryValue}::text`);
                }

                // Combine conditions using AND
                const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

                // 3. Define Sorting Threshold
                let sql_order_by = Prisma.sql`score DESC`;
                if (order?.metrics?.return_90d) sql_order_by = Prisma.sql`m.return_90d DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_6m) sql_order_by = Prisma.sql`m.return_6m DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_1y) sql_order_by = Prisma.sql`m.return_1y DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_3y) sql_order_by = Prisma.sql`m.return_3y DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_5y) sql_order_by = Prisma.sql`m.return_5y DESC NULLS LAST, score DESC`;

                // 4. Execute Main Search Query
                const searchResults = await db.$queryRaw<{ id: string, score: number }[]>`
            SELECT DISTINCT ON (p.id)
                p.id,
                (
                    similarity(p.scheme_name, ${search}::text) * 2.0 + 
                    coalesce(similarity(p.amc_name, ${search}::text), 0) +
                    (CASE WHEN p.scheme_name ILIKE ${search}::text THEN 0.5 ELSE 0 END)
                ) as score
            FROM "MfProduct" p
            LEFT JOIN "MfMetrics" m ON m.mf_product_id = p.id
            ${whereClause}
            ORDER BY p.id, ${sql_order_by}
            LIMIT ${limit}::int OFFSET ${offset}::int
        `;

                // 5. Execute Count Query using exact same whereClause (Prevents pagination sync errors)
                const totalResult = await db.$queryRaw<{ count: bigint }[]>`
            SELECT count(*) as count
            FROM "MfProduct" p
            ${whereClause}
        `;

                const total = Number(totalResult[0]?.count || 0);

                if (searchResults.length > 0) {
                    const ids = searchResults.map((r: any) => r.id);
                    const data = await db.mfProduct.findMany({
                        where: { id: { in: ids } },
                        include: { metrics: true }
                    });

                    const sortedData = ids.map((id: any) => data.find((d: any) => d.id === id)).filter(Boolean);

                    return {
                        mutual_funds: sortedData,
                        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
                    };
                } else {
                    return {
                        mutual_funds: [],
                        pagination: { total: 0, page, limit, totalPages: 0 }
                    };
                }
            } catch (error) {
                logger.error("Error in fuzzy search, falling back to basic contains matching:", error);
                (where as any).OR = [
                    { scheme_name: { contains: search, mode: 'insensitive' } },
                    { amc_name: { contains: search, mode: 'insensitive' } }
                ];
            }
        }

        if (search) {
            logger.debug("Searching fallback, using standard search....");
        } else {
            logger.debug("Executing standard query without search....");
        }

        const [total, data] = await Promise.all([
            db.mfProduct.count({ where }),
            db.mfProduct.findMany({
                where,
                include: {
                    metrics: {
                        select: {
                            return_3y: true,
                            return_1y: true,
                            return_90d: true,
                            return_6m: true,
                            return_5y: true,
                        }
                    },
                    transaction_rules: true,
                },
                skip: offset,
                take: limit,
                orderBy: (order && Object.keys(order).length > 0) ? order : [
                    { scheme_name: 'asc' },
                    { id: 'asc' } // Tie-breaker
                ]
            })
        ]);

        return {
            mutual_funds: data,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    get_category_query = (category: string): Prisma.MfProductWhereInput => {
        const baseQuery: Prisma.MfProductWhereInput = {
            sip_allowed: true,
            // metrics: {
            //     AND: {
            //         return_3y: { not: null },
            //         return_1y: { not: null },
            //         return_5y: { not: null },
            //         return_6m: { not: null },
            //         return_30d: { not: null },
            //         return_90d: { not: null },
            //     }
            // }
        };

        switch (category) {
            case 'flexi_cap':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Flexi-cap Fund', mode: 'insensitive' },
                    asset_type: 'Equity'
                };
            case 'large_Mid_cap':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Large & Mid Cap Fund', mode: 'insensitive' },
                    asset_type: 'Equity'
                };
            case 'large_cap':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Largecap Fund', mode: 'insensitive' },
                    asset_type: 'Equity'
                };
            case 'mid_cap':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Midcap Fund', mode: 'insensitive' },
                    asset_type: 'Equity'
                };
            case 'small_cap':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Smallcap Fund', mode: 'insensitive' },
                    asset_type: 'Equity'
                };
            case 'multi_cap':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Multicap Fund', mode: 'insensitive' },
                    asset_type: 'Equity'
                };
            case 'index':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'ETF/Index', mode: 'insensitive' }
                };
            case 'gold':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Gold-ETF', mode: 'insensitive' }
                };
            case 'silver':
                return {
                    ...baseQuery,
                    scheme_type: { contains: 'Silver-ETF', mode: 'insensitive' }
                };
            case 'global_others':
                return {
                    ...baseQuery,
                    asset_type: 'Others - Mutual Funds'
                };
            default:
                return baseQuery;
        }
    }

    get_funds_by_category = async ({ category, limit = 4, page = 1 }: { category: 'flexi_cap' | 'large_Mid_cap' | 'large_cap' | 'mid_cap' | 'small_cap' | 'index' | 'global_others' | 'multi_cap' | 'gold' | 'silver', limit?: number, page?: number }) => {
        const query = this.get_category_query(category);
        return await this.get_mutual_funds({
            pagination: { page, limit },
            query,
            order: { metrics: { return_1y: 'desc' } }
        });
    }

    get_top_funds_by_category_cached = async (category: string, limit: number = 10) => {
        const cache_key = `mutual_funds:category:${category}:${limit}`;
        try {
            const cached = await redis_buffer_client.get(cache_key);
            if (cached) {
                logger.info(`Top Fund by Category cache hit for key: ${cache_key}`);
                return await decompressAndFilter(cached as Buffer);
            }
        } catch (err) {
            logger.error(`[MfQueryService] Redis error getting category cache:`, err);
        }

        logger.info(`Top Fund by Category cache miss for key: ${cache_key}, querying DB`);
        const query = this.get_category_query(category);
        const result = await this.get_mutual_funds({
            pagination: { page: 1, limit },
            query,
            order: { metrics: { return_3y: 'desc' } }
        });

        try {
            const compressed = await gzipAsync(JSON.stringify(result));
            await redis_buffer_client.set(cache_key, compressed, { EX: 24 * 60 * 60 });
        } catch (err) {
            logger.error(`[MfQueryService] Redis error setting category cache:`, err);
        }

        return result;
    }

    get_mutual_fund_by_id = async (id: string) => {
        return await db.mfProduct.findUnique({
            where: { id },
            include: {
                metrics: {
                    select: {
                        return_30d: true,
                        return_90d: true,
                        return_6m: true,
                        return_1y: true,
                        return_3y: true,
                        return_5y: true,
                        nav_change_pct: true
                    }
                },
                transaction_rules: {
                    select: {
                        sip_allowed_dates: true,
                        sip_frequencies: true,
                        min_investment_amount: true,
                        min_lump_sum_amount: true,
                        min_sip_amount: true,
                        min_lumpsum_add_on_amount: true,
                        min_redem_qty: true,
                        min_redem_amount: true,
                        min_daily_sip_amount: true,
                        min_weekly_sip_amount: true,
                        min_fortnightly_sip_amount: true,
                        min_monthly_sip_amount: true,
                        min_quarterly_sip_amount: true,
                        min_semi_annual_sip_amount: true,
                        min_annual_sip_amount: true,
                    }
                }
            }
        });
    }

    get_mutual_fund_by_data = async (data: MfProductWhereInput) => {
        return await db.mfProduct.findFirst({
            where: data,
            include: {
                metrics: {
                    select: {
                        return_30d: true,
                        return_90d: true,
                        return_6m: true,
                        return_1y: true,
                        return_3y: true,
                        return_5y: true,
                        nav_change_pct: true
                    }
                },
                transaction_rules: {
                    select: {
                        sip_allowed_dates: true,
                        sip_frequencies: true,
                        min_investment_amount: true
                    }
                }
            }
        });
    }

    get_mutual_fund_history = async (id: string, period?: string) => {
        const history_key = `mf:h:${id}`;
        logger.info(`Fetching history for MF: ${id}, period: ${period}`);

        const compressedHistory = await redis_buffer_client.get(history_key);

        if (compressedHistory) {
            logger.debug(`Cache Hit for History: ${id}`);
            const nav_history = await decompressAndFilter(compressedHistory as Buffer, period);
            return nav_history;
        }

        logger.debug(`Cache Miss for History: ${id}. Get from DB...`);

        const mf_nav_history = await db.mfNavHistory.findMany({
            where: { mf_product_id: id },
            orderBy: { nav_date: 'desc' }
        });

        const compressed = await gzipAsync(JSON.stringify(mf_nav_history));
        await redis_buffer_client.set(history_key, compressed, { EX: 86400 });

        const filtered_history = await decompressAndFilter(compressed, period);
        return filtered_history;
    }

    get_only_mf_product = async (id: string) => {
        return await db.mfProduct.findUnique({
            where: { id },
            select: { id: true, scheme_id: true, scheme_name: true, mapping_code: true, platform_code: true, nse_scheme_code: true }
        });
    }

    get_mutual_fund_by_scheme_id = async (scheme_id: string) => {
        return await db.mfProduct.findFirst({
            where: { scheme_id },
            select: { id: true, scheme_id: true }
        });
    }
}
