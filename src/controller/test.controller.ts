import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { notification_producer_service } from "../services/notification.producer.service.js";

class TestControllerClass {

    send_test_notification = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!
            const { type, title, body, payload } = req.body;

            if (!type || !title || !body) {
                throw new AppError("type, title and body are required", 400, "MISSING_FIELDS");
            }

            logger.info(`Publishing test notification event for user: ${user.id}`);

            const published = await notification_producer_service.publish_notification_event(
                user.id,
                type,
                title,
                body,
                payload
            );

            if (!published) {
                throw new AppError("Failed to publish notification event", 500, "NOTIFICATION_PUBLISH_FAILED");
            }

            res.status(200).json({
                success: true,
                message: "Test notification event published successfully"
            });
            return;

        } catch (error: any) {
            logger.error("Error while sending test notification ==> ", error.message);
            next(error);
            return;
        }
    }
}

export const test_controller = new TestControllerClass();
