import { db } from "../server.js";
import AppError from "../middleware/error.middleware.js";
import { mf_threshold_validation_service } from "./mutual-funds/mf-threshold-validation.service.js";
import cuid from "cuid";
import { redis } from "../lib/redis.js";
import { fintech_primitive_mf_purchase_service } from "./fintech-primitive/mf_purchase.service.js";
import { mf_transaction_plan_service } from "./mf-transaction-plan.service.js";
import { plan_confirmation_otp_service } from "./plan-confirmation-otp.service.js";
import { user_service } from "./user.service.js";
import type {
    AddMfCartItemInput,
    UpdateMfCartItemInput,
} from "../lib/zod-schemas/mf-cart.schema.js";

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

    initiate_lumpsum_checkout = async (user_id: string) => {

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

        for (const item of cart_items) {
            // Product must exist in our MF catalogue
            if (!item.mf_product?.isin) {
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

        const fp_response =
            await fintech_primitive_mf_purchase_service.create_batch_purchases(
                orders,
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


}

export const mf_cart_service = new MfCartServiceClass();