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
                    txn_amount: lumpsum_data.txn_amount,
                    folio: lumpsum_data.folio
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
                    folio: sip_data.folio,
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

    private clear_finnsys_cart = async (user_creds: { log: string; pwd: string }) => {
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
    }

    add_bundle_to_cart = async (input: AddBundleToCartInput, user_creds: { log: string; pwd: string }) => {
        const { bundle_id, type, amount, selections } = input;

        // 1. Confirm the bundle exists
        const bundle = await bundle_service.get_bundle_by_id(bundle_id);
        if (!bundle) {
            throw new AppError("Bundle not found", 404, "BUNDLE_NOT_FOUND");
        }

        // 2. Selection count must match the bundle's total slot count (one fund per slot, flat 100% split)
        const total_slots = bundle.categories.reduce((sum, cat) => sum + cat.slots.length, 0);
        if (selections.length !== total_slots) {
            throw new AppError(
                `Bundle requires exactly ${total_slots} fund selection(s), got ${selections.length}`,
                400,
                "SELECTION_COUNT_MISMATCH"
            );
        }

        // 3. Reject duplicate fund selections
        const unique_ids = new Set(selections.map(s => s.mf_product_id));
        if (unique_ids.size !== selections.length) {
            throw new AppError("Duplicate mutual funds are selected", 400, "DUPLICATE_SELECTION");
        }

        // 4. Resolve each selection to its MfProduct
        const mf_products = await Promise.all(
            selections.map(s => this.queryService.get_mutual_fund_by_id(s.mf_product_id))
        );

        mf_products.forEach((product, idx) => {
            if (!product) {
                throw new AppError(`Mutual fund product not found: ${selections[idx].mf_product_id}`, 404, "PRODUCT_NOT_FOUND");
            }
        });

        // 5. For SIP: validate every fund's transaction rules before touching Finnsys
        if (type === "SIP") {
            for (const product of mf_products) {
                if (!product!.transaction_rules?.sip_allowed_dates.includes(input.sip_day)) {
                    throw new AppError(
                        `SIP day ${input.sip_day} is not allowed for fund "${product!.scheme_name}"`,
                        400,
                        "SIP_DAY_NOT_ALLOWED"
                    );
                }
                if (!product!.transaction_rules?.sip_frequencies.includes(input.sip_freq)) {
                    throw new AppError(
                        `SIP frequency "${input.sip_freq}" is not allowed for fund "${product!.scheme_name}"`,
                        400,
                        "SIP_FREQ_NOT_ALLOWED"
                    );
                }
            }
        }

        // 6. Clear any existing Finnsys cart items
        await this.clear_finnsys_cart(user_creds);

        // 7. Add every selected fund; abort and roll back on first failure
        try {
            for (let i = 0; i < selections.length; i++) {
                const selection = selections[i];
                const product = mf_products[i]!;
                const per_fund_amount = Math.round((selection.allocation_percentage / 100) * amount);

                if (type === "LUMPSUM") {
                    const res = await this.add_lumpsum_cart(
                        {
                            amc_code: product.amc_code || "",
                            amc_name: product.amc_name || "",
                            prod_code: product.platform_code || "",
                            prod_name: product.scheme_name || "",
                            txn_amount: per_fund_amount,
                            folio: "",
                        },
                        user_creds
                    );
                    if (res.code != "1") {
                        throw new AppError(`Failed to add "${product.scheme_name}" to cart`, 500, "ADD_TO_CART_ERROR");
                    }
                } else {
                    const res = await this.add_sip_cart(
                        {
                            amc_code: product.amc_code || "",
                            amc_name: product.amc_name || "",
                            prod_code: product.platform_code || "",
                            prod_name: product.scheme_name || "",
                            folio: "",
                            txn_amount: per_fund_amount,
                            sip_st_date: input.sip_st_date,
                            sip_en_date: input.sip_en_date,
                            sip_freq: input.sip_freq,
                            sip_day: input.sip_day,
                            sip_amt: per_fund_amount,
                        },
                        user_creds
                    );
                    if (res.code != "1") {
                        throw new AppError(`Failed to add "${product.scheme_name}" to cart`, 500, "ADD_TO_CART_ERROR");
                    }
                }
            }
        } catch (err) {
            logger.error("[BundleCart] Failed to add bundle to cart, rolling back ==> ", err);
            await this.clear_finnsys_cart(user_creds);
            throw err instanceof AppError ? err : new AppError("Failed to add bundle to cart", 500, "ADD_TO_CART_ERROR");
        }

        return {
            bundle_id,
            type,
            total_funds: selections.length,
            added: selections.length,
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
