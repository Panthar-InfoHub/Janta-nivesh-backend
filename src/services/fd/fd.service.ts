import { db } from "../../server.js";
import { FdCustomerType, FdPayoutFrequency } from "../../prisma/generated/prisma/enums.js";
import {
    FdInterestRateWhereInput,
    FdProductOrderByWithRelationInput,
    FdProductWhereInput
} from "../../prisma/generated/prisma/models.js";
import { pagination } from "../mutual-fund.service.js";

class FdServiceClass {

    get_fd_products = async ({ pagination, order, query, interest_rate_filter }: { pagination: pagination, order: FdProductOrderByWithRelationInput, query: FdProductWhereInput, interest_rate_filter: FdInterestRateWhereInput }) => {
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;

        const [total, fd_products] = await Promise.all([
            db.fdProduct.count({ where: query }),
            db.fdProduct.findMany({
                where: query,
                select: {
                    id: true,
                    issuer_id: true,
                    type: true,
                    min_deposit: true,
                    max_deposit: true,
                    min_tenure_days: true,
                    max_tenure_days: true,
                    lock_in_period_days: true,
                    premature_penalty_percent: true,
                    withdrawal_message: true,
                    tags: true,
                    issuer: {
                        select: {
                            full_name: true,
                            logo_url: true,
                        }
                    },
                    interest_rates: {
                        where: interest_rate_filter,
                        select: {
                            tenure_days: true,
                            tenure_label: true,
                            interest_rate: true,
                            annualized_yield: true,
                            payout_frequency: true,
                            is_default_selection: true,
                            customer_type: true,
                        },
                        orderBy: [
                            { is_default_selection: 'desc' }, // Use it if it exists
                            { interest_rate: 'desc' }        // Otherwise, show the best rate
                        ],
                        take: 1,
                    }
                },
                skip: offset,
                take: limit,
                orderBy: order
            })
        ]);


        return {
            fd_products,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            }
        };
    }
    get_fd_details = async ({
        id,
        payout_frequency = FdPayoutFrequency.CUMULATIVE,
        customer_type = FdCustomerType.STANDARD,
    }: {
        id: string,
        payout_frequency?: FdPayoutFrequency,
        customer_type?: FdCustomerType,
    }) => {
        return await db.fdProduct.findUnique({
            where: { id },
            select: {
                id: true,
                issuer_id: true,
                type: true,
                min_deposit: true,
                max_deposit: true,
                min_tenure_days: true,
                max_tenure_days: true,
                lock_in_period_days: true,
                withdrawal_message: true,
                premature_penalty_percent: true,
                is_vkyc_required: true,
                min_amount_for_vkyc: true,
                usps: true,
                faqs: true,
                tags: true,
                issuer: {
                    select: {
                        id: true,
                        full_name: true,
                        display_name: true,
                        issuer_type: true,
                        logo_url: true,
                        banner_url: true,
                        rating_text: true,
                        customer_served: true,
                        operating_since: true,
                        about_description: true,
                        support_email: true,
                        support_phone: true,
                    }
                },
                interest_rates: {
                    where: {
                        payout_frequency,
                        customer_type,
                    },
                    select: {
                        id: true,
                        payout_frequency: true,
                        customer_type: true,
                        tenure_days: true,
                        tenure_label: true,
                        interest_rate: true,
                        annualized_yield: true,
                        is_default_selection: true,
                        is_tax_saver: true,
                        last_updated_at: true,
                    },
                    orderBy: {
                        tenure_days: "asc"
                    }
                }
            }
        });
    }

    get_fd_interest_rate = async ({
        product_id,
        payout_frequency,
        tenure_days,
    }: {
        product_id: string;
        payout_frequency: FdPayoutFrequency;
        
        tenure_days: number;
    }) => {
        return await db.fdInterestRate.findFirst({
            where: {
                fd_product_id: product_id,
                payout_frequency,
                tenure_days,
            },
        });
    }

}

export const fd_service = new FdServiceClass();