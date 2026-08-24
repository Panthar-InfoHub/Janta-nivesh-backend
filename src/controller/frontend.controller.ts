import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { bundle_service } from "../services/bundle.services.js";
import { mf_catalogue_service } from "../services/mutual-funds/mf-catalogue.service.js";
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

            // Every section is keyed by its tag, which is also what GET /api/v2/mf/funds?tag=
            // takes for the "see all" screen behind each carousel's arrow.
            //
            // Only `popular` resolves to real funds today. The category sections are declared and
            // returned empty on purpose - MfProduct has no category field yet (DISC-0 in Todo.md),
            // and an empty section is honest where a wrongly-populated one wouldn't be. They fill
            // themselves in once that column lands; no change needed here.
            const [bundle, mf_sections] = await Promise.all([
                bundle_service.get_bundles({ page: 1, limit: 4 }),
                mf_catalogue_service.get_sections(5),
            ]);

            const response_data = {
                // bundle_funds: {
                //     title: "Curated Bundles",
                //     items: bundle.bundles,
                //     tag: "bundle_funds",
                //     key: "bundle_funds", // deprecated alias of `tag` - kept so the current app build keeps working
                // },
                ...mf_sections,
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