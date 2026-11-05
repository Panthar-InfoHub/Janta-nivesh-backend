import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { funds_by_tag_query_schema } from "../lib/zod-schemas/mf-catalogue.schema.js";
import { mf_catalogue_service } from "../services/mutual-funds/mf-catalogue.service.js";

class MfCatalogueControllerClass {

    /**
     * One section's funds, paginated - the "see all" screen behind each carousel's arrow.
     * `tag` comes straight from the section the frontend rendered (GET /api/v1/frontend/mf-data).
     *
     * Public - no login_require, same as mf-scheme's fund lookup. Discovery happens before a user
     * has onboarded, so it can't sit behind auth.
     */
    get_funds_by_tag = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { tag, search, category, amount_type, investment_mode, page, limit } = funds_by_tag_query_schema.parse(req.query);

            logger.debug(`tag ${tag} search ${search} category ${category} amount_type ${amount_type} investment_mode ${investment_mode} page ${page} limit ${limit}`);

            const data = await mf_catalogue_service.get_funds({
                tag,
                search,
                category,
                amount_type,
                investment_mode,
                page,
                limit,
            });

            res.status(200).json({
                success: true,
                message: search && search.length > 0 ? "Funds searched successfully" : "Funds fetched",
                data
            });
            return;
        } catch (error) {
            logger.error("Error in get_funds_by_tag controller:", error);
            next(error);
            return;
        }
    }

    /**
     * Get specific mutual fund product by ID or ISIN.
     * Returns product details, images, metrics, scheme plan rules, and transaction eligibility.
     */
    get_mutual_fund_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            if (!id || id.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    message: "Product ID is required",
                });
                return;
            }

            const data = await mf_catalogue_service.get_mutual_fund_by_id(id.trim());

            res.status(200).json({
                success: true,
                message: "Mutual fund details fetched successfully",
                data,
            });
            return;
        } catch (error) {
            logger.error("Error in get_mutual_fund_by_id controller:", error);
            next(error);
            return;
        }
    }

    /**
     * Get mutual fund NAV history by ID or ISIN, filtered by period (1m, 3m, 6m, 1y, 3y, 5y, all).
     */
    get_mutual_fund_history = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id as string;
            if (!id || id.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    message: "Product ID is required",
                });
                return;
            }

            const period = (req.query.period as string) || "5y";

            const data = await mf_catalogue_service.get_mutual_fund_history(id.trim(), period);

            res.status(200).json({
                success: true,
                message: "Mutual fund history fetched successfully",
                data,
            });
            return;
        } catch (error) {
            logger.error("Error in get_mutual_fund_history controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_catalogue_controller = new MfCatalogueControllerClass();
