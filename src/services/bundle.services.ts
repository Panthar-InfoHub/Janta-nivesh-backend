import { db } from "../server.js";
import { CreateBundleInput, UpdateBundleInput } from "../lib/zod-schemas/bundle.schema.js";
import { Prisma } from "../prisma/generated/prisma/client.js";
import AppError from "../middleware/error.middleware.js";

function deep_merge(target: any, source: any): any {
    if (typeof target !== "object" || target === null || Array.isArray(target)) {
        return source;
    }
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
        return source;
    }
    const output = { ...target };
    for (const key of Object.keys(source)) {
        if (
            typeof source[key] === "object" &&
            source[key] !== null &&
            !Array.isArray(source[key]) &&
            key in target &&
            typeof target[key] === "object" &&
            target[key] !== null &&
            !Array.isArray(target[key])
        ) {
            output[key] = deep_merge(target[key], source[key]);
        } else {
            output[key] = source[key];
        }
    }
    return output;
}

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

    async update_bundle(identifier: string, data: UpdateBundleInput) {
        const bundle = await db.bundle.findFirst({
            where: {
                OR: [
                    { id: identifier },
                    { bundle_name: identifier },
                ],
            },
        });

        if (!bundle) {
            throw new AppError("Bundle not found", 404, "BUNDLE_NOT_FOUND");
        }

        let updated_meta_data: any = bundle.meta_data;
        if (data.meta_data !== undefined) {
            if (data.meta_data === null) {
                updated_meta_data = data.overwrite_meta_data ? null : bundle.meta_data;
            } else if (data.overwrite_meta_data) {
                updated_meta_data = data.meta_data as Prisma.InputJsonValue;
            } else {
                const existing_obj =
                    typeof bundle.meta_data === "object" && bundle.meta_data !== null && !Array.isArray(bundle.meta_data)
                        ? (bundle.meta_data as Record<string, any>)
                        : {};
                updated_meta_data = deep_merge(existing_obj, data.meta_data) as Prisma.InputJsonValue;
            }
        }

        return await db.bundle.update({
            where: { id: bundle.id },
            data: {
                ...(data.bundle_name !== undefined ? { bundle_name: data.bundle_name } : {}),
                ...(data.bundle_description !== undefined ? { bundle_description: data.bundle_description } : {}),
                ...(data.is_published !== undefined ? { is_published: data.is_published } : {}),
                ...(data.equity_percentage !== undefined ? { equity_percentage: data.equity_percentage } : {}),
                ...(data.commodity_percentage !== undefined ? { commodity_percentage: data.commodity_percentage } : {}),
                ...(data.hybrid_percentage !== undefined ? { hybrid_percentage: data.hybrid_percentage } : {}),
                ...(data.debt_percentage !== undefined ? { debt_percentage: data.debt_percentage } : {}),
                ...(data.img_url !== undefined ? { img_url: data.img_url } : {}),
                ...(data.hex !== undefined ? { hex: data.hex } : {}),
                ...(data.meta_data !== undefined ? { meta_data: updated_meta_data as Prisma.InputJsonValue } : {}),
            },
            include: {
                types: {
                    select: {
                        id: true,
                        investment_type: true,
                        start_amount: true,
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