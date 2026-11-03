import { PostHog } from "posthog-node";
import logger from "../middleware/logger.js";
import { env } from "./config-env.js";

const client = env.POSTHOG_API_KEY
    ? new PostHog(env.POSTHOG_API_KEY, {
        host: env.POSTHOG_HOST || "https://us.i.posthog.com",
        enableExceptionAutocapture: true,
    })
    : null;

if (client) {
    logger.info(`PostHog analytics enabled (host: ${env.POSTHOG_HOST || "https://us.i.posthog.com"})`);
} else {
    logger.warn("POSTHOG_API_KEY not set — analytics/exception-capture/feature-flags disabled");
}

// Global tags automatically attached to every event and exception
const default_properties: Record<string, unknown> = {
    app: "velvet-backend",
    environment: env.ENVIRONMENT || "development",
};

export const capture_event = (
    distinctId: string,
    event: string,
    properties?: Record<string, unknown>
) => {
    client?.capture({
        distinctId,
        event,
        properties: {
            ...default_properties,
            ...properties,
        },
    });
};

export const capture_exception = (
    error: unknown,
    distinctId?: string,
    properties?: Record<string, unknown>
) => {
    client?.captureException(error, distinctId, {
        ...default_properties,
        ...properties,
    });
};

export const is_feature_enabled = async (
    key: string,
    distinctId: string
): Promise<boolean> => {
    if (!client) return false;
    const flags = await client.evaluateFlags(distinctId);
    return flags.isEnabled(key) ?? false;
};

export const shutdown_posthog = async () => {
    try {
        await client?.shutdown();
        logger.info("PostHog client shut down and flushed successfully");
    } catch (err) {
        logger.error("Error shutting down PostHog client:", err);
    }
};
