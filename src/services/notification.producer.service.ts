import { PubSub } from "@google-cloud/pubsub";
import logger from "../middleware/logger.js";
import { redis } from "../lib/redis.js";
import { env } from "../lib/config-env.js";
import { NotificationPayload } from "../lib/types.js";

const unread_key = (user_id: string) => `${env.ENVIRONMENT}:user:noti:unread:${user_id}`;

/**
 * Sets the unread notification flag in Redis for O(1) "red dot" checks.
 * @param userId The User ID
 * @param hasUnread Boolean flag
 */
export async function setUserUnreadStatus(userId: string, hasUnread: boolean): Promise<void> {
    await redis.set(unread_key(userId), String(hasUnread), {
        EX: 86400 // Expire in 24 hours, DB is the source of truth on a cache miss
    });
}

/**
 * Reads the cached unread flag. Returns null on a cache miss so the caller can fall back to the DB.
 * @param userId The User ID
 */
export async function getUserUnreadStatus(userId: string): Promise<boolean | null> {
    const value = await redis.get(unread_key(userId));
    if (value === null) return null;
    return value === "true";
}

class NotificationProducerService {
    private pub_sub_client: PubSub | null = null;
    private topic_name = process.env.PUBSUB_TOPIC || "notification-events";

    constructor() {
        try {
            this.pub_sub_client = new PubSub({
                projectId: process.env.GOOGLE_CLOUD_PROJECT,
                credentials: process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY ? {
                    client_email: process.env.GCP_CLIENT_EMAIL,
                    private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/g, "\n"),
                } : undefined
            });
            logger.info("Notification Pub/Sub client initialized.");
        } catch (error) {
            logger.error("Failed to initialize Pub/Sub Client. Notification sending will fail.", error);
        }
    }

    /**
     * Publishes a notification event to the GCP Pub/Sub topic.
     * 
     * @param userId The ID of the target user
     * @param type The type of notification (e.g. TRANSACTION, SECURITY, etc.)
     * @param title The title of the notification
     * @param body The body of the notification
     * @param payload Optional custom JSON payload metadata (deep links, IDs, etc.)
     */
    async publish_notification_event(
        userId: string,
        type: string,
        title: string,
        body: string,
        payload?: NotificationPayload
    ): Promise<boolean> {
        if (!this.pub_sub_client) {
            logger.warn("Pub/Sub client not initialized. Cannot publish event.");
            return false;
        }

        try {
            const data_buffer = Buffer.from(
                JSON.stringify({
                    user_id: userId,
                    type,
                    title,
                    body,
                    payload: payload || {},
                    timestamp: new Date().toISOString(),
                })
            );

            const messageId = await this.pub_sub_client
                .topic(this.topic_name)
                .publishMessage({ data: data_buffer });

            logger.info(`Notification event published to topic ${this.topic_name} with Message ID: ${messageId}`);

            // Best-effort: flip the red-dot on immediately rather than waiting on the
            // downstream consumer to persist the Notification row.
            setUserUnreadStatus(userId, true).catch((error) =>
                logger.error(`Failed to set unread flag for User ID: ${userId}`, error)
            );

            return true;
        } catch (error) {
            logger.error("Error publishing notification event to Pub/Sub:", error);
            return false;
        }
    }
}

export const notification_producer_service = new NotificationProducerService();
