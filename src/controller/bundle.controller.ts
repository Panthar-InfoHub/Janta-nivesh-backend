import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { bundle_service } from "../services/bundle.services.js";
import { create_bundle_zod_schema } from "../lib/zod-schemas/bundle.schema.js";
import {
    mf_catalogue_service,
    MF_SECTION_TITLES,
    type MfSectionTag,
} from "../services/mutual-funds/mf-catalogue.service.js";

class BundleControllerClass {

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

            const bundle_result = await bundle_service.get_bundle_by_id(id);
            if (!bundle_result) {
                throw new AppError("Bundle not found", 404, "BUNDLE_NOT_FOUND");
            }

            logger.debug("Bundle result ==> ", bundle_result);

            const categories = await Promise.all(
                bundle_result.categories.map(async (cat) => {
                    const normalized = cat.category_name.toLowerCase().trim();
                    let tag: MfSectionTag = "popular";

                    if (normalized in MF_SECTION_TITLES) {
                        tag = normalized as MfSectionTag;
                    } else if (
                        normalized === "large_mid_cap" ||
                        normalized === "large_and_mid_cap"
                    ) {
                        tag = "mid_cap";
                    } else if (
                        normalized === "index" ||
                        normalized === "gold" ||
                        normalized === "silver" ||
                        normalized === "arbitrage" ||
                        normalized === "global_others"
                    ) {
                        tag = "others";
                    }

                    const category_funds = await mf_catalogue_service.get_funds({
                        tag,
                        page: 1,
                        limit: 10,
                    });

                    return {
                        ...cat,
                        funds: category_funds.funds,
                    };
                }),
            );

            res.status(200).json({
                success: true,
                message: "Bundle fetched successfully",
                data: {
                    bundle_name: bundle_result.bundle_name,
                    bundle_description: bundle_result.bundle_description,
                    equity_percentage: bundle_result.equity_percentage,
                    commodity_percentage: bundle_result.commodity_percentage,
                    debt_percentage: bundle_result.debt_percentage,
                    hybrid_percentage: bundle_result.hybrid_percentage,
                    meta_data: bundle_result.meta_data,
                    categories,
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
