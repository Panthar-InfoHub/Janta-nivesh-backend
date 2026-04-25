import axios from "axios";
import logger from "../middleware/logger.js";
import { db } from "../server.js";

import type { MfNavHistoryCreateManyInput, MfProductOrderByWithRelationInput, MfProductWhereInput } from "../prisma/generated/prisma/models.js";
import { Lumpsum_cart_data, Sip_cart_data, Redeem_request_data } from "../lib/types.js";
import { env } from "../lib/config-env.js";
import AppError from "../middleware/error.middleware.js";
import { redis_buffer_client } from "../lib/redis.js";
import { decompressAndFilter } from "../lib/utils.js";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { user_service } from "./user.service.js";
import { generate_unique_code } from "../helpers/unique.code.js";
import { mutual_fund_finnsys_service } from "./finnsys/mf.finnsys.service.js";
import { nse_service } from "./nse.service.js";
import { Prisma } from "../prisma/generated/prisma/client.js";
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

        const where = query ? query : {};

        // If search is provided, we use fuzzy similarity scoring via pg_trgm
        if (search && search.trim().length > 0) {
            try {
                // 1. Extract Filter Values
                const riskValue = typeof query?.risk_level === 'object' ? query?.risk_level?.equals : query?.risk_level;
                const categoryValue = typeof query?.asset_type === 'object' ? query?.asset_type?.equals : query?.asset_type;

                const riskFilter = (riskValue !== undefined && riskValue !== null) ? Prisma.sql`AND risk_level = ${riskValue}` : Prisma.empty;
                const categoryFilter = categoryValue ? Prisma.sql`AND asset_type = ${categoryValue}` : Prisma.empty;

                // 2. Define a consistent threshold (0.3 is usually best for "LIC Multicap" vs "LIC Multi Cap")
                const threshold = 0.15;
                let sql_order_by = Prisma.sql`score DESC`; // Default

                if (order?.metrics?.return_90d) sql_order_by = Prisma.sql`m.return_90d DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_6m) sql_order_by = Prisma.sql`m.return_6m DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_1y) sql_order_by = Prisma.sql`m.return_1y DESC NULLS LAST, score DESC`;
                else if (order?.metrics?.return_3y) sql_order_by = Prisma.sql`m.return_3y DESC NULLS LAST, score DESC`;

                // 3. Execute Search
                const searchResults = await db.$queryRaw<{ id: string, score: number }[]>`
                SELECT 
                    p.id,
                    (similarity(p.scheme_name, ${search}) * 2.0 + coalesce(similarity(p.amc_name, ${search}), 0)) as score
                FROM "MfProduct" p
                LEFT JOIN "MfMetrics" m ON m.mf_product_id = p.id
                WHERE 
                    (scheme_name % ${search} OR scheme_type % ${search} OR amc_name % ${search})
                    AND similarity(scheme_name, ${search}) > ${threshold}
                    ${categoryFilter}
                    ${riskFilter}
                ORDER BY ${sql_order_by}
                LIMIT ${limit} OFFSET ${offset}
            `;

                // 4. SYNCED COUNT QUERY
                const totalResult = await db.$queryRaw<{ count: bigint }[]>`
                SELECT count(*) as count FROM "MfProduct"
                WHERE 
                    (scheme_name % ${search} OR scheme_type % ${search} OR amc_name % ${search})
                    AND similarity(scheme_name, ${search}) > ${threshold}
                    ${categoryFilter}
                    ${riskFilter}
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
                    // If fuzzy found NOTHING, return empty instead of falling through to "everything"
                    return {
                        mutual_funds: [],
                        pagination: { total: 0, page, limit, totalPages: 0 }
                    };
                }
            } catch (error) {
                logger.error("Error in fuzzy search, falling back to basic contains matching:", error);
                // On error, we add the search back to the Prisma 'where' object for a standard match
                (where as any).OR = [
                    { scheme_name: { contains: search, mode: 'insensitive' } },
                    { amc_name: { contains: search, mode: 'insensitive' } }
                ];
            }
        }

        logger.debug("Searching fallback, using standard search....")

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
                            return_6m: true
                        }
                    }
                },
                skip: offset,
                take: limit,
                orderBy: order ? order : { scheme_name: 'asc' }
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
                        nav_change_pct: true
                    }
                },
                transaction_rules: {
                    select: {
                        sip_allowed_dates: true,
                        sip_frequencies: true
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

            logger.debug("Add to sip cart response ==> ", response.data);
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
            username: user.usr,
            password: user.pwd,
            data: {
                transaction_details
            }
        };

        logger.info(`Executing Lumpsum Purchase for User ${user_id}. Payload ==> `, payload);

        // 6. Submit to Finnsys API
        const finnsys_response = await mutual_fund_finnsys_service.purchase_lumpsum_finnsys(payload);
        const short_url = await nse_service.get_short_url("PUR", finnsys_response.data.transaction_details[0].trxn_order_id)


        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for lumpsum purchase. Response from NSE ==> ", short_url);
            throw new AppError("Lumpsum purchase initiated but failed to generate short URL, Check your registered mail for order confirmation", 500, "SHORT_URL_ERROR");
        }

        return short_url.data.firstHolderLink;
    }

    execute_sip_purchase = async (user_id: string, user_log: string, user_pwd: string) => {
        // 1. Fetch User with Bank Details
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });
        if (!user) throw new AppError("User not found", 404);
        if (!user.nse_client_code) throw new AppError("Trading account not set up (Client Code missing)", 400, "TRADING_ACCOUNT_MISSING");

        // 2. Fetch Cart
        const cart_res = await user_service.get_user_cart_finnsys(user_log, user_pwd);
        if (cart_res.code != 1) {
            throw new AppError("Failed to fetch cart from Finnsys", 502, "CART_FETCH_FAILED");
        }

        // 3. Filter SIP Items (sub_txn_type = "S")
        const sip_items = cart_res.results.filter((item: any) => item.sub_txn_type === "S");

        if (sip_items.length === 0) {
            throw new AppError("No SIP items found in cart", 400, "CART_EMPTY");
        }

        // 4. Construct Payload
        const transaction_details = await Promise.all(this.construct_transaction_payload(sip_items, user));

        // 5. Call Upstream API
        const payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                transaction_details
            }
        };

        logger.info(`Executing SIP Purchase for User ${user_id}. Payload ==> `, payload);

        const finnsys_response = await mutual_fund_finnsys_service.purchase_lumpsum_finnsys(payload);
        const short_url = await nse_service.get_short_url("PUR", finnsys_response.data.transaction_details[0].trxn_order_id)


        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for lumpsum purchase. Response from NSE ==> ", short_url);
            throw new AppError("Lumpsum purchase initiated but failed to generate short URL, Check your registered mail for order confirmation", 500, "SHORT_URL_ERROR");
        }

        return short_url.data.firstHolderLink;
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

    execute_redemption = async (user_id: string, redem_data: Redeem_request_data) => {
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
            password: user.pwd,
            data: { transaction_details: [transaction_detail] }
        };
        logger.info(`Executing Redemption for User ${user_id}. Source: ${redem_data.source}. Payload: ${JSON.stringify(payload)}`);

        // 4. Submit to Finnsys (same endpoint as purchase, different trxn_type)
        const finnsys_response = await mutual_fund_finnsys_service.redeem_finnsys(payload);

        // 5. Get short URL for OTP / confirmation
        const short_url = await nse_service.get_short_url(
            "RED",
            finnsys_response.data.transaction_details[0].trxn_order_id
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

    remove_item_from_cart = async (user_log: string, user_pwd: string, cart_item_id: number) => {
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

}

export const mutual_funds_service = new MutualFundServiceClass();