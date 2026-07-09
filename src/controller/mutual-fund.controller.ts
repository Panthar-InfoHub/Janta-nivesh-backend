import { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { sip_cart_zod_schema, redeem_request_zod_schema, invest_more_zod_schema, purchase_sip_body_schema, Sip_purchase_item } from "../lib/types.js";
import { db } from "../server.js";
import { add_bundle_to_cart_schema } from "../lib/zod-schemas/bundle.schema.js";
import { get_mf_search_query } from "../lib/utils.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { mutual_funds_service } from "../services/mutual-fund.service.js";
import { nse_service } from "../services/nse.service.js";
import { zoho_webhook_service } from "../services/zoho.webhook.service.js";
import { user_service } from "../services/user.service.js";
import { MfOrderService } from "../services/mutual-funds/MfOrderService.js";
import { MfCartService } from "../services/mutual-funds/MfCartService.js";



// Proxy client that returns Buffers instead of strings (node-redis v5 API)


class MutualFundControllerClass {

    get_mutual_funds = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            // Direct category fetch
            const fund_category = req.query.fund_category as string;
            const direct_categories = ['flexi_cap', 'large_Mid_cap', 'large_cap', 'mid_cap', 'small_cap', 'index', 'global_others'];

            if (fund_category && direct_categories.includes(fund_category)) {
                logger.info(`Fetching mutual funds by fund_category: ${fund_category} - Page: ${page}, Limit: ${limit}`);

                const result = await mutual_funds_service.query.get_funds_by_category({
                    category: fund_category as any,
                    page,
                    limit
                });

                logger.debug(`Fetched ${result.mutual_funds.length} mutual funds from database using category route`);

                res.status(200).json({
                    success: true,
                    message: "Mutual funds fetched successfully",
                    data: result
                });
                return;
            }

            //Filters
            logger.debug("Query for sort by ==> ", req.query)
            const sort_by = req.query.sort_by as string
            const search = req.query.search as string
            const category = req.query.category as string
            const risk = parseInt(req.query.risk as string)

            logger.info(`Fetching mutual funds - Page: ${page}, Limit: ${limit}`);
            const { query, order, search: normalized_search } = get_mf_search_query({ category, risk, sort_by, search });

            logger.debug("Query for mutual fund ==> ", query)

            const result = await mutual_funds_service.query.get_mutual_funds({
                pagination: { page, limit },
                query,
                order,
                search: normalized_search
            });

            logger.debug(`Fetched ${result.mutual_funds.length} mutual funds from database`);

            res.status(200).json({
                success: true,
                message: "Mutual funds fetched successfully",
                data: result
            });
            return;

        } catch (error) {
            logger.error("Error in get_mutual_funds:", error);
            next(error);
            return;
        }

    }


    get_mutual_fund_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            logger.info(`Fetching mutual fund by id: ${id}`);

            const mf_detail_key = `mf:id:${id}`;
            const cached_details = await redis.get(mf_detail_key)

            if (cached_details) {
                logger.debug(`Cache Hit for MF ID: ${id}`);

                res.status(200).json({
                    success: true,
                    message: "Mutual fund fetched successfully (from cache)",
                    data: JSON.parse(cached_details as string)
                });
                return;
            }

            logger.debug(`Cache Miss for MF ID: ${id}. Fetching from database...`);
            const result = await mutual_funds_service.query.get_mutual_fund_by_id(id);

            await redis.set(mf_detail_key, JSON.stringify(result), { EX: 60 * 60 })
            logger.debug(`Fetched and cached mutual fund by id: ${id}`);

            res.status(200).json({
                success: true,
                message: "Mutual fund fetched successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in get_mutual_fund_by_id:", error);
            next(error);
            return;
        }
    }


    get_mutual_fund_history = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            const period = req.query.period as string || "1y";

            const full_history = await mutual_funds_service.query.get_mutual_fund_history(id, period);

            if (!full_history) {
                logger.warn(`No history found for MF ID: ${id}, returning empty array response`);
                return res.status(200).json({ success: true, message: "History not found", data: [] });
            }

            res.status(200).json({
                success: true,
                message: "History fetched successfully",
                data: full_history
            });
            return;
        } catch (error) {
            logger.error("Error in get_mutual_fund_history:", error);
            next(error);
            return;
        }
    }


    add_to_lumpsum_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user;
            logger.info(`Adding to lumpsum cart for user: ${user?.id}`);

            const { amount, mf_product_id, folio } = req.body;
            if (!amount || !mf_product_id) {
                logger.warn("Missing required fields in add_to_lumpsum_cart request body");
                throw new AppError("Missing required fields: amount and mf_product_id are required", 400);
            }

            const mf_product = await mutual_funds_service.query.get_mutual_fund_by_id(mf_product_id);

            const result = await mutual_funds_service.cart.add_lumpsum_cart({
                amc_code: mf_product?.amc_code || "",
                amc_name: mf_product?.amc_name || "",
                prod_code: mf_product?.platform_code || "",
                prod_name: mf_product?.scheme_name || "",
                txn_amount: amount,
                folio: folio || ""
            }, {
                log: user?.log as string,
                pwd: user?.pwd as string
            });

            logger.debug("Result from add_to_lumpsum_cart service ==> ", result);

            if (result.code != "1") {
                logger.error("Failed to add to lumpsum cart, service response code: ", result.code);
                throw new AppError("Failed to add to lumpsum cart", 500, "ADD_TO_CART_LUMPSUM_ERROR");
            }

            res.status(200).json({
                success: true,
                message: "Added to lumpsum cart successfully",
                data: result
            });
            return;


        } catch (error) {
            logger.error("Error in add_to_lumpsum_cart controller ==> ", error);
            next(error);
            return;
        }
    }

    purchase_lumpsum = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Purchasing lumpsum items for user: ${user.id}`);

            const result = await mutual_funds_service.order.execute_lumpsum_purchase(user.id, user.log!, user.pwd!);

            await zoho_webhook_service.send_event({
                event_type: "MF_ORDER_CREATED",
                timestamp: new Date().toISOString(),
                user_id: user.id,
                order_type: "LUMPSUM",
                payment_url: result
            });

            // Invalidate Finnsys portfolio cache
            await redis.del(`mf_portfolio:finnsys:${user.id}`);

            res.status(200).json({
                success: true,
                message: "Lumpsum purchase initiated",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in purchase_lumpsum:", error);
            next(error);
            return;
        }
    }

    initiate_sip = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Purchasing SIP items for user: ${user.id}`);

            // Validate the request body
            const body_validation = purchase_sip_body_schema.safeParse(req.body);
            if (!body_validation.success) {
                logger.warn("Validation failed for initiate_sip request body", { errors: body_validation.error.issues });
                throw new AppError("Validation failed for SIP purchase data", 400, "VALIDATION_ERROR", body_validation.error);
            }
            const { items } = body_validation.data;

            const result = await mutual_funds_service.sip.initiate_sip_purchase(user.id, user.log!, user.pwd!, items);

            if (result.status === "MANDATE_APPROVED") {
                res.status(200).json({
                    success: true,
                    message: "SIP mandate is already approved. You can proceed with SIP purchase.",
                    data: {
                        mandate_id: result.mandate_id,
                        mandate_short_url: "",
                        status: "MANDATE_APPROVED"
                    }
                });
                return;
            }

            const mandate_short_url_res = await nse_service.get_short_url('MANDATE_AUTH', result.mandate_id, user.log!, user.pwd!);

            await zoho_webhook_service.send_event({
                event_type: "MF_ORDER_CREATED",
                timestamp: new Date().toISOString(),
                user_id: user.id,
                order_type: "SIP",
                mandate_id: result.mandate_id,
                mandate_approval_url: mandate_short_url_res.data.firstHolderLink,
                status: "MANDATE_PENDING_APPROVAL"
            });

            res.status(200).json({
                success: true,
                message: "SIP mandate registration initiated. Please approve the mandate to proceed.",
                data: {
                    mandate_id: result.mandate_id,
                    mandate_short_url: mandate_short_url_res.data.firstHolderLink,
                    status: "MANDATE_PENDING_APPROVAL"
                }
            });
            return;
        } catch (error) {
            logger.error("Error in initiate_sip:", error);
            next(error);
            return;
        }
    }


    add_to_sip_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user;
            logger.info(`Adding to sip cart for user: ${user?.id}`);

            const { amount, mf_product_id, sip_st_date, sip_en_date, sip_freq, sip_day, sip_amt, folio } = req.body;
            if (!amount || !mf_product_id || !sip_st_date || !sip_en_date || !sip_day || !sip_amt) {
                logger.warn("Missing required fields in add_to_sip_cart request body");
                throw new AppError("Missing required fields: amount, mf_product_id, sip_st_date, sip_en_date, sip_day, and sip_amt are required", 400);
            }

            const mf_product = await mutual_funds_service.query.get_mutual_fund_by_id(mf_product_id);


            if (!mf_product?.transaction_rules?.sip_allowed_dates.includes(sip_day)) {
                logger.warn("SIP day is not allowed for this mutual fund");
                throw new AppError(`SIP day ${sip_day} is not allowed for this mutual fund`, 400);
            }

            // Gonna ignore the frequence for now always need to be "Monthly"
            // if (!mf_product?.transaction_rules?.sip_frequencies.includes(sip_freq)) {
            //     logger.warn(`SIP frequency ${sip_freq} is not allowed for this mutual fund`);
            //     throw new AppError(`SIP with ${sip_freq} frequency is not allowed for this mutual fund`, 400);
            // }

            const sip_data_validation = sip_cart_zod_schema.safeParse({
                amc_code: mf_product?.amc_code || "",
                amc_name: mf_product?.amc_name || "",
                prod_code: mf_product?.platform_code || "",
                prod_name: mf_product?.scheme_name || "",
                folio: folio || "",
                txn_amount: amount,
                sip_st_date: sip_st_date,
                sip_en_date: sip_en_date,
                sip_freq: sip_freq ?? "OM",
                sip_day: sip_day,
                sip_amt: sip_amt
            });

            if (!sip_data_validation.success) {
                logger.warn("Validation failed for add_to_sip_cart request body", { errors: sip_data_validation.error.issues });
                throw new AppError("Validation failed for SIP cart data", 400, "VALIDATION_ERROR", sip_data_validation.error);
            }

            const result = await mutual_funds_service.cart.add_sip_cart(sip_data_validation.data, {
                log: user?.log as string,
                pwd: user?.pwd as string
            });

            logger.debug("Result from add_to_sip_cart service ==> ", result);

            if (result.code != "1") {
                logger.error("Failed to add to sip cart, service response code: ", result.code);
                throw new AppError("Failed to add to sip cart", 500, "ADD_TO_CART_SIP_ERROR");
            }

            res.status(200).json({
                success: true,
                message: "Added to sip cart successfully",
                data: result
            });
            return;


        } catch (error) {
            logger.error("Error in add_to_sip_cart controller ==> ", error);
            next(error);
            return;
        }
    }


    mandate_status = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            logger.info(`Checking mandate status for user: ${user.id}`);

            const mandate_id = req.query.mandate_id as string;
            logger.info(`Checking mandate status for mandate ID: ${mandate_id}`);

            if (!mandate_id) {
                logger.warn("Missing mandate_id in mandate_status request query");
                throw new AppError("Missing required query parameter: mandate_id", 400);
            }

            const result = await mutual_funds_service.sip.check_mandate_status(mandate_id, user.log!, user.pwd!, user.id);

            res.status(200).json({
                success: true,
                message: "Mandate status retrieved successfully",
                data: {
                    mandate_id,
                    status: result.data.report_data[0]?.status,
                    enach_status: result.data.report_data[0]?.enachStatus,
                    umrn_no: result.data.report_data[0]?.umrnNo,
                }
            });
            return;

        } catch (error) {
            logger.error("Error in mandate_status controller:", error);
            next(error);
            return;
        }
    }

    purchase_sip = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;

            // Validate the request body
            const body_validation = purchase_sip_body_schema.safeParse(req.body);
            if (!body_validation.success) {
                logger.warn("Validation failed for purchase_sip request body", { errors: body_validation.error.issues });
                throw new AppError("Validation failed for SIP purchase data", 400, "VALIDATION_ERROR", body_validation.error);
            }
            const { items } = body_validation.data;

            // Resolve mandate — auto-lookup latest approved if not sent
            const { mandate_id } = req.body;
            let selected_mandate_id = mandate_id;
            if (!selected_mandate_id) {
                const active_mandate = await db.mandate.findFirst({
                    where: {
                        user_id: user.id,
                        status: "SUCCESS"
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                });
                if (!active_mandate) {
                    logger.warn(`No approved mandate found for user: ${user.id}`);
                    throw new AppError("No approved mandate found. Please register and approve a mandate first.", 400, "MANDATE_MISSING");
                }
                selected_mandate_id = active_mandate.mandate_id;
            }

            logger.info(`Executing xSIP purchase for user: ${user.id}. Mandate ID: ${selected_mandate_id}, Items: ${items.length}`);

            // Verify mandate is approved before proceeding
            const mandate_status_res = await mutual_funds_service.sip.check_mandate_status(selected_mandate_id, user.log!, user.pwd!, user.id);
            const status = mandate_status_res.data?.report_data?.[0]?.enachStatus;

            if (status !== "SUCCESS") {
                logger.warn(`Mandate ${selected_mandate_id} is not approved yet. Current status: ${status}`);
                throw new AppError(`Mandate is not approved yet. Current status: ${status || 'UNKNOWN'}. Please approve the mandate before executing SIP purchase.`, 400, "MANDATE_NOT_APPROVED");
            }

            const result = await mutual_funds_service.sip.execute_xsip_purchase(user.id, user.log!, user.pwd!, selected_mandate_id, items as Sip_purchase_item[]);

            await zoho_webhook_service.send_event({
                event_type: "MF_PAYMENT_REDIRECTED_TO_NSE",
                timestamp: new Date().toISOString(),
                user_id: user.id,
                order_id: result.order_id,
                order_type: "SIP",
                mandate_id: selected_mandate_id,
                payment_url: result.xsip_short_url,
                status: "XSIP_INITIATED"
            });

            // Invalidate Finnsys portfolio cache
            await redis.del(`mf_portfolio:finnsys:${user.id}`);

            res.status(200).json({
                success: true,
                message: "xSIP orders created successfully. Please complete payment to execute.",
                data: {
                    xsip_short_url: result.xsip_short_url,
                    order_id: result.order_id,
                    status: "XSIP_INITIATED"
                }
            });
            return;
        } catch (error) {
            logger.error("Error in purchase_sip controller:", error);
            next(error);
            return;
        }
    }


    // ─── Redemption ──────────────────────────────────────────────────────────────

    redeem = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Redemption request for user: ${user.id}`);

            const validation = redeem_request_zod_schema.safeParse(req.body);
            if (!validation.success) {
                logger.warn("Validation failed for redeem request body", { errors: validation.error.issues });
                throw new AppError("Validation failed for redemption data", 400, "VALIDATION_ERROR", validation.error);
            }

            const result = await mutual_funds_service.order.execute_redemption(user.id, validation.data, user.log!, user.pwd!);

            res.status(200).json({
                success: true,
                message: "Redemption initiated successfully",
                data: { payment_link: result }
            });
            return;
        } catch (error) {
            logger.error("Error in redeem controller ===> ", error);
            next(error);
            return;
        }
    }


    remove_item_from_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            logger.info(`Removing item from cart for user: ${user.id}`);

            const cart_item_id = Number(req.query.cart_item_id as string);

            if (!cart_item_id) {
                logger.warn("Missing cart_item_id in remove_item_from_cart request body");
                throw new AppError("Missing required field: cart_item_id", 400);
            }

            const result = await mutual_funds_service.cart.remove_item_from_cart(user.log, user.pwd, cart_item_id);

            if (result.code != 1 && result.code != 0) {
                logger.error("Failed to remove item from cart, service response code: ", result.code);
                throw new AppError("Failed to remove item from cart", 500, "REMOVE_FROM_CART_ERROR");
            }

            res.status(200).json({
                success: true,
                message: "Item removed from cart successfully",
                data: result
            });
            return;

        } catch (error) {
            logger.error("Error in remove_item_from_cart controller ===> ", error);
            next(error);
            return;
        }
    }

    add_bundle_to_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Adding bundle to cart for user: ${user.id}`);

            const validation = add_bundle_to_cart_schema.safeParse(req.body);
            if (!validation.success) {
                logger.warn("Validation failed for add_bundle_to_cart request body", { errors: validation.error.issues });
                throw new AppError("Validation failed", 400, "VALIDATION_ERROR", validation.error);
            }

            const result = await mutual_funds_service.cart.add_bundle_to_cart(
                validation.data,
                { log: user.log as string, pwd: user.pwd as string }
            );

            logger.info(`[BundleCart] Added ${result.added}/${result.total_funds} funds to cart for user: ${user.id}`);

            await zoho_webhook_service.send_event({
                event_type: "BUNDLE_SELECTED",
                timestamp: new Date().toISOString(),
                user_id: user.id,
                bundle_id: validation.data.bundle_id,
                products_added: result.added,
                products_total: result.total_funds
            });

            res.status(200).json({
                success: true,
                message: `Bundle added to cart: ${result.added} of ${result.total_funds} fund(s) added successfully`,
                data: result
            });
            return;

        } catch (error) {
            logger.error("Error in add_bundle_to_cart controller ===> ", error);
            next(error);
            return;
        }
    }

    invest_more = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Processing invest-more request for user: ${user.id}`);

            const validation = invest_more_zod_schema.safeParse(req.body);
            if (!validation.success) {
                logger.warn("Validation failed for invest_more request body", { errors: validation.error.issues });
                throw new AppError("Validation failed for invest more request data", 400, "VALIDATION_ERROR", validation.error);
            }

            const data = validation.data;

            if (data.type === "LUMPSUM") {
                logger.info(`Invest more is in lumpsum mode`);

                const scheme_ids = Array.from(new Set(data.items.map(item => item.scheme_id)));

                const mf_products = await db.mfProduct.findMany({
                    where: { scheme_id: { in: scheme_ids } },
                    include: { transaction_rules: true }
                });

                const productMap = new Map(mf_products.map(p => [p.scheme_id, p]));

                const direct_items = data.items.map(item => {
                    const product = productMap.get(item.scheme_id);
                    if (!product) {
                        logger.error("Mutual fund product not found for scheme id ==> ", item.scheme_id);
                        throw new AppError(`Mutual fund product not found for scheme: ${item.scheme_id}`, 404, "PRODUCT_NOT_FOUND");
                    }

                    const min_lumpsum = product.transaction_rules?.min_investment_amount ? Number(product.transaction_rules.min_investment_amount) : 0;
                    if (min_lumpsum && item.amount < min_lumpsum) {
                        throw new AppError(`Minimum lumpsum investment amount for fund ${product.scheme_name} is ${min_lumpsum}`, 400);
                    }

                    return {
                        prod_code: product.platform_code || "",
                        txn_amount: item.amount,
                        folio: item.folio || ""
                    };
                });

                const payment_url = await mutual_funds_service.order.execute_lumpsum_purchase(user.id, user.log!, user.pwd!, direct_items);

                await zoho_webhook_service.send_event({
                    event_type: "MF_ORDER_CREATED",
                    timestamp: new Date().toISOString(),
                    user_id: user.id,
                    order_type: "LUMPSUM",
                    payment_url
                });

                // Invalidate Finnsys portfolio cache
                await redis.del(`mf_portfolio:finnsys:${user.id}`);

                res.status(200).json({
                    success: true,
                    message: "Lumpsum invest more initiated successfully",
                    data: payment_url
                });
                return;

            } else {
                logger.info(`Invest more is in sip mode`);

                const { amount, scheme_id, folio, sip_st_date, sip_en_date, sip_freq, sip_day, mandate_id } = data;

                const mf_product = await mutual_funds_service.query.get_mutual_fund_by_data({ scheme_id });
                if (!mf_product) {
                    logger.error("Mutual fund product not found for scheme id ==> ", scheme_id)
                    throw new AppError("Mutual fund product not found", 404, "PRODUCT_NOT_FOUND");
                }

                // SIP validation
                const min_sip = mf_product.transaction_rules?.min_investment_amount ? Number(mf_product.transaction_rules.min_investment_amount) : 0;
                if (min_sip && amount < min_sip) {
                    throw new AppError(`Minimum SIP investment amount for this fund is ${min_sip}`, 400);
                }

                if (sip_day && !mf_product.transaction_rules?.sip_allowed_dates.includes(sip_day)) {
                    throw new AppError(`SIP day ${sip_day} is not allowed for this mutual fund`, 400);
                }

                if (sip_freq && !mf_product.transaction_rules?.sip_frequencies.includes(sip_freq)) {
                    throw new AppError(`SIP with frequency ${sip_freq} is not allowed for this mutual fund`, 400);
                }

                // Verify mandate is approved before proceeding
                let selected_mandate_id = mandate_id;
                if (!selected_mandate_id) {
                    const active_mandate = await db.mandate.findFirst({
                        where: {
                            user_id: user.id,
                            status: "SUCCESS"
                        },
                        orderBy: {
                            createdAt: "desc"
                        }
                    });
                    if (!active_mandate) {
                        logger.warn(`No approved mandate found for user: ${user.id}`);
                        throw new AppError("No approved mandate found. Please register and approve a mandate first.", 400, "MANDATE_MISSING");
                    }
                    selected_mandate_id = active_mandate.mandate_id;
                }

                const mandate_status_res = await mutual_funds_service.sip.check_mandate_status(selected_mandate_id, user.log!, user.pwd!, user.id);
                const status = mandate_status_res.data?.report_data?.[0]?.enachStatus;

                if (status !== "SUCCESS") {
                    logger.warn(`Mandate ${selected_mandate_id} is not approved yet. Current status: ${status}`);
                    throw new AppError(`Mandate is not approved yet. Current status: ${status || 'UNKNOWN'}. Please approve the mandate before executing SIP purchase.`, 400, "MANDATE_NOT_APPROVED");
                }

                const directItem: Sip_purchase_item = {
                    amc_code: mf_product.amc_code || "",
                    prod_code: mf_product.platform_code || "",
                    sip_amt: amount,
                    folio: folio || "",
                    sip_st_date,
                    sip_en_date,
                    sip_freq,
                    // Step-up not supported for invest-more
                    step_up_required: "N",
                    step_up_amount: "",
                    step_up_start_date: "",
                    step_up_end_date: ""
                };

                const result = await mutual_funds_service.sip.execute_xsip_purchase(user.id, user.log!, user.pwd!, selected_mandate_id, [directItem]);

                await zoho_webhook_service.send_event({
                    event_type: "MF_PAYMENT_REDIRECTED_TO_NSE",
                    timestamp: new Date().toISOString(),
                    user_id: user.id,
                    order_id: result.order_id,
                    order_type: "SIP",
                    mandate_id: selected_mandate_id,
                    payment_url: result.xsip_short_url,
                    status: "XSIP_INITIATED"
                });

                // Invalidate Finnsys portfolio cache
                await redis.del(`mf_portfolio:finnsys:${user.id}`);

                res.status(200).json({
                    success: true,
                    message: "xSIP invest more order created successfully. Please complete payment to execute.",
                    data: {
                        xsip_short_url: result.xsip_short_url,
                        order_id: result.order_id,
                        status: "XSIP_INITIATED"
                    }
                });
                return;
            }
        } catch (error) {
            logger.error("Error in invest_more controller:", error);
            next(error);
            return;
        }
    };


    // ─── Cancel Orders ──────────────────────────────────────────────────────────────
    clear_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Clearing cart for user: ${user.id}`);

            const user_cart_res = await user_service.get_user_cart_finnsys(user.log!, user.pwd!)

            logger.debug(`User data fetched successfully ==> `, user_cart_res);

            if (user_cart_res.code === 0) {
                logger.debug("Empty cart for User ID ==> ", user.id);
                res.status(200).json({
                    code: 200,
                    message: "User cart cleared successfully",
                });
                return;
            }

            if (user_cart_res.code != 1 && user_cart_res.code != 0) {
                logger.warn(`Failed to fetch user cart from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_cart_res.code}`);
                throw new AppError("Failed to fetch user cart from Finnsys", 502, "FINNSYS_CART_FETCH_FAILED");
            }

            const cancel_promises = user_cart_res.results.map(async (cart_ele: any) => {
                if (cart_ele.id) {
                    return await mutual_funds_service.cart.remove_item_from_cart(user.log!, user.pwd!, cart_ele.id);
                }
            });

            await Promise.all(cancel_promises);
            logger.info(`Cart cleared...`)

            res.status(200).json({
                success: true,
                message: "Order cancelled successfully",
                // data: result
            });
            return;
        } catch (error) {
            logger.error("Error in cancel_order controller:", error);
            next(error);
            return;
        }
    };

    cancel_order = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Cancel order request for user: ${user.id}`);

            const { order_no } = req.body;
            if (!order_no) {
                logger.warn("Missing order_no in cancel_order request body");
                throw new AppError("Missing required field: order_no", 400);
            }

            const result = await mutual_funds_service.order.cancel_order(user.id, user.log!, user.pwd!, order_no);

            // Invalidate Finnsys portfolio cache
            await redis.del(`mf_portfolio:finnsys:${user.id}`);

            res.status(200).json({
                success: true,
                message: "Order cancelled successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in cancel_order controller:", error);
            next(error);
            return;
        }
    };

    cancel_xsip = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Cancel xSIP request for user: ${user.id}`);

            const { xsip_reg_no } = req.body;
            if (!xsip_reg_no) {
                logger.warn("Missing xsip_reg_no in cancel_xsip request body");
                throw new AppError("Missing required field: xsip_reg_no", 400);
            }

            const result = await mutual_funds_service.sip.cancel_xsip(user.id, user.log!, user.pwd!, xsip_reg_no);

            // Invalidate Finnsys portfolio cache
            await redis.del(`mf_portfolio:finnsys:${user.id}`);

            res.status(200).json({
                success: true,
                message: "xSIP cancelled successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in cancel_xsip controller:", error);
            next(error);
            return;
        }
    };

}

export const mutual_fund_controller = new MutualFundControllerClass();