import { db } from "../server.js";
import { CreateBundleInput } from "../lib/zod-schemas/bundle.schema.js";

class BundleServiceClass {

    async create_bundle(data: CreateBundleInput) {
        const { bundle_name, bundle_products } = data;

        return await db.bundle.create({
            data: {
                bundle_name,
                bundle_products: {
                    create: bundle_products
                }
            },
            include: {
                bundle_products: true
            }
        });
    }

    async get_bundles({ page = 1, limit = 20 }: { page?: number, limit?: number }) {
        const skip = (page - 1) * limit;

        const [bundles, total] = await Promise.all([
            db.bundle.findMany({
                skip,
                take: limit,
                include: {
                    bundle_products: {
                        include: {
                            mf_product: true
                        }
                    }
                },
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
                bundle_products: {
                    include: {
                        mf_product: true
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