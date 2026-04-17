import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { mutual_funds_service } from "../services/mutual-fund.service.js";
import { bundle_service } from "../services/bundle.services.js";
import { redis_buffer_client } from "../lib/redis.js";
import { compress_json, decompress_json } from "../lib/utils.js";

class FrontendControllerClass {

    get_frontend_mf_data = async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.info("Fetching frontend mf data...")
            const cache_key = "frontend_mf_data";

            const cached = await redis_buffer_client.get(cache_key);
            if (cached) {
                logger.debug("Returning frontend mf data from cache.");
                const cached_data = await decompress_json<any>(cached as Buffer);
                res.status(200).json({
                    success: true,
                    message: "Frontend mf data fetched successfully from cache",
                    data: cached_data
                });
                return;
            }

            const [bundle, flexi_cap, large_cap, mid_cap, small_cap, index] = await Promise.all([
                bundle_service.get_bundles({ page: 1, limit: 6 }),
                mutual_funds_service.get_mutual_funds({
                    pagination: { page: 1, limit: 6 },
                    query: {},
                    order: { metrics: { return_3y: 'desc' } },
                    search: 'flexicap'
                }),
                mutual_funds_service.get_mutual_funds({
                    pagination: { page: 1, limit: 6 },
                    query: {},
                    order: { metrics: { return_3y: 'desc' } },
                    search: 'largecap'
                }),
                mutual_funds_service.get_mutual_funds({
                    pagination: { page: 1, limit: 6 },
                    query: {},
                    order: { metrics: { return_3y: 'desc' } },
                    search: 'midcap'
                }),
                mutual_funds_service.get_mutual_funds({
                    pagination: { page: 1, limit: 6 },
                    query: {},
                    order: { metrics: { return_3y: 'desc' } },
                    search: 'smallcap'
                }),
                mutual_funds_service.get_mutual_funds({
                    pagination: { page: 1, limit: 6 },
                    query: {},
                    order: { metrics: { return_3y: 'desc' } },
                    search: 'index'
                })
            ]);

            const response_data = [
                { title: "Curated Bundles", items: bundle.bundles, key: "Bundle api hit kr nalle" },
                { title: "Flexi Cap", items: flexi_cap.mutual_funds, key: "flexicap" },
                { title: "Large Cap", items: large_cap.mutual_funds, key: "largecap" },
                { title: "Mid Cap", items: mid_cap.mutual_funds, key: "midcap" },
                { title: "Small Cap", items: small_cap.mutual_funds, key: "smallcap" },
                { title: "Index", items: index.mutual_funds, key: "index" }
            ];

            const compressed = await compress_json(response_data);
            await redis_buffer_client.set(cache_key, compressed, { EX: 300 });

            res.status(200).json({
                success: true,
                message: "Frontend mf data fetched successfully",
                data: response_data
            });
            return;

        } catch (error) {
            logger.error("Error in get_frontend_mf_data: ", error)
            next(error)
            return;
        }
    }

}

export const frontend_controller = new FrontendControllerClass();