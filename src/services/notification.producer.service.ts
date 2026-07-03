import { PubSub } from "@google-cloud/pubsub";
import logger from "../middleware/logger.js";

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
        payload?: any
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
            return true;
        } catch (error) {
            logger.error("Error publishing notification event to Pub/Sub:", error);
            return false;
        }
    }
}

export const notification_producer_service = new NotificationProducerService();
