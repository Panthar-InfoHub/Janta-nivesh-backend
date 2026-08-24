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
            const { tag, page, limit } = funds_by_tag_query_schema.parse(req.query);

            logger.info("Fetching funds by tag", { tag, page, limit });

            const data = await mf_catalogue_service.get_funds_by_tag(tag, { page, limit });

            res.status(200).json({
                success: true,
                message: "Funds fetched",
                data
            });
            return;
        } catch (error) {
            logger.error("Error in get_funds_by_tag controller:", error);
            next(error);
            return;
        }
    }
}

export const mf_catalogue_controller = new MfCatalogueControllerClass();
