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

            const [bundle, flexi_cap, large_mid_cap, large_cap, mid_cap, small_cap, index, global_others] = await Promise.all([
                bundle_service.get_bundles({ page: 1, limit: 4 }),
                mutual_funds_service.query.get_funds_by_category({ category: 'flexi_cap' }),
                mutual_funds_service.query.get_funds_by_category({ category: 'large_Mid_cap' }),
                mutual_funds_service.query.get_funds_by_category({ category: 'large_cap' }),
                mutual_funds_service.query.get_funds_by_category({ category: 'mid_cap' }),
                mutual_funds_service.query.get_funds_by_category({ category: 'small_cap' }),
                mutual_funds_service.query.get_funds_by_category({ category: 'index' }),
                mutual_funds_service.query.get_funds_by_category({ category: 'global_others' }),
            ]);

            bundle.bundles = bundle.bundles.map(bundle => {
                const total_min_amount = bundle.bundle_products.reduce((acc, bp) => acc + Number(bp.min_amount), 0);
                return {
                    ...bundle,
                    accumulated_min_amount: total_min_amount
                };
            });

            const response_data = {
                bundle_funds: {
                    title: "Curated Bundles",
                    items: bundle.bundles,
                    key: "bundle_funds"
                },
                normal_funds: {
                    title: "Normal Bundles", key: "normal_funds", items: [
                        { title: "Flexi Cap", items: flexi_cap.mutual_funds, key: "flexi_cap" },
                        { title: "Large & Mid Cap", items: large_mid_cap.mutual_funds, key: "large_Mid_cap" },
                        { title: "Large Cap", items: large_cap.mutual_funds, key: "large_cap" },
                        { title: "Mid Cap", items: mid_cap.mutual_funds, key: "mid_cap" },
                        { title: "Small Cap", items: small_cap.mutual_funds, key: "small_cap" },
                        { title: "Index", items: index.mutual_funds, key: "index" },
                        { title: "Global / Others", items: global_others.mutual_funds, key: "global_others" }
                    ]
                }
            }

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