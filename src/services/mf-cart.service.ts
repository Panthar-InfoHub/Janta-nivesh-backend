import { db } from "../server.js";
import AppError from "../middleware/error.middleware.js";
import { mf_threshold_validation_service } from "./mutual-funds/mf-threshold-validation.service.js";
import cuid from "cuid";
import { redis } from "../lib/redis.js";
import { fintech_primitive_mf_purchase_service } from "./fintech-primitive/mf_purchase.service.js";
import { mf_transaction_plan_service } from "./mf-transaction-plan.service.js";
import { plan_confirmation_otp_service } from "./plan-confirmation-otp.service.js";
import { user_bank_details_service } from "./user-bank-details.service.js";
import { fintech_primitive_payment_service } from "./fintech-primitive/payment.service.js";
import { fintech_primitive_mf_purchase_plan_service } from "./fintech-primitive/mf_purchase_plan.service.js";
import { mandate_service } from "./mandate.service.js";
import { bundle_service } from "./bundle.services.js";
import { zoho_webhook_service } from "./zoho.webhook.service.js";
import type {
    AddMfCartItemInput,
    UpdateMfCartItemInput,
    AddBundleToCartInput,
} from "../lib/zod-schemas/mf-cart.schema.js";
import { user_service } from "./user.service.js";
import logger from "../middleware/logger.js";

class MfCartServiceClass {

    get_cart = async (user_id: string) => {
        return await db.mfCartItem.findMany({
            where: {
                user_id,
            },
            include: {
                mf_product: {
                    select: {
                        id: true,
                        name: true,
                        isin: true,
                        img_url: true,
                        scheme_plan: {
                            select: {
                                lumpsum_amount_min: true,
                                lumpsum_amount_max: true,
                                lumpsum_amount_multiples: true,

                                sip_daily_amount_min: true,
                                sip_daily_amount_max: true,
                                sip_daily_amount_multiples: true,

                                sip_monthly_amount_min: true,
                                sip_monthly_amount_max: true,
                                sip_monthly_amount_multiples: true,

                                sip_monthly_dates: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    };

    add_to_cart = async (
        user_id: string,
        input: AddMfCartItemInput,
    ) => {
        // 1. Verify that the fund exists in our catalogue.
        const product = await db.mfProduct.findUnique({
            where: {
                id: input.mf_product_id,
            },
            select: {
                id: true,
                isin: true,
            },
        });

        if (!product) {
            throw new AppError(
                "Fund not found in the catalogue",
                404,
                "MF_PRODUCT_NOT_FOUND",
            );
        }

        // 2. Apply application-level default for SIP.
        // LUMPSUM must keep frequency as null.
        const frequency =
            input.cart_type === "SIP"
                ? input.frequency ?? "MONTHLY"
                : null;

        // 3. Validate fund-specific investment thresholds.
        if (input.cart_type === "LUMPSUM") {
            await mf_threshold_validation_service.validate_lumpsum(
                product.isin,
                input.amount,
            );
        }

        if (input.cart_type === "SIP") {
            if (frequency === "MONTHLY" || frequency === "DAILY") {
                await mf_threshold_validation_service.validate_sip(
                    product.isin,
                    input.amount,
                    frequency.toLowerCase() as "monthly" | "daily",
                    input.installment_day,
                );
            } else if (frequency === "WEEKLY") {

                throw new AppError(
                    "Weekly SIP threshold validation is not supported yet",
                    400,
                    "WEEKLY_SIP_THRESHOLD_UNSUPPORTED",
                );
            }
        }

        const existing_item = await db.mfCartItem.findUnique({
            where: {
                user_id_mf_product_id_cart_type: {
                    user_id,
                    mf_product_id: input.mf_product_id,
                    cart_type: input.cart_type,
                },
            },
        });

        if (existing_item) {
            return await db.mfCartItem.update({
                where: {
                    id: existing_item.id,
                },
                data: {
                    amount: input.amount,
                    frequency,
                    installment_day:
                        input.cart_type === "SIP"
                            ? input.installment_day ?? null
                            : null,
                },
                include: {
                    mf_product: {
                        select: {
                            id: true,
                            name: true,
                            isin: true,
                            img_url: true,
                        },
                    },
                },
            });
        }

        return await db.mfCartItem.create({
            data: {
                user_id,
                mf_product_id: input.mf_product_id,
                cart_type: input.cart_type,
                amount: input.amount,
                frequency,
                installment_day:
                    input.cart_type === "SIP"
                        ? input.installment_day ?? null
                        : null,
            },
            include: {
                mf_product: {
                    select: {
                        id: true,
                        name: true,
                        isin: true,
                        img_url: true,
                    },
                },
            },
        });
    };

    add_bundle_to_cart = async (
        user_id: string,
        input: AddBundleToCartInput,
    ) => {
        // 1. Confirm the bundle exists
        const bundle = await bundle_service.get_bundle_by_id(input.bundle_id);
        if (!bundle) {
            throw new AppError("Bundle not found", 404, "BUNDLE_NOT_FOUND");
        }

        // 2. Selection count must match the bundle's total slot count
        const total_slots = bundle.categories.reduce(
            (sum, cat) => sum + cat.slots.length,
            0,
        );
        if (input.selections.length !== total_slots) {
            throw new AppError(
                `Bundle requires exactly ${total_slots} fund selection(s), got ${input.selections.length}`,
                400,
                "SELECTION_COUNT_MISMATCH",
            );
        }

        // 3. Reject duplicate fund selections
        const unique_ids = new Set(input.selections.map((s) => s.mf_product_id));
        if (unique_ids.size !== input.selections.length) {
            throw new AppError(
                "Duplicate mutual funds are selected",
                400,
                "DUPLICATE_SELECTION",
            );
        }

        // 4. Resolve each selection to its MfProduct in DB
        const products = await db.mfProduct.findMany({
            where: {
                id: { in: input.selections.map((s) => s.mf_product_id) },
            },
            select: {
                id: true,
                isin: true,
                name: true,
            },
        });

        if (products.length !== input.selections.length) {
            const found_ids = new Set(products.map((p) => p.id));
            const missing = input.selections.filter(
                (s) => !found_ids.has(s.mf_product_id),
            );
            throw new AppError(
                `Mutual fund product not found: ${missing.map((m) => m.mf_product_id).join(", ")}`,
                404,
                "PRODUCT_NOT_FOUND",
            );
        }

        const product_map = new Map(products.map((p) => [p.id, p]));

        // 5. Apply application-level default for SIP
        const frequency =
            input.cart_type === "SIP"
                ? input.frequency ?? "MONTHLY"
                : null;

        // 6. Validate fund-specific investment thresholds for each fund before writing to DB
        const prepared_items: Array<{
            mf_product_id: string;
            amount: number;
            frequency: "MONTHLY" | "WEEKLY" | "DAILY" | null;
            installment_day: number | null;
        }> = [];

        for (const selection of input.selections) {
            const product = product_map.get(selection.mf_product_id)!;
            const per_fund_amount = Math.round(
                (selection.allocation_percentage / 100) * input.amount,
            );

            if (input.cart_type === "LUMPSUM") {
                await mf_threshold_validation_service.validate_lumpsum(
                    product.isin,
                    per_fund_amount,
                );
            } else if (input.cart_type === "SIP") {
                if (frequency === "MONTHLY" || frequency === "DAILY") {
                    await mf_threshold_validation_service.validate_sip(
                        product.isin,
                        per_fund_amount,
                        frequency.toLowerCase() as "monthly" | "daily",
                        input.installment_day,
                    );
                }
            }

            prepared_items.push({
                mf_product_id: selection.mf_product_id,
                amount: per_fund_amount,
                frequency,
                installment_day:
                    input.cart_type === "SIP"
                        ? input.installment_day ?? null
                        : null,
            });
        }

        // 7. Atomic DB operations (optionally clear existing cart items of same type, then upsert all funds)
        const cart_items = await db.$transaction(async (tx) => {
            if (input.clear_existing) {
                await tx.mfCartItem.deleteMany({
                    where: {
                        user_id,
                        cart_type: input.cart_type,
                    },
                });
            }

            const items = [];
            for (const item of prepared_items) {
                const cart_item = await tx.mfCartItem.upsert({
                    where: {
                        user_id_mf_product_id_cart_type: {
                            user_id,
                            mf_product_id: item.mf_product_id,
                            cart_type: input.cart_type,
                        },
                    },
                    create: {
                        user_id,
                        mf_product_id: item.mf_product_id,
                        cart_type: input.cart_type,
                        amount: item.amount,
                        frequency: item.frequency,
                        installment_day: item.installment_day,
                    },
                    update: {
                        amount: item.amount,
                        frequency: item.frequency,
                        installment_day: item.installment_day,
                    },
                    include: {
                        mf_product: {
                            select: {
                                id: true,
                                name: true,
                                isin: true,
                                img_url: true,
                            },
                        },
                    },
                });
                items.push(cart_item);
            }
            return items;
        });

        return {
            bundle_id: input.bundle_id,
            bundle_name: bundle.bundle_name,
            cart_type: input.cart_type,
            total_funds: input.selections.length,
            added: cart_items.length,
            items: cart_items,
        };
    };

    update_cart_item = async (
        user_id: string,
        cart_item_id: string,
        input: UpdateMfCartItemInput,
    ) => {
        // 1. Find the item and verify ownership.
        const existing_item = await db.mfCartItem.findFirst({
            where: {
                id: cart_item_id,
                user_id,
            },
            include: {
                mf_product: {
                    select: {
                        id: true,
                        isin: true,
                    },
                },
            },
        });

        if (!existing_item) {
            throw new AppError(
                "MF cart item not found",
                404,
                "CART_ITEM_NOT_FOUND",
            );
        }

        if (input.amount !== undefined) {
            if (existing_item.cart_type === "LUMPSUM") {
                await mf_threshold_validation_service.validate_lumpsum(
                    existing_item.mf_product.isin,
                    input.amount,
                );
            }

            if (existing_item.cart_type === "SIP") {
                const frequency =
                    existing_item.frequency ?? "MONTHLY";

                if (
                    frequency === "MONTHLY" ||
                    frequency === "DAILY"
                ) {
                    await mf_threshold_validation_service.validate_sip(
                        existing_item.mf_product.isin,
                        input.amount,
                        frequency.toLowerCase() as "monthly" | "daily",
                        input.installment_day ??
                        existing_item.installment_day ??
                        undefined,
                    );
                } else if (frequency === "WEEKLY") {
                    throw new AppError(
                        "Weekly SIP threshold validation is not supported yet",
                        400,
                        "WEEKLY_SIP_THRESHOLD_UNSUPPORTED",
                    );
                }
            }
        }

        const update_data: {
            amount?: number;
            installment_day?: number | null;
        } = {};

        if (input.amount !== undefined) {
            update_data.amount = input.amount;
        }

        if (input.installment_day !== undefined) {
            if (existing_item.cart_type !== "SIP") {
                throw new AppError(
                    "Installment day can only be updated for SIP",
                    400,
                    "INSTALLMENT_DAY_NOT_ALLOWED",
                );
            }

            update_data.installment_day = input.installment_day;
        }

        return await db.mfCartItem.update({
            where: {
                id: cart_item_id,
            },
            data: update_data,
            include: {
                mf_product: {
                    select: {
                        id: true,
                        name: true,
                        isin: true,
                        img_url: true,
                    },
                },
            },
        });
    };

    remove_from_cart = async (
        user_id: string,
        cart_item_id: string,
    ) => {
        const existing_item = await db.mfCartItem.findFirst({
            where: {
                id: cart_item_id,
                user_id,
            },
            select: {
                id: true,
            },
        });

        if (!existing_item) {
            throw new AppError(
                "MF cart item not found",
                404,
                "CART_ITEM_NOT_FOUND",
            );
        }

        await db.mfCartItem.delete({
            where: {
                id: existing_item.id,
            },
        });

        return null;
    };

    clear_cart = async (
        user_id: string,
        cart_type?: "LUMPSUM" | "SIP",
    ) => {
        const result = await db.mfCartItem.deleteMany({
            where: {
                user_id,
                ...(cart_type ? { cart_type } : {}),
            },
        });

        return {
            deleted_count: result.count,
        };
    };

    initiate_lumpsum_checkout = async (user_id: string, user_ip: string) => {


        // 1. Get the cart items of Lumpsum and check for basic validations
        const cart_items = await db.mfCartItem.findMany({
            where: {
                user_id,
                cart_type: "LUMPSUM",
            },
            include: {
                mf_product: {
                    select: {
                        id: true,
                        isin: true,
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });

        if (cart_items.length === 0) {
            throw new AppError(
                "No lumpsum items found in cart",
                400,
                "CART_EMPTY",
            );
        }

        if (cart_items.length > 10) {
            throw new AppError(
                "Maximum 10 lumpsum orders are allowed per batch",
                400,
                "MF_BATCH_ORDERS_EXCEEDED",
            );
        }

        // TODO : need to make kyc check middleware
        const user = await db.user.findUnique({
            where: {
                id: user_id,
            },
            select: {
                investment_account: true,
                phone_no: true,
            },
        });

        if (!user?.investment_account) {
            throw new AppError(
                "Investment account is not set up",
                400,
                "INVESTMENT_ACCOUNT_MISSING",
            );
        }

        if (!user.phone_no) {
            throw new AppError(
                "Phone number is not available",
                400,
                "USER_PHONE_MISSING",
            );
        }

        const orders: Array<{
            amount: number;
            scheme: string;
            mf_investment_account: string;
            gateway: "ondc";
        }> = [];

        logger.debug(`Basic validations check are clear.. Proceeding for payload creation`)

        for (const item of cart_items) {
            // Product must exist in our MF catalogue
            if (!item.mf_product?.isin) {
                logger.warn(`MF product not found in catalogue for cart item id = ${item.id} , cart id - ${item.id} , user id - ${user_id}`)
                throw new AppError(
                    "Fund not found in catalogue",
                    404,
                    "MF_PRODUCT_NOT_FOUND",
                );
            }

            const amount = Number(item.amount);
            const scheme = item.mf_product.isin;

            await mf_threshold_validation_service.validate_lumpsum(
                scheme,
                amount,
            );

            orders.push({
                amount,
                scheme,
                mf_investment_account: user.investment_account,
                gateway: "ondc",
            });
        }

        logger.debug(`Sending payload for batch lumpsum orders`)
        const fp_response =
            await fintech_primitive_mf_purchase_service.create_batch_purchases(
                orders,
                user_ip,
            );

        const purchases = fp_response?.data;

        if (!Array.isArray(purchases) || purchases.length === 0) {
            throw new AppError(
                "No purchases were returned by Fintech Primitives",
                502,
                "MF_BATCH_PURCHASE_EMPTY_RESPONSE",
            );
        }

        const saved_orders = [];

        for (const purchase of purchases) {
            const saved =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "PURCHASE",
                    purchase,
                    false,
                );

            saved_orders.push(saved);
        }

        const batch_id = cuid();

        // FP purchase IDs belonging to this batch
        const order_ids = purchases.map(
            (purchase: any) => purchase.id,
        );

        await redis.set(
            `mf_cart_batch:${user_id}:${batch_id}`,
            JSON.stringify(order_ids),
            { EX: 5 * 60 },
        );

        await plan_confirmation_otp_service.request_otp(
            user_id,
            batch_id,
            user.phone_no,
        );

        const total_amount = cart_items.reduce(
            (total, item) => total + Number(item.amount),
            0,
        );

        return {
            batch_id,
            orders_count: saved_orders.length,
            total_amount,
        };
    };

    initiate_sip_checkout = async (
        user_id: string,
        user_ip: string,
        mandate_id: string,
    ) => {
        const cart_items = await db.mfCartItem.findMany({
            where: {
                user_id,
                cart_type: "SIP",
            },
            include: {
                mf_product: {
                    select: {
                        id: true,
                        isin: true,
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });

        if (cart_items.length === 0) {
            throw new AppError(
                "No SIP items found in cart",
                400,
                "CART_EMPTY",
            );
        }

        if (cart_items.length > 10) {
            throw new AppError(
                "Maximum 10 SIP plans are allowed per batch",
                400,
                "MF_BATCH_PLANS_EXCEEDED",
            );
        }

        const user = await db.user.findUnique({
            where: {
                id: user_id,
            },
            select: {
                investment_account: true,
                phone_no: true,
            },
        });

        if (!user?.investment_account) {
            throw new AppError(
                "Investment account is not set up",
                400,
                "INVESTMENT_ACCOUNT_MISSING",
            );
        }

        if (!user.phone_no) {
            throw new AppError(
                "Phone number is not available",
                400,
                "USER_PHONE_MISSING",
            );
        }

        const mandate = await mandate_service.get_user_mandate(user_id, mandate_id);

        if (!mandate) {
            throw new AppError(
                "Mandate not found for this user",
                404,
                "MANDATE_NOT_FOUND",
            );
        }

        if (mandate.status !== "SUCCESS") {
            throw new AppError(
                "Mandate is not approved yet - authorize the mandate first",
                400,
                "MANDATE_NOT_APPROVED",
            );
        }

        const plans = [];

        for (const item of cart_items) {
            // Product must exist in our catalogue
            if (!item.mf_product?.isin) {
                throw new AppError(
                    "Fund not found in catalogue",
                    404,
                    "MF_PRODUCT_NOT_FOUND",
                );
            }

            if (!item.frequency) {
                throw new AppError(
                    "SIP frequency is required",
                    400,
                    "SIP_FREQUENCY_REQUIRED",
                );
            }

            const frequency = item.frequency.toLowerCase() as
                | "monthly"
                | "daily";

            if (
                frequency !== "monthly" &&
                frequency !== "daily"
            ) {
                throw new AppError(
                    "Weekly SIP checkout is not supported yet",
                    400,
                    "WEEKLY_SIP_THRESHOLD_UNSUPPORTED",
                );
            }

            const amount = Number(item.amount);
            const scheme = item.mf_product.isin;

            await mf_threshold_validation_service.validate_sip(
                scheme,
                amount,
                frequency,
                item.installment_day ?? undefined,
            );

            plans.push({
                scheme,
                mf_investment_account: user.investment_account,
                frequency,
                amount,
                installment_day:
                    item.installment_day ?? null,
                systematic: true as const,
                generate_first_installment_now: true as const,
                auto_generate_installments: true as const,
                number_of_installments: 12,
                payment_method: "mandate" as const,
                payment_source: mandate.mandate_id,
                user_ip,
            });
        }

        const fp_response =
            await fintech_primitive_mf_purchase_plan_service.create_batch_purchase_plans(
                plans,
            );

        const purchase_plans = fp_response?.data;

        if (
            !Array.isArray(purchase_plans) ||
            purchase_plans.length === 0
        ) {
            throw new AppError(
                "No purchase plans were returned by Fintech Primitives",
                502,
                "MF_BATCH_PURCHASE_PLAN_EMPTY_RESPONSE",
            );
        }

        const saved_plans = [];

        for (const plan of purchase_plans) {
            if (!plan?.id) {
                throw new AppError(
                    "Invalid purchase plan returned by Fintech Primitives",
                    502,
                    "MF_PURCHASE_PLAN_RESPONSE_INVALID",
                );
            }

            const saved =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "PURCHASE",
                    plan,
                    true,
                );

            saved_plans.push(saved);
        }

        const batch_id = cuid();

        const plan_ids = purchase_plans.map(
            (plan: any) => plan.id,
        );

        await redis.set(
            `mf_cart_batch:${user_id}:${batch_id}`,
            JSON.stringify(plan_ids),
            { EX: 5 * 60 },
        );

        await plan_confirmation_otp_service.request_otp(
            user_id,
            batch_id,
            user.phone_no,
        );

        const total_amount = cart_items.reduce(
            (total, item) => total + Number(item.amount),
            0,
        );

        return {
            batch_id,
            plans_count: saved_plans.length,
            total_amount,
        };
    };

    confirm_sip_checkout = async (
        user_id: string,
        batch_id: string,
        otp: string,
    ) => {
        await plan_confirmation_otp_service.verify_otp(
            user_id,
            batch_id,
            otp,
        );

        const batch_key = `mf_cart_batch:${user_id}:${batch_id}`;
        const cached_batch = await redis.get(batch_key);

        if (!cached_batch || typeof cached_batch !== "string") {
            throw new AppError(
                "Checkout session has expired",
                400,
                "BATCH_EXPIRED",
            );
        }

        let plan_ids: string[];

        try {
            plan_ids = JSON.parse(cached_batch);
        } catch {
            throw new AppError(
                "Invalid checkout session",
                400,
                "BATCH_INVALID",
            );
        }

        if (
            !Array.isArray(plan_ids) ||
            plan_ids.length === 0
        ) {
            throw new AppError(
                "No purchase plans found for this batch",
                400,
                "BATCH_EMPTY",
            );
        }

        if (plan_ids.length > 10) {
            throw new AppError(
                "Maximum 10 purchase plans are allowed in a batch",
                400,
                "MF_BATCH_PLANS_EXCEEDED",
            );
        }

        const user = await user_service.get_user_by_id(user_id);

        if (!user) {
            throw new AppError(
                "User not found",
                404,
                "USER_NOT_FOUND",
            );
        }

        if (!user.email || !user.phone_no) {
            throw new AppError(
                "User email and phone number are required for consent",
                400,
                "USER_CONTACT_INFO_MISSING",
            );
        }

        const confirmed_plans = [];
        for (const fp_plan_id of plan_ids) {
            const transaction_plan =
                await mf_transaction_plan_service.get_by_fp_id(
                    user_id,
                    fp_plan_id,
                );

            if (!transaction_plan) {
                throw new AppError(
                    "Purchase plan not found",
                    404,
                    "MF_PURCHASE_PLAN_NOT_FOUND",
                );
            }

            if (
                transaction_plan.plan_type !== "PURCHASE" ||
                !transaction_plan.systematic
            ) {
                throw new AppError(
                    "Invalid SIP purchase plan",
                    400,
                    "INVALID_SIP_PURCHASE_PLAN",
                );
            }

            const updated_plan =
                await fintech_primitive_mf_purchase_plan_service.update_purchase_plan(
                    fp_plan_id,
                    {
                        email: user.email,
                        mobile: user.phone_no,
                        isd_code: "91",
                    },
                );

            const saved_plan =
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "PURCHASE",
                    updated_plan,
                    true,
                );

            await mf_transaction_plan_service.mark_consent_given(
                saved_plan.id,
            );

            confirmed_plans.push(saved_plan);
        }

        await db.mfCartItem.deleteMany({
            where: {
                user_id,
                cart_type: "SIP",
            },
        });

        await redis.del(batch_key);

        return {
            batch_id,
            plans_count: confirmed_plans.length,
            plans: confirmed_plans,
        };
    };

    confirm_lumpsum_checkout = async (
        user_id: string,
        batch_id: string,
        otp: string,
        payment_postback_url?: string,
    ) => {
        await plan_confirmation_otp_service.verify_otp(
            user_id,
            batch_id,
            otp,
        );

        const batch_key = `mf_cart_batch:${user_id}:${batch_id}`;

        const cached_batch = await redis.get(batch_key);

        if (!cached_batch || typeof cached_batch !== "string") {
            throw new AppError(
                "Checkout session has expired",
                400,
                "BATCH_EXPIRED",
            );
        }

        let order_ids: string[];

        try {
            order_ids = JSON.parse(cached_batch);
        } catch {
            throw new AppError(
                "Invalid checkout batch",
                400,
                "INVALID_BATCH",
            );
        }

        if (!Array.isArray(order_ids) || order_ids.length === 0) {
            throw new AppError(
                "No purchase orders found for this batch",
                400,
                "BATCH_ORDERS_EMPTY",
            );
        }

        if (order_ids.length > 10) {
            throw new AppError(
                "Maximum 10 purchase orders are allowed in a batch",
                400,
                "MF_BATCH_ORDERS_EXCEEDED",
            );
        }

        const orders = await db.mfTransactionPlan.findMany({
            where: {
                user_id,
                fp_id: {
                    in: order_ids,
                },
            },
        });

        if (orders.length !== order_ids.length) {
            logger.warn(`Some purchase orders could not be found in database- user_id - ${user_id} - batch_id - ${batch_id} - order_ids - ${JSON.stringify(order_ids)}`)
            throw new AppError(
                "Some purchase orders could not be found",
                400,
                "BATCH_ORDERS_NOT_FOUND",
            );
        }

        const user = await db.user.findUnique({
            where: {
                id: user_id,
            },
            select: {
                email: true,
                phone_no: true,
            },
        });

        if (!user?.email || !user?.phone_no) {
            throw new AppError(
                "User email and phone number are required",
                400,
                "USER_CONTACT_DETAILS_REQUIRED",
            );
        }

        // 1. FP asynchronously reviews orders: UNDER_REVIEW -> PENDING before consent can be updated.
        // Re-fetch any orders that are still recorded as UNDER_REVIEW in our database.
        for (let i = 0; i < orders.length; i++) {
            let order = orders[i];
            if (order.state === "UNDER_REVIEW") {
                for (let attempt = 0; attempt < 3; attempt++) {
                    const fresh = await fintech_primitive_mf_purchase_service.get_purchase(order.fp_id);
                    if (fresh) {
                        const updated = await mf_transaction_plan_service.upsert_from_fp(
                            user_id,
                            "PURCHASE",
                            fresh,
                            false,
                        );
                        order = updated;
                        orders[i] = updated;
                        if (order.state !== "UNDER_REVIEW") break;
                    }
                    if (attempt < 2) {
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            }

            if (order.state === "FAILED") {
                throw new AppError(
                    `Purchase order ${order.fp_id} failed during review`,
                    400,
                    "MF_PURCHASE_REVIEW_FAILED",
                );
            }

            if (order.state !== "PENDING" && order.state !== "CONFIRMED" && order.state !== "SUBMITTED") {
                throw new AppError(
                    `Order ${order.fp_id} is still under review, please retry in a few seconds`,
                    400,
                    "MF_PURCHASE_UNDER_REVIEW",
                );
            }
        }

        // 3. Update consent on FP with idempotency guard (skip if already given)
        for (const order of orders) {
            if (!order.fp_id) {
                throw new AppError(
                    "FP purchase ID is missing",
                    400,
                    "FP_PURCHASE_ID_MISSING",
                );
            }

            if (!order.consent_given_at) {
                await fintech_primitive_mf_purchase_service.update_purchase(
                    order.fp_id,
                    {
                        consent: {
                            email: user.email,
                            mobile: user.phone_no,
                            isd_code: "91",
                        },
                    },
                );

                await mf_transaction_plan_service.mark_consent_given(
                    order.id,
                );
            }
        }

        const primary_bank =
            await user_bank_details_service.get_primary(user_id);

        if (!primary_bank?.fp_bank_account_old_id) {
            throw new AppError(
                "Primary bank account is not configured",
                400,
                "PRIMARY_BANK_ACCOUNT_NOT_FOUND",
            );
        }

        const missing_old_id = orders.find(
            (order) => !order.fp_old_id,
        );

        if (missing_old_id) {
            throw new AppError(
                "FP purchase old ID is missing",
                400,
                "FP_PURCHASE_OLD_ID_MISSING",
            );
        }

        const payment =
            await fintech_primitive_payment_service.create_payment({
                amc_order_ids: orders.map(
                    (order) => order.fp_old_id!,
                ),
                bank_account_id:
                    primary_bank.fp_bank_account_old_id,
                payment_postback_url,
            });

        if (!payment?.id) {
            throw new AppError(
                "Failed to create payment",
                502,
                "MF_PAYMENT_CREATE_FAILED",
            );
        }

        const payment_id = String(payment.id);

        // 2. Track payment_id and payment_status on all orders
        for (const order of orders) {
            await mf_transaction_plan_service.set_payment_id(
                order.id,
                payment_id,
            );
            if (payment?.status) {
                await mf_transaction_plan_service.set_payment_status(
                    order.id,
                    payment.status,
                );
            }
        }

        const confirmed_response =
            await fintech_primitive_mf_purchase_service.update_batch_purchases(
                orders.map((order) => ({
                    id: order.fp_id!,
                    state: "confirmed" as const,
                })),
            );

        const confirmed_orders =
            confirmed_response?.data ?? [];

        if (confirmed_orders.length > 0) {
            for (const confirmed_order of confirmed_orders) {
                await mf_transaction_plan_service.upsert_from_fp(
                    user_id,
                    "PURCHASE",
                    confirmed_order,
                    false,
                );
            }
        } else {
            await db.mfTransactionPlan.updateMany({
                where: {
                    user_id,
                    fp_id: {
                        in: order_ids,
                    },
                },
                data: {
                    state: "CONFIRMED",
                },
            });
        }

        await db.mfCartItem.deleteMany({
            where: {
                user_id,
                cart_type: "LUMPSUM",
            },
        });

        await redis.del(batch_key);

        const final_orders =
            await db.mfTransactionPlan.findMany({
                where: {
                    user_id,
                    fp_id: {
                        in: order_ids,
                    },
                },
            });

        return {
            payment_url:
                payment?.payment_url ??
                payment?.token_url ??
                null,
            payment_id,
            payment_status: payment?.status ?? null,
            orders_count: final_orders.length,
            orders: final_orders,
        };
    };

}

export const mf_cart_service = new MfCartServiceClass();
