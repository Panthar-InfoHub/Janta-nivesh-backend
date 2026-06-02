import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { bundle_service } from "../services/bundle.services.js";
import { create_bundle_zod_schema } from "../lib/zod-schemas/bundle.schema.js";

class BundleControllerClass {

    private intersection = <T>(arrays: T[][]): T[] => {
        if (arrays.length === 0) return [];
        const [first, ...rest] = arrays;
        return first.filter(item => rest.every(arr => arr.includes(item)));
    };


    create_bundle = async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.info("Creating a new bundle");
            const data = create_bundle_zod_schema.parse(req.body);

            const result = await bundle_service.create_bundle(data);

            res.status(201).json({
                success: true,
                message: "Bundle created successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in create_bundle controller:", error);
            next(error);
            return;
        }
    }

    get_bundles = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            logger.info(`Fetching bundles - Page: ${page}, Limit: ${limit}`);
            const result = await bundle_service.get_bundles({ page, limit });

            // Only accumulated min amount of each bundle inside result.bundles[]
            result.bundles = result.bundles.map(bundle => {
                const total_min_amount = bundle.bundle_products.reduce((acc, bp) => acc + Number(bp.min_amount), 0);
                return {
                    ...bundle,
                    accumulated_min_amount: total_min_amount
                };
            });

            res.status(200).json({
                success: true,
                message: "Bundles fetched successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in get_bundles controller:", error);
            next(error);
            return;
        }
    }

    get_bundle_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            logger.info(`Fetching bundle by id: ${id}`);

            const result = await bundle_service.get_bundle_by_id(id);

            const {
                accumulated_min_amount,
                all_frequencies,
                all_dates,
                filtered_products
            } = result.bundle_products.reduce(
                (acc, bp) => {
                    const rules = bp.mf_product.transaction_rules;

                    // 1. Accumulate min amount
                    acc.accumulated_min_amount += Number(bp.min_amount);

                    // 2. Collect frequencies (ignore empty)
                    if (rules?.sip_frequencies?.length) {
                        acc.all_frequencies.push(rules.sip_frequencies);
                    }

                    // 3. Collect dates (ignore empty)
                    if (rules?.sip_allowed_dates?.length) {
                        acc.all_dates.push(rules.sip_allowed_dates);
                    }

                    // 4. Remove transaction_rules from the product in the response list
                    const { transaction_rules, ...mf_product_without_rules } = bp.mf_product;
                    acc.filtered_products.push({
                        ...bp,
                        mf_product: mf_product_without_rules
                    });

                    return acc;
                },
                {
                    accumulated_min_amount: 0,
                    all_frequencies: [] as string[][],
                    all_dates: [] as number[][],
                    filtered_products: [] as any[]
                }
            );

            const allowed_frequencies = this.intersection(all_frequencies);
            const allowed_dates = this.intersection(all_dates);

            res.status(200).json({
                success: true,
                message: "Bundle fetched successfully",
                data: {
                    ...result,
                    bundle_products: filtered_products,
                    accumulated_min_amount,
                    allowed_frequencies,
                    allowed_dates,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in get_bundle_by_id controller:", error);
            next(error);
            return;
        }
    }

    delete_bundle = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            logger.info(`Deleting bundle by id: ${id}`);

            await bundle_service.delete_bundle(id);

            res.status(200).json({
                success: true,
                message: "Bundle deleted successfully"
            });
            return;
        } catch (error) {
            logger.error("Error in delete_bundle controller:", error);
            next(error);
            return;
        }
    }

}

export const bundle_controller = new BundleControllerClass();
