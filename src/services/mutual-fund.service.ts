import axios from "axios";
import logger from "../middleware/logger.js";
import { db } from "../server.js";

import { promisify } from "util";
import { gzip } from "zlib";
import { generate_unique_code } from "../helpers/unique.code.js";
import { env } from "../lib/config-env.js";
import { redis_buffer_client } from "../lib/redis.js";
import { Lumpsum_cart_data, Redeem_request_data, Sip_cart_data } from "../lib/types.js";
import { decompressAndFilter } from "../lib/utils.js";
import { AddBundleToCartInput } from "../lib/zod-schemas/bundle.schema.js";
import AppError from "../middleware/error.middleware.js";
import { Prisma } from "../prisma/generated/prisma/client.js";
import type { MfProductOrderByWithRelationInput, MfProductWhereInput } from "../prisma/generated/prisma/models.js";
import { bundle_service } from "./bundle.services.js";
import { mutual_fund_finnsys_service } from "./finnsys/mf.finnsys.service.js";
import { nse_service } from "./nse.service.js";
import { user_service } from "./user.service.js";
const gzipAsync = promisify(gzip);

export type pagination = {
    page: number;
    limit: number;
}



class MutualFundServiceClass {

    finnsys_base_url: string;

    constructor() {
        this.finnsys_base_url = env.finsys_base_api;
    }

    /**
     * Maps frequency code to readable frequency type
     * @param freq_code - Frequency code (DZ, D, OM, Q, WD, OW, H, Y)
     * @returns Readable frequency type string
     */
    private map_frequency_code_to_type(freq_code: string): string {
        const frequency_map: { [key: string]: string } = {
            'DZ': 'DAILY',
            'D': 'DAILY',
            'WD': 'WEEKLY',
            'OW': 'FORTNIGHTLY',
            'OM': 'MONTHLY',
            'Q': 'QUARTERLY',
            'H': 'SEMI-ANNUAL',
            'Y': 'ANNUAL'
        };

        const mapped_type = frequency_map[freq_code];
        if (!mapped_type) {
            throw new AppError(`Invalid frequency code: ${freq_code}`, 400, "INVALID_FREQUENCY_CODE");
        }
        return mapped_type;
    }

    /**
     * Retrieves a paginated list of mutual funds with optional filtering, sorting, and fuzzy search capabilities.
     * 
     * @param params - The parameters for retrieving mutual funds.
     * @param params.pagination - Pagination details (page and limit).
     * @param params.query - Prisma where input for filtering by exact fields (e.g., risk_level, asset_type).
     * @param params.order - Prisma order by input for sorting the results.
     * @param params.search - Optional search string. If provided, applies a fuzzy search (pg_trgm) across scheme name, scheme type, and AMC name.
     * @returns A promise that resolves to an object containing the list of mutual funds and pagination metadata.
     */
    get_mutual_funds = async ({ pagination, query, order, search }: { pagination: pagination, query?: MfProductWhereInput, order?: MfProductOrderByWithRelationInput, search?: string }) => {
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;

        logger.debug("Order in service layer ==> ", order)
        const where: any = query ? { ...query } : {};

        // Globally exclude these terms from all results
        const excluded_words = ['Direct', 'IDCW', 'Reinvest', 'Institutional'];
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
            SELECT 
                p.id,
                (
                    similarity(p.scheme_name, ${search}::text) * 2.0 + 
                    coalesce(similarity(p.amc_name, ${search}::text), 0) +
                    (CASE WHEN p.scheme_name ILIKE ${search}::text THEN 0.5 ELSE 0 END)
                ) as score
            FROM "MfProduct" p
            LEFT JOIN "MfMetrics" m ON m.mf_product_id = p.id
            ${whereClause}
            ORDER BY ${sql_order_by}
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
                    const ids = searchResults.map(r => r.id);
                    const data = await db.mfProduct.findMany({
                        where: { id: { in: ids } },
                        include: { metrics: true }
                    });

                    const sortedData = ids.map(id => data.find(d => d.id === id)).filter(Boolean);

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
                    }
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

    get_funds_by_category = async ({ category, limit = 4, page = 1 }: { category: 'flexi_cap' | 'large_Mid_cap' | 'large_cap' | 'mid_cap' | 'small_cap' | 'index' | 'global_others', limit?: number, page?: number }) => {
        const baseQuery: Prisma.MfProductWhereInput = {
            metrics: {
                AND: {
                    return_3y: { not: null },
                    return_1y: { not: null },
                    return_5y: { not: null },
                    return_6m: { not: null },
                    return_30d: { not: null },
                    return_90d: { not: null },
                }
            }
        };

        let query: Prisma.MfProductWhereInput = { ...baseQuery };

        switch (category) {
            case 'flexi_cap':
                query = {
                    ...baseQuery,
                    scheme_type: {
                        contains: 'Flexi-cap Fund',
                        mode: 'insensitive'
                    },
                    asset_type: 'Equity'
                };
                break;
            case 'large_Mid_cap':
                query = {
                    ...baseQuery,
                    scheme_type: {
                        contains: 'Large & Mid Cap Fund',
                        mode: 'insensitive'
                    },
                    asset_type: 'Equity'
                };
                break;
            case 'large_cap':
                query = {
                    ...baseQuery,
                    scheme_type: {
                        contains: 'Largecap Fund',
                        mode: 'insensitive'
                    },
                    asset_type: 'Equity'
                };
                break;
            case 'mid_cap':
                query = {
                    ...baseQuery,
                    scheme_type: {
                        contains: 'Midcap Fund',
                        mode: 'insensitive'
                    },
                    asset_type: 'Equity'
                };
                break;
            case 'small_cap':
                query = {
                    ...baseQuery,
                    scheme_type: {
                        contains: 'Smallcap Fund',
                        mode: 'insensitive'
                    },
                    asset_type: 'Equity'
                };
                break;
            case 'index':
                query = {
                    ...baseQuery,
                    scheme_type: {
                        contains: 'ETF/Index',
                        mode: 'insensitive'
                    }
                };
                break;
            case 'global_others':
                query = {
                    ...baseQuery,
                    asset_type: 'Others - Mutual Funds'
                };
                break;
        }

        return await this.get_mutual_funds({
            pagination: { page, limit },
            query,
            order: { metrics: { return_1y: 'desc' } }
        });
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




    // Purchasing service lumpsum and sip to finnsys cart
    add_lumpsum_cart = async (lumpsum_data: Lumpsum_cart_data, user_data: { log: string, pwd: string }) => {
        try {

            const response = await axios.get(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, {
                params: {
                    log: user_data.log,
                    pwd: user_data.pwd,
                    svc: 'addcartlumpsum',
                    sub_txn_type: 'N',
                    amc_code: lumpsum_data.amc_code,
                    amc_name: lumpsum_data.amc_name,
                    prod_code: lumpsum_data.prod_code,
                    prod_name: lumpsum_data.prod_name,
                    reinv_flag: lumpsum_data.reinv_flag || 'Y',
                    txn_amount: lumpsum_data.txn_amount
                }
            });

            logger.debug("Add to lumpsum cart response ==> ", response.data);
            return response.data;

        } catch (error) {
            logger.error("Error adding to lumpsum cart service ==> ", error);
            throw new AppError("Failed to add to lumpsum cart", 500, "ADD_TO_CART_ERROR");
        }
    }


    add_sip_cart = async (sip_data: Sip_cart_data, user_data: { log: string, pwd: string }) => {
        try {
            const response = await axios.get(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, {
                params: {
                    log: user_data.log,
                    pwd: user_data.pwd,
                    svc: 'addcartsip',
                    sub_txn_type: 'S',
                    amc_code: sip_data.amc_code,
                    amc_name: sip_data.amc_name,
                    prod_code: sip_data.prod_code,
                    prod_name: sip_data.prod_name,
                    reinv_flag: sip_data.reinv_flag || 'Y',
                    txn_amount: sip_data.txn_amount,
                    sip_st_date: sip_data.sip_st_date,
                    sip_en_date: sip_data.sip_en_date,
                    sip_freq: sip_data.sip_freq,
                    sip_day: sip_data.sip_day,
                    sip_amt: sip_data.sip_amt
                }
            });

            // logger.debug("Add to sip cart response ==> ", response.data);
            return response.data;

        } catch (error) {
            logger.error("Error adding to sip cart service ==> ", error);
            throw new AppError("Failed to add to sip cart", 500, "ADD_TO_CART_ERROR");
        }
    }

    get_mutual_fund_by_scheme_id = async (scheme_id: string) => {
        return await db.mfProduct.findFirst({
            where: { scheme_id },
            select: { id: true, scheme_id: true }
        });
    }

    private get_primary_bank_details(user: any) {
        if (!user.user_bank_details || user.user_bank_details.length === 0) {
            throw new AppError("No bank details found for user", 400, "BANK_DETAILS_MISSING");
        }

        const primary_bank = user.user_bank_details.find((b: any) => b.is_primary) || user.user_bank_details[0];
        return primary_bank;
    }

    private extract_date_range_from_sip_items(sip_items: any[]): { start_date: string; end_date: string } {
        if (!sip_items || sip_items.length === 0) {
            throw new AppError("No SIP items found", 400, "NO_SIP_ITEMS");
        }

        // Parse date string to comparable format (YYYY-MM-DD for comparison)
        const parse_date = (date_str: string): { comparable: string; formatted: string } => {
            // Format 1: DD-MMM-YYYY (e.g., "30-Jul-2026")
            if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(date_str)) {
                const months: { [key: string]: string } = {
                    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                };
                const [day, mon, year] = date_str.split('-');
                const month = months[mon];
                if (!month) throw new AppError(`Invalid month in date: ${date_str}`, 400, "INVALID_DATE_FORMAT");
                const comparable = `${year}-${month}-${day}`;
                const formatted = `${day}/${month}/${year}`;
                return { comparable, formatted };
            }
            // Format 2: DD/MM/YYYY (e.g., "30/07/2026")
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(date_str)) {
                const [day, month, year] = date_str.split('/');
                const comparable = `${year}-${month}-${day}`;
                const formatted = date_str;
                return { comparable, formatted };
            }
            // Format 3: YYYY-MM-DD (e.g., "2026-07-30")
            if (/^\d{4}-\d{2}-\d{2}$/.test(date_str)) {
                const [year, month, day] = date_str.split('-');
                const comparable = date_str;
                const formatted = `${day}/${month}/${year}`;
                return { comparable, formatted };
            }
            throw new AppError(`Invalid date format: ${date_str}. Expected DD-MMM-YYYY, DD/MM/YYYY, or YYYY-MM-DD`, 400, "INVALID_DATE_FORMAT");
        };

        // Parse all start and end dates
        const all_dates = sip_items.map((item: any) => ({
            start: parse_date(item.sip_st_date),
            end: parse_date(item.sip_en_date)
        }));

        // Find minimum start date and maximum end date
        const min_start = all_dates.reduce((min, curr) =>
            curr.start.comparable < min.start.comparable ? curr : min
        ).start;

        const max_end = all_dates.reduce((max, curr) =>
            curr.end.comparable > max.end.comparable ? curr : max
        ).end;

        return {
            start_date: min_start.formatted,
            end_date: max_end.formatted
        };
    }

    private calculate_total_sip_amount(sip_items: any[]): string {
        if (!sip_items || sip_items.length === 0) {
            throw new AppError("No SIP items found", 400, "NO_SIP_ITEMS");
        }

        const total = sip_items.reduce((sum: number, item: any) => {
            const amount = parseFloat(item.sip_amt || item.txn_amount || "0");
            if (isNaN(amount)) {
                throw new AppError(`Invalid amount in cart item: ${item.sip_amt || item.txn_amount}`, 400, "INVALID_AMOUNT");
            }
            return sum + amount;
        }, 0);

        return total.toString();
    }

    private calculate_installments_count(sip_items: any[], start_date: string, end_date: string): { [key: number]: number } {
        if (!sip_items || sip_items.length === 0) {
            throw new AppError("No SIP items found", 400, "NO_SIP_ITEMS");
        }

        // Parse dates to comparable format (YYYY-MM-DD)
        const parse_date = (date_str: string): Date => {
            // Format 1: DD-MMM-YYYY (e.g., "30-Jul-2026")
            if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(date_str)) {
                const months: { [key: string]: number } = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const [day, mon, year] = date_str.split('-');
                const month = months[mon];
                if (month === undefined) throw new AppError(`Invalid month: ${mon}`, 400, "INVALID_DATE_FORMAT");
                return new Date(parseInt(year), month, parseInt(day));
            }
            // Format 2: DD/MM/YYYY (e.g., "30/07/2026")
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(date_str)) {
                const [day, month, year] = date_str.split('/');
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
            // Format 3: YYYY-MM-DD (e.g., "2026-07-30")
            if (/^\d{4}-\d{2}-\d{2}$/.test(date_str)) {
                const [year, month, day] = date_str.split('-');
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
            throw new AppError(`Invalid date format: ${date_str}`, 400, "INVALID_DATE_FORMAT");
        };

        const start = parse_date(start_date);
        const end = parse_date(end_date);

        if (end < start) {
            throw new AppError("End date cannot be before start date", 400, "DATE_RANGE_INVALID");
        }

        // Calculate days difference
        const days_diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        const result: { [key: number]: number } = {};

        sip_items.forEach((item: any, index: number) => {
            const freq = item.sip_freq;
            const freq_type = this.map_frequency_code_to_type(freq);
            let installments = 1;

            switch (freq) {
                case "DZ": // DAILY (Daily Zoned)
                case "D": // DAILY
                    installments = days_diff;
                    break;
                case "WD": // WEEKLY
                    installments = Math.ceil(days_diff / 7);
                    break;
                case "OW": // FORTNIGHTLY
                    installments = Math.ceil(days_diff / 14);
                    break;
                case "OM": // MONTHLY
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = total_months;
                    }
                    break;
                case "Q": // QUARTERLY
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = Math.floor(total_months / 3) + (total_months % 3 > 0 ? 1 : 0);
                    }
                    break;
                case "H": // SEMI-ANNUAL
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = Math.floor(total_months / 6) + (total_months % 6 > 0 ? 1 : 0);
                    }
                    break;
                case "Y": // ANNUAL
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = Math.floor(total_months / 12) + (total_months % 12 > 0 ? 1 : 0);
                    }
                    break;
                default:
                    throw new AppError(`Invalid SIP frequency: ${freq}`, 400, "INVALID_FREQUENCY");
            }

            result[index] = Math.max(1, installments);
        });

        return result;
    }

    execute_xsip_purchase = async (user_id: string, user_log: string, user_pwd: string, mandate_id: string) => {
        // 1. Fetch user and cart
        const [user, cart_res] = await Promise.all([
            user_service.get_all_user_data(user_id, { user_bank_details: true }),
            user_service.get_user_cart_finnsys(user_log, user_pwd)
        ]);

        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up", 400, "TRADING_ACCOUNT_MISSING");

        if (cart_res.code != 1) {
            throw new AppError("Failed to fetch cart from Finnsys", 502, "CART_FETCH_FAILED");
        }

        // 2. Filter SIP items
        const sip_items = cart_res.results.filter((item: any) => item.sub_txn_type === "S");

        if (sip_items.length === 0) {
            throw new AppError("No SIP items found in cart", 400, "CART_EMPTY");
        }

        // 3. Extract date range and calculate installments
        const { start_date, end_date } = this.extract_date_range_from_sip_items(sip_items);
        const installment_counts = this.calculate_installments_count(sip_items, start_date, end_date);

        // 4. Get primary bank details
        const primary_bank = this.get_primary_bank_details(user);

        // 5. Build xSIP reg_data for each item
        const reg_data = await Promise.all(
            sip_items.map(async (item: any, index: number) => ({
                amc_code: item.amc_code || "",
                sch_code: item.prod_code || "",
                client_code: user.nse_client_code,
                bank_ref_no: primary_bank.account_no || "",
                trans_mode: "P",
                dp_txn_mode: "P",
                start_date,
                frequency_type: this.map_frequency_code_to_type(item.sip_freq),
                frequency_allowed: "1",
                installment_amount: (item.sip_amt || item.txn_amount).toString(),
                status: "1",
                member_code: env.NSE_MEMBER_ID,
                folio_no: item.folio || "",
                sip_remarks: "VELVET INVEST APP",
                installment_no: installment_counts[index] || 1,
                xsip_mandate_id: mandate_id,
                sub_broker_code: "",
                euin_number: env.EUIN || "",
                euin_declaration: "Y",
                dpc_flag: "Y",
                first_order_today: "N",
                sub_broker_arn: "",
                end_date: "",
                primary_holder_mobile: user.phone_no || "",
                primary_holder_email: user.email || "",
                step_up_required: "N",
                step_up_start_date: "",
                step_up_end_date: "",
                step_up_frequency: "",
                step_up_amout: "",
                filler_1: "",
                filler_2: "",
                filler_3: "",
                filler_4: "",
                filler_5: ""
            }))
        );

        // 6. Create xSIP payload
        const xsip_payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                reg_data
            }
        };

        logger.info(`Creating xSIP orders for User ${user_id}. Mandate ID: ${mandate_id}, Items: ${sip_items.length}`);

        // 7. Submit to Finnsys
        const xsip_response = await mutual_fund_finnsys_service.create_xsip_purchase(xsip_payload);

        // 8. Extract order ID
        const order_id = xsip_response.data?.reg_data?.[0]?.reg_id || xsip_response.data?.orderId;

        if (!order_id) {
            logger.error("xSIP response missing order ID: ", xsip_response);
            throw new AppError("xSIP created but order ID not found in response", 500, "XSIP_ORDER_ID_MISSING");
        }

        logger.info(`xSIP orders created successfully. Order ID: ${order_id}`);

        // 9. Generate short URL
        const xsip_url_res = await nse_service.get_short_url('XSIP_REG', order_id, user_log, user_pwd);
        logger.debug("xSIP short URL response ==> ", xsip_url_res);

        return {
            xsip_short_url: xsip_url_res.data?.firstHolderLink || "",
            order_id
        };
    }

    private construct_transaction_payload(cart_items: any[], user: any) {
        const primary_bank = this.get_primary_bank_details(user);

        return cart_items.map(async (item: any) => {
            return {
                order_ref_number: await generate_unique_code("ORD"),
                scheme_code: item.prod_code, // Mapped from prod_code
                trxn_type: "P",
                buy_sell_type: "FRESH", // Could be FRESH or ADDITIONAL, defaulting to FRESH for now
                client_code: user.nse_client_code,
                demat_physical: "P",
                order_amount: item.txn_amount || item.sip_amt, // txn_amount for Lumpsum, sip_amt for SIP
                folio_no: item.folio || "",
                remarks: "Velvet Invest App",
                kyc_flag: "Y",
                sub_broker_code: "",
                euin_number: env.EUIN, // TODO: Add EUIN if available
                euin_declaration: "Y",
                min_redemption_flag: "N",
                dpc_flag: "Y",
                all_units: "N",
                redemption_units: "",
                sub_broker_arn: "",
                bank_ref_no: "", // Optional?
                account_no: primary_bank.account_no,
                mobile_no: user.phone_no,
                email: user.email,
                mandate_id: "", // Required for SIP?

                // SIP Specifics (If present in item)
                ...(item.sip_freq ? {
                    sip_st_date: item.sip_st_date,
                    sip_en_date: item.sip_en_date,
                    sip_freq: item.sip_freq,
                    sip_day: item.sip_day,
                    sip_amt: item.sip_amt
                } : {})
            };
        });
    }

    execute_lumpsum_purchase = async (user_id: string, user_log: string, user_pwd: string) => {
        // 1. Fetch User with Bank Details
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up (Client Code missing)", 400, "TRADING_ACCOUNT_MISSING");

        // 2. Fetch Cart
        const cart_res = await user_service.get_user_cart_finnsys(user_log, user_pwd);
        if (cart_res.code != 1) {
            throw new AppError("Failed to fetch cart from Finnsys", 502, "CART_FETCH_FAILED");
        }

        // 3. Filter Lumpsum Items (sub_txn_type = "N")
        const lumpsum_items = cart_res.results.filter((item: any) => item.sub_txn_type === "N");

        if (lumpsum_items.length === 0) {
            throw new AppError("No lumpsum items found in cart", 400, "CART_EMPTY");
        }

        // 4. Construct Payload
        const transaction_details = await Promise.all(this.construct_transaction_payload(lumpsum_items, user));

        // 5. Call Upstream API
        const payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                transaction_details
            }
        };

        logger.info(`Executing Lumpsum Purchase for User ${user_id}. Payload ==> `, payload);

        // 6. Submit to Finnsys API
        const finnsys_response = await mutual_fund_finnsys_service.purchase_finnsys(payload);
        const short_url = await nse_service.get_short_url("PUR", finnsys_response.data.transaction_details[0].trxn_order_id, user_log, user_pwd)


        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for lumpsum purchase. Response from NSE ==> ", short_url);
            throw new AppError("Lumpsum purchase initiated but failed to generate short URL, Check your registered mail for order confirmation", 500, "SHORT_URL_ERROR");
        }

        return short_url.data.firstHolderLink;
    }

    initiate_sip_purchase = async (user_id: string, user_log: string, user_pwd: string) => {
        // 1. Fetch User with Bank Details and User Cart
        const [user, cart_res] = await Promise.all([
            user_service.get_all_user_data(user_id, { user_bank_details: true }),
            user_service.get_user_cart_finnsys(user_log, user_pwd)
        ]);
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up (Client Code missing)", 400, "TRADING_ACCOUNT_MISSING");

        // const cart_res = await user_service.get_user_cart_finnsys(user_log, user_pwd);
        if (cart_res.code != 1) {
            throw new AppError("Failed to fetch cart from Finnsys", 502, "CART_FETCH_FAILED");
        }

        // 2. Filter SIP Items (sub_txn_type = "S")
        const sip_items = cart_res.results.filter((item: any) => item.sub_txn_type === "S");

        if (sip_items.length === 0) {
            throw new AppError("No SIP items found in cart", 400, "CART_EMPTY");
        }
        // 3. Extract date range and validate consistency
        const { start_date, end_date } = this.extract_date_range_from_sip_items(sip_items);

        // 4. Calculate total amount (sum of all SIP amounts)
        const total_amount = this.calculate_total_sip_amount(sip_items);

        // 5. Get primary bank details
        const primary_bank = this.get_primary_bank_details(user);

        // 6. Create mandate registration payload
        const mandate_payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                reg_data: [
                    {
                        client_code: user.nse_client_code,
                        amount: total_amount,
                        mandate_type: "E" as const,
                        account_no: primary_bank.account_no,
                        ac_type: primary_bank.ac_type || "SB",
                        ifsc_code: primary_bank.ifsc_code,
                        micr_code: primary_bank.micr_code || "",
                        start_date,
                        end_date,
                        member_mandate_no: ""
                    }
                ]
            }
        };

        logger.info(`Creating SIP Mandate for User ${user_id}. Amount: ${total_amount}, Dates: ${start_date} to ${end_date}`);

        // 7. Submit mandate registration to Finnsys
        const mandate_response = await mutual_fund_finnsys_service.create_mandate_registration(mandate_payload);

        // 8. Extract mandate_id from response
        const mandate_id = mandate_response.data.reg_data[0]?.reg_id;

        if (!mandate_id) {
            logger.error("Mandate response missing mandate_id: ", mandate_response);
            throw new AppError("Mandate created but mandate_id not found in response", 500, "MANDATE_ID_MISSING");
        }

        logger.info(`SIP Mandate created successfully. Mandate ID: ${mandate_id}`);

        // 9. Return mandate details to caller (Controller) for short URL generation and user redirection
        return {
            mandate_id,
        };
    }


    // ─── Redemption ──────────────────────────────────────────────────────────────

    private async construct_redeem_payload(prod_code: string, folio_no: string, user: any, redem_data: Redeem_request_data) {
        const primary_bank = this.get_primary_bank_details(user);
        const is_full = redem_data.redem_type === "FULL";

        return {
            order_ref_number: await generate_unique_code("RDM"),
            scheme_code: prod_code,
            trxn_type: "R",
            buy_sell_type: "FRESH",  // TODO: verify exact value with Finnsys docs for redemptions
            client_code: user.nse_client_code,
            demat_physical: "P",
            order_amount: is_full ? "" : (redem_data.redemption_amount ? String(redem_data.redemption_amount) : ""),
            folio_no: folio_no,
            remarks: "Velvet Invest App : Redeem reward",
            kyc_flag: "Y",
            sub_broker_code: "",
            euin_number: env.EUIN,
            euin_declaration: "Y",
            min_redemption_flag: "N",
            dpc_flag: "Y",
            all_units: is_full ? "Y" : "N",
            redemption_units: is_full ? "" : (redem_data.redemption_units ? String(redem_data.redemption_units) : ""),
            sub_broker_arn: "",
            bank_ref_no: "",
            account_no: primary_bank.account_no,
            mobile_no: user.phone_no,
            email: user.email,
            mandate_id: "",
        };
    }

    execute_redemption = async (user_id: string, redem_data: Redeem_request_data, user_log: string, user_pwd: string) => {
        // 1. Fetch user with primary bank details
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");

        // 2. Resolve Finnsys prod_code depending on the data source
        let prod_code: string;

        if (redem_data.source === "transaction") {
            // Frontend sent schemeid from holdings — look up platform_code in our DB
            const mf_product = await this.get_mutual_fund_by_scheme_id(String(redem_data.scheme_id));
            if (!mf_product) throw new AppError("Scheme not found for given scheme_id", 404, "SCHEME_NOT_FOUND");

            const mf_detail = await this.get_only_mf_product(mf_product.id);
            if (!mf_detail?.platform_code) throw new AppError("Scheme platform code not configured", 500, "PLATFORM_CODE_MISSING");

            prod_code = mf_detail.nse_scheme_code as string;
        } else {
            // Frontend sent prod_code from cart — use it directly, no DB lookup needed
            prod_code = redem_data.prod_code;
        }

        // 3. Build transaction payload
        const transaction_detail = await this.construct_redeem_payload(
            prod_code,
            redem_data.folio_no,
            user,
            redem_data
        );

        const payload = {
            arn: env.ARN,
            username: user.usr,
            password: user_pwd,
            data: { transaction_details: [transaction_detail] }
        };
        logger.info(`Executing Redemption for User ${user_id}. Source: ${redem_data.source}. Payload: ${JSON.stringify(payload)}`);

        // 4. Submit to Finnsys (same endpoint as purchase, different trxn_type)
        const finnsys_response = await mutual_fund_finnsys_service.redeem_finnsys(payload);

        // 5. Get short URL for OTP / confirmation
        const short_url = await nse_service.get_short_url(
            "RED",
            finnsys_response.data.transaction_details[0].trxn_order_id,
            user_log, user_pwd
        );

        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for redemption ===> ", short_url);
            throw new AppError(
                "Redemption initiated but failed to generate short URL, check your registered mail for confirmation",
                500,
                "SHORT_URL_ERROR"
            );
        }

        return short_url.data.firstHolderLink;
    }

    // ─── Add Bundle to Cart ──────────────────────────────────────────────────

    /**
     * Clears the user's current Finnsys cart and re-populates it with every
     * product from the given bundle, using either LUMPSUM or SIP cart logic.
     *
     * Per-product amount = Math.round((allocation_percentage / 100) * amount).
     * Throws AppError if any bundle_product is missing allocation_percentage.
     * For SIP: validates sip_day and sip_freq against each fund's transaction_rules.
     */
    add_bundle_to_cart = async (input: AddBundleToCartInput, user_creds: { log: string; pwd: string }) => {
        const { bundle_id, type, amount } = input;

        console.log("Input in bundle add cart ==> ", input)

        // 1. Fetch bundle with all products + mf_product details needed for cart calls
        const bundle = await bundle_service.get_bundle_by_id(bundle_id);
        if (!bundle) {
            throw new AppError("Bundle not found", 404, "BUNDLE_NOT_FOUND");
        }
        if (!bundle.bundle_products || bundle.bundle_products.length === 0) {
            throw new AppError("Bundle has no products", 400, "BUNDLE_EMPTY");
        }

        // 2. Fetch current Finnsys cart and clear all items
        logger.info(`[BundleCart] Fetching current cart for user log: ${user_creds.log}`);
        const cart_res = await user_service.get_user_cart_finnsys(user_creds.log, user_creds.pwd);

        logger.info(`[BundleCart] Current cart response ==> `, cart_res);

        if (cart_res.code == 1 && Array.isArray(cart_res.results) && cart_res.results.length > 0) {
            const cart_item_ids: number[] = cart_res.results.map((item: any) => Number(item.id));
            logger.info(`[BundleCart] Clearing ${cart_item_ids.length} existing cart item(s)`);
            await Promise.all(
                cart_item_ids.map(id =>
                    this.remove_item_from_cart(user_creds.log, user_creds.pwd, id)
                )
            );
        } else {
            logger.info("[BundleCart] Cart is empty, skipping clear step");
        }

        // 3. For SIP: pre-fetch each product's transaction_rules for validation
        const failed: { mf_product_id: string; reason: string }[] = [];
        let added = 0;

        for (const bp of bundle.bundle_products) {
            const mf_product = bp.mf_product as any;
            if (!mf_product) {
                logger.warn(`[BundleCart] mf_product missing for bundle_product ${bp.mf_product_id}, skipping`);
                failed.push({ mf_product_id: bp.mf_product_id, reason: "mf_product not found" });
                continue;
            }

            // Compute per-product amount from allocation_percentage
            const per_product_amount = Math.round((bp.allocation_percentage / 100) * amount);

            try {
                if (type === "LUMPSUM") {
                    await this.add_lumpsum_cart(
                        {
                            amc_code: mf_product.amc_code || "",
                            amc_name: mf_product.amc_name || "",
                            prod_code: mf_product.platform_code || "",
                            prod_name: mf_product.scheme_name || "",
                            txn_amount: per_product_amount,
                        },
                        user_creds
                    );
                    added++;
                } else {
                    // SIP — validate sip_day and sip_freq against this product's transaction_rules
                    // We need the full product with transaction_rules; re-fetch by ID to get them.
                    const mf_detail = await this.get_mutual_fund_by_id(bp.mf_product_id);

                    if (!mf_detail?.transaction_rules?.sip_allowed_dates.includes(input.sip_day)) {
                        throw new AppError(
                            `SIP day ${input.sip_day} is not allowed for fund "${mf_product.scheme_name}"`,
                            400,
                            "SIP_DAY_NOT_ALLOWED"
                        );
                    }

                    if (!mf_detail?.transaction_rules?.sip_frequencies.includes(input.sip_freq)) {
                        throw new AppError(
                            `SIP frequency "${input.sip_freq}" is not allowed for fund "${mf_product.scheme_name}"`,
                            400,
                            "SIP_FREQ_NOT_ALLOWED"
                        );
                    }

                    await this.add_sip_cart(
                        {
                            amc_code: mf_product.amc_code || "",
                            amc_name: mf_product.amc_name || "",
                            prod_code: mf_product.platform_code || "",
                            prod_name: mf_product.scheme_name || "",
                            txn_amount: per_product_amount,
                            sip_st_date: input.sip_st_date,
                            sip_en_date: input.sip_en_date,
                            sip_freq: input.sip_freq,
                            sip_day: input.sip_day,
                            sip_amt: per_product_amount,
                        },
                        user_creds
                    );
                    added++;
                }
            } catch (err: any) {
                // Re-throw AppErrors (strict validation failures for the entire bundle)
                if (err instanceof AppError) throw err;
                // For unexpected per-product failures, log and continue
                logger.error(`[BundleCart] Failed to add product ${bp.mf_product_id} to cart:`, err);
                failed.push({ mf_product_id: bp.mf_product_id, reason: err?.message ?? "Unknown error" });
            }
        }

        return {
            bundle_id,
            type,
            total_products: bundle.bundle_products.length,
            added,
            failed,
        };
    }

    remove_item_from_cart = async (user_log: string, user_pwd: string, cart_item_id: number | number[]) => {
        try {
            const response = await axios.get(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, {
                params: {
                    log: user_log,
                    pwd: user_pwd,
                    svc: 'deletecart',
                    del: cart_item_id,
                }
            });

            logger.debug("Remove from cart response ==> ", response.data);
            return response.data;

        } catch (error) {
            logger.error("Error removing item from cart ==> ", error);
            throw new AppError("Failed to remove item from cart", 500, "REMOVE_FROM_CART_ERROR");
        }
    }


    // ==================== Mandate ==========================

    check_mandate_status = async (mandate_id: string, user_log: string, user_pwd: string, user_id: string) => {
        const user = await user_service.get_user_by_id(user_id);

        const mandate_status_payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                mandate_id: mandate_id,
                client_code: user.nse_client_code
            }
        };

        logger.info(`Checking mandate status for User ${user_id}, Mandate ID: ${mandate_id}`);

        const mandate_status_res = await mutual_fund_finnsys_service.check_mandate_status(mandate_status_payload);

        logger.info(`Mandate status response for User ${user_id}, Mandate ID: ${mandate_id} ==> `, mandate_status_res);

        return mandate_status_res;
    }

}

export const mutual_funds_service = new MutualFundServiceClass();