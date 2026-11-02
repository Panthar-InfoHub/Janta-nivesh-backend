import { db } from "../server.js";
import { CreateBundleInput } from "../lib/zod-schemas/bundle.schema.js";
import { Prisma } from "../prisma/generated/prisma/client.js";

class BundleServiceClass {

    async create_bundle(data: CreateBundleInput) {
        const {
            bundle_name,
            meta_data,
            hybrid_percentage,
            bundle_description,
            is_published,
            equity_percentage,
            commodity_percentage,
            debt_percentage,
            types,
        } = data;

        return await db.bundle.create({
            data: {
                bundle_name,
                bundle_description,
                is_published: is_published ?? false,
                equity_percentage,
                commodity_percentage,
                hybrid_percentage,
                debt_percentage,
                meta_data: meta_data as Prisma.InputJsonValue,
                types: {
                    create: types.map((type) => ({
                        investment_type: type.investment_type,
                        start_amount: type.start_amount,
                        categories: {
                            create: type.categories.map((category) => ({
                                category_name: category.category_name,
                                display_name: category.display_name,
                                total_percentage: category.total_percentage,
                                slots: {
                                    create: category.slots.map((slot) => ({
                                        allocation_percentage: slot.allocation_percentage,
                                        default_rank: slot.default_rank,
                                        pre_selected_product_id: slot.pre_selected_product_id ?? null,
                                    })),
                                },
                            })),
                        },
                    })),
                },
            },
            include: {
                types: {
                    include: {
                        categories: {
                            include: {
                                slots: {
                                    include: {
                                        pre_selected_product: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
    }

    async get_bundles({
        page = 1,
        limit = 20,
        published_only = true,
    }: {
        page?: number;
        limit?: number;
        published_only?: boolean;
    }) {
        const skip = (page - 1) * limit;
        const where: Prisma.BundleWhereInput = published_only ? { is_published: true } : {};

        const [bundles, total] = await Promise.all([
            db.bundle.findMany({
                where,
                skip,
                include: {
                    types: {
                        select: {
                            id: true,
                            investment_type: true,
                            start_amount: true,
                            categories: {
                                select: {
                                    id: true,
                                    category_name: true,
                                    display_name: true,
                                    total_percentage: true,
                                    slots: {
                                        select: {
                                            id: true,
                                            allocation_percentage: true,
                                            default_rank: true,
                                            pre_selected_product_id: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                take: limit,
                orderBy: {
                    bundle_name: "asc",
                },
            }),
            db.bundle.count({ where }),
        ]);

        return {
            bundles,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async get_bundle_by_id(id: string) {
        return await db.bundle.findUnique({
            where: { id },
            include: {
                types: {
                    include: {
                        categories: {
                            include: {
                                slots: {
                                    include: {
                                        pre_selected_product: {
                                            select: {
                                                id: true,
                                                name: true,
                                                isin: true,
                                                img_url: true,
                                                latest_nav: true,
                                                latest_nav_date: true,
                                                metrics: {
                                                    select: {
                                                        return_1y: true,
                                                        return_3y: true,
                                                        return_5y: true,
                                                    },
                                                },
                                                scheme_plan: {
                                                    select: {
                                                        plan_type: true,
                                                        option: true,
                                                        sub_category: true,
                                                        fund_category: true,
                                                        lumpsum_amount_min: true,
                                                        sip_monthly_amount_min: true,
                                                        sip_daily_amount_min: true,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
    }

    async set_bundle_publish_status(id: string, is_published: boolean) {
        return await db.bundle.update({
            where: { id },
            data: { is_published },
        });
    }

    async delete_bundle(id: string) {
        return await db.bundle.delete({
            where: { id },
        });
    }

}

export const bundle_service = new BundleServiceClass();