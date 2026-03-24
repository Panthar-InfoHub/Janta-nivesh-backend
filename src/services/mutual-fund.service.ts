import axios from "axios";
import logger from "../middleware/logger.js";
import { db } from "../server.js";

import type { MfNavHistoryCreateManyInput, MfProductOrderByWithRelationInput, MfProductWhereInput } from "../prisma/generated/prisma/models.js";
import { Lumpsum_cart_data, Sip_cart_data } from "../lib/types.js";
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
const gzipAsync = promisify(gzip);

export type pagination = {
    page: number;
    limit: number;
}



class MututalFundServiceClass {

    finnsys_base_url: string;

    constructor() {
        this.finnsys_base_url = env.finsys_base_api;
    }



    get_mutual_funds = async ({ pagination, query, order }: { pagination: pagination, query?: MfProductWhereInput, order?: MfProductOrderByWithRelationInput }) => {
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;

        const where = query ? query : {};

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
            select: { id: true, scheme_id: true, scheme_name: true, mapping_code: true }
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
            data: {
                transaction_details
            }
        };

        logger.info(`Executing Lumpsum Purchase for User ${user_id}. Payload: ${JSON.stringify(payload)}`);

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
            data: {
                transaction_details
            }
        };

        logger.info(`Executing SIP Purchase for User ${user_id}. Payload: ${JSON.stringify(payload)}`);

        const finnsys_response = await mutual_fund_finnsys_service.purchase_lumpsum_finnsys(payload);
        const short_url = await nse_service.get_short_url("PUR", finnsys_response.data.transaction_details[0].trxn_order_id)


        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for lumpsum purchase. Response from NSE ==> ", short_url);
            throw new AppError("Lumpsum purchase initiated but failed to generate short URL, Check your registered mail for order confirmation", 500, "SHORT_URL_ERROR");
        }

        return short_url.data.firstHolderLink;
    }

}

export const mututal_funds_service = new MututalFundServiceClass();