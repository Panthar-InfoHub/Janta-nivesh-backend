import axios from "axios";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { env } from "../../lib/config-env.js";
import { Lumpsum_cart_data, Sip_cart_data } from "../../lib/types.js";
import { AddBundleToCartInput } from "../../lib/zod-schemas/bundle.schema.js";
import { user_service } from "../user.service.js";
import { bundle_service } from "../bundle.services.js";
import { MfQueryService } from "./MfQueryService.js";

export class MfCartService {
    private finnsys_base_url: string;

    constructor(private queryService: MfQueryService) {
        this.finnsys_base_url = env.finsys_base_api;
    }

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

            return response.data;

        } catch (error) {
            logger.error("Error adding to sip cart service ==> ", error);
            throw new AppError("Failed to add to sip cart", 500, "ADD_TO_CART_ERROR");
        }
    }

    add_bundle_to_cart = async (input: AddBundleToCartInput, user_creds: { log: string; pwd: string }) => {
        const { bundle_id, type, amount } = input;

        // 1. Fetch bundle with all products
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
                    const mf_detail = await this.queryService.get_mutual_fund_by_id(bp.mf_product_id);

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
                if (err instanceof AppError) throw err;
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
}
