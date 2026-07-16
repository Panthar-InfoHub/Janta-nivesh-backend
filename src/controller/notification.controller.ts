import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { notification_service } from "../services/notification.service.js";

class NotificationControllerClass {

    get_notifications = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            const { page = 1, limit = 20 } = req.query as any;

            logger.info(`Fetching notifications for User ID: ${user_id}, page: ${page}, limit: ${limit}`);

            const data = await notification_service.get_user_notifications(user_id, {
                page: parseInt(page),
                limit: parseInt(limit)
            });

            res.status(200).json({
                success: true,
                message: "Notifications fetched successfully",
                data
            });
            return;

        } catch (error) {
            logger.error("Error in get_notifications: ", error);
            next(error);
            return;
        }
    }

    get_unread_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;

            const has_unread = await notification_service.get_unread_status(user_id);

            res.status(200).json({
                success: true,
                message: "Unread status fetched successfully",
                data: { has_unread }
            });
            return;

        } catch (error) {
            logger.error("Error in get_unread_status: ", error);
            next(error);
            return;
        }
    }

    mark_all_read = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;

            const count = await notification_service.mark_all_read(user_id);

            res.status(200).json({
                success: true,
                message: "Notifications marked as read",
                data: { updated_count: count }
            });
            return;

        } catch (error) {
            logger.error("Error in mark_all_read: ", error);
            next(error);
            return;
        }
    }

    mark_notification_read = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            const { id } = req.params as { id: string };

            const updated = await notification_service.mark_notification_read(user_id, id);

            if (!updated) {
                throw new AppError("Notification not found or already read", 404, "NOTIFICATION_NOT_FOUND");
            }

            res.status(200).json({
                success: true,
                message: "Notification marked as read"
            });
            return;

        } catch (error) {
            logger.error("Error in mark_notification_read: ", error);
            next(error);
            return;
        }
    }
}

export const notification_controller = new NotificationControllerClass();
