import { db } from "../server.js";
import { CreateBundleInput } from "../lib/zod-schemas/bundle.schema.js";

class BundleServiceClass {

    async create_bundle(data: CreateBundleInput) {
        const { bundle_name, meta_data, hybrid_percentage, bundle_description, equity_percentage, commodity_percentage, debt_percentage, categories } = data;

        return await db.bundle.create({
            data: {
                bundle_name,
                bundle_description,
                equity_percentage,
                commodity_percentage,
                hybrid_percentage,
                debt_percentage,
                meta_data,
                categories: {
                    create: categories.map(category => ({
                        category_name: category.category_name,
                        display_name: category.display_name,
                        total_percentage: category.total_percentage,
                        slots: {
                            create: category.slots
                        }
                    }))
                }
            },
            include: {
                categories: {
                    include: {
                        slots: true
                    }
                }
            }
        });
    }

    async get_bundles({ page = 1, limit = 20 }: { page?: number, limit?: number }) {
        const skip = (page - 1) * limit;

        const [bundles, total] = await Promise.all([
            db.bundle.findMany({
                skip,
                // include: {
                //     categories: {
                //         include: {
                //             slots: true
                //         }
                //     }
                // },
                take: limit,
                orderBy: {
                    bundle_name: 'asc'
                }
            }),
            db.bundle.count()
        ]);

        return {
            bundles,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async get_bundle_by_id(id: string) {
        return await db.bundle.findUnique({
            where: { id },
            include: {
                categories: {
                    include: {
                        slots: true
                    }
                }
            }
        });
    }

    async delete_bundle(id: string) {
        return await db.bundle.delete({
            where: { id }
        });
    }

}

export const bundle_service = new BundleServiceClass();