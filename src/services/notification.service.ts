import { db } from "../server.js";
import logger from "../middleware/logger.js";
import { getUserUnreadStatus, setUserUnreadStatus } from "./notification.producer.service.js";

type PaginationInput = {
    page?: number;
    limit?: number;
};

class NotificationServiceClass {

    async get_user_notifications(user_id: string, { page = 1, limit = 20 }: PaginationInput) {
        const offset = (page - 1) * limit;

        const [total, notifications] = await Promise.all([
            db.notification.count({ where: { user_id } }),
            db.notification.findMany({
                where: { user_id },
                orderBy: { createdAt: "desc" },
                skip: offset,
                take: limit
            })
        ]);

        return {
            total,
            page,
            limit,
            notifications
        };
    }

    /**
     * O(1) "red dot" check. Reads the Redis cache first; on a miss, falls back to the
     * DB and repopulates the cache so subsequent reads stay O(1).
     */
    async get_unread_status(user_id: string): Promise<boolean> {
        const cached = await getUserUnreadStatus(user_id);
        if (cached !== null) return cached;

        const has_unread = await db.notification.count({
            where: { user_id, is_read: false }
        }) > 0;

        await setUserUnreadStatus(user_id, has_unread);
        return has_unread;
    }

    async mark_all_read(user_id: string): Promise<number> {
        const { count } = await db.notification.updateMany({
            where: { user_id, is_read: false },
            data: { is_read: true, readAt: new Date() }
        });

        await setUserUnreadStatus(user_id, false);

        logger.info(`Marked ${count} notifications as read for User ID: ${user_id}`);
        return count;
    }

    async mark_notification_read(user_id: string, notification_id: string) {
        const { count } = await db.notification.updateMany({
            where: { id: notification_id, user_id, is_read: false },
            data: { is_read: true, readAt: new Date() }
        });

        if (count === 0) return false;

        const still_unread = await db.notification.count({
            where: { user_id, is_read: false }
        }) > 0;
        await setUserUnreadStatus(user_id, still_unread);

        return true;
    }
}

export const notification_service = new NotificationServiceClass();
