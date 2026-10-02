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
                        investment_mode: "both",
                        page: 1,
                        limit: 10,
                    });

                    const slots = (cat.slots || []).map((slot: any) => {
                        let pre_selected_fund = null;

                        if (slot.pre_selected_product) {
                            const p = slot.pre_selected_product;
                            pre_selected_fund = {
                                id: p.id,
                                name: p.name,
                                isin: p.isin,
                                img_url: p.img_url,
                                latest_nav: p.latest_nav ? Number(p.latest_nav) : null,
                                latest_nav_date: p.latest_nav_date,
                                returns: {
                                    return_1y: p.metrics?.return_1y ? Number(p.metrics.return_1y) : null,
                                    return_3y: p.metrics?.return_3y ? Number(p.metrics.return_3y) : null,
                                    return_5y: p.metrics?.return_5y ? Number(p.metrics.return_5y) : null,
                                },
                                min_investment: {
                                    lumpsum_min: p.scheme_plan?.lumpsum_amount_min ? Number(p.scheme_plan.lumpsum_amount_min) : null,
                                    sip_monthly_min: p.scheme_plan?.sip_monthly_amount_min ? Number(p.scheme_plan.sip_monthly_amount_min) : null,
                                },
                            };
                        } else if (category_funds.funds.length > 0) {
                            const fallback_idx = Math.max(0, (slot.default_rank || 1) - 1);
                            pre_selected_fund = category_funds.funds[fallback_idx] ?? category_funds.funds[0];
                        }

                        return {
                            id: slot.id,
                            allocation_percentage: slot.allocation_percentage,
                            default_rank: slot.default_rank,
                            pre_selected_product_id: slot.pre_selected_product_id,
                            pre_selected_fund,
                        };
                    });

                    return {
                        id: cat.id,
                        category_name: cat.category_name,
                        display_name: cat.display_name,
                        total_percentage: cat.total_percentage,
                        slots,
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
