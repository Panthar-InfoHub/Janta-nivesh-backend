import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { bundle_service } from "../services/bundle.services.js";
import { redis_buffer_client } from "../lib/redis.js";
import { compress_json, decompress_json } from "../lib/utils.js";
import AppError from "../middleware/error.middleware.js";
import { request_connection_schema } from "../lib/types.js";
import { user_service } from "../services/user.service.js";
import { zoho_webhook_service } from "../services/zoho.webhook.service.js";

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

            // Category browse (flexi/large-mid/large/mid/small cap, index, global) used the v1
            // Finnsys-backed catalogue query, which is retired as part of the Cybrilla/FP
            // catalogue migration (MfQueryService.ts is excluded from the build - see
            // tsconfig.json). Degrading each section to an empty list rather than crashing the
            // whole homepage payload; a v2-catalogue equivalent isn't built yet.
            const empty_category = { mutual_funds: [] as unknown[] };
            const [bundle, flexi_cap, large_mid_cap, large_cap, mid_cap, small_cap, index, global_others] = await Promise.all([
                bundle_service.get_bundles({ page: 1, limit: 4 }),
                Promise.resolve(empty_category),
                Promise.resolve(empty_category),
                Promise.resolve(empty_category),
                Promise.resolve(empty_category),
                Promise.resolve(empty_category),
                Promise.resolve(empty_category),
                Promise.resolve(empty_category),
            ]);

            // bundle.bundles = bundle.bundles.map(bundle => {
            //     const total_min_amount = bundle.categories.
            //     return {
            //         ...bundle,
            //         // accumulated_min_amount: total_min_amount ?? ""
            //     };
            // });

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

    request_connection = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Requesting connection for user ==> ${user.id}`);
            const connection_data = request_connection_schema.safeParse(req.body);

            if (!connection_data.success) {
                logger.error(`Error while requesting a user connection ==> `, connection_data.error);
                throw new AppError("Validation failed while requesting user connection", 400, "VALIDATION_ERROR", connection_data.error);
            }
            const { type, message } = connection_data.data;
            const user_data = await user_service.get_user_by_id(user.id);

            if (!user_data) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            await zoho_webhook_service.send_event({
                event_type: `${type}_CONNECTION_REQUESTED`,
                timestamp: new Date().toISOString(),
                user_id: user.id,
                user_phone: user_data.phone_no ?? "",
                full_name: user_data.full_name ?? "",
                email: user_data.email ?? "",
                // inv_id: user_data.inv_id ? String(user_data.inv_id) : undefined,
                connection_type: type,
                message: message
            });

            res.status(200).json({
                success: true,
                message: "Connection request submitted successfully"
            });
            return;

        } catch (error) {
            logger.error(`Error while requesting a user connection ==> `, error);
            next(error);
            return;
        }
    }

}

export const frontend_controller = new FrontendControllerClass();