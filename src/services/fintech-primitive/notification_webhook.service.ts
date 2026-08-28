import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

/**
 * FP notification webhooks - /v2/notification_webhooks.
 *
 * FP registers ONE webhook row per event type, not per resource: `event` is a mandatory,
 * singular string on the create call. Subscribing to the six MF resources therefore means
 * ~29 separate registrations, which is why FP_WEBHOOK_EVENTS below is a flat list and
 * register_all() loops it.
 *
 * There is no signing secret anywhere in this API - not as a create param, not in the response.
 * FP delivers unsigned JSON from a plain axios client, so authenticity comes from the
 * unguessable callback URL plus the fetch-back in fp-webhook-event.service.ts, never from the
 * payload itself.
 */

export type FpWebhookStatus = "enabled" | "disabled";

export interface FpNotificationWebhook {
    object: "notification_webhook";
    id: string;
    event: string;
    url: string;
    status: FpWebhookStatus;
}

/**
 * Every event WHK-1..WHK-6 need. Sourced from Todo.md's per-ticket event lists; the plan
 * resources share one lifecycle (created/activated/cancelled/failed) while the one-shot
 * orders carry the fuller settlement lifecycle.
 */
export const FP_WEBHOOK_EVENTS = [
    // WHK-1 - mf_purchase
    "mf_purchase.created",
    "mf_purchase.confirmed",
    "mf_purchase.submitted",
    "mf_purchase.successful",
    "mf_purchase.failed",
    "mf_purchase.reversed",

    // WHK-2 - mf_redemption
    "mf_redemption.created",
    "mf_redemption.confirmed",
    "mf_redemption.submitted",
    "mf_redemption.successful",
    "mf_redemption.cancelled",
    "mf_redemption.reversed",

    // WHK-3 - mf_switch
    "mf_switch.created",
    "mf_switch.confirmed",
    "mf_switch.submitted",
    "mf_switch.successful",
    "mf_switch.failed",

    // WHK-4 - mf_purchase_plan
    "mf_purchase_plan.created",
    "mf_purchase_plan.activated",
    "mf_purchase_plan.cancelled",
    "mf_purchase_plan.failed",

    // WHK-5 - mf_redemption_plan
    "mf_redemption_plan.created",
    "mf_redemption_plan.activated",
    "mf_redemption_plan.cancelled",
    "mf_redemption_plan.failed",

    // WHK-6 - mf_switch_plan
    "mf_switch_plan.created",
    "mf_switch_plan.activated",
    "mf_switch_plan.cancelled",
    "mf_switch_plan.failed",
] as const;

class FintechPrimitiveNotificationWebhookServiceClass {

    private base_url: string;

    constructor() {
        this.base_url = env.FINTECH_PRIMITIVE_API_BASE_URL;
    }

    private async auth_headers(extra: Record<string, string> = {}) {
        const token = await provider_token_service.get_fintech_primitive_token();

        return {
            Authorization: `Bearer ${token}`,
            "x-tenant-id": env.FINTECH_PRIMITIVE_TENANT_ID,
            ...extra,
        };
    }

    /** POST /v2/notification_webhooks - one call per event type. */
    create_webhook = async (url: string, event: string, status: FpWebhookStatus = "enabled") => {
        logger.debug("Registering FP notification webhook", { event, status });

        try {
            const response = await axios.post(
                `${this.base_url}/v2/notification_webhooks`,
                { url, event, status },
                { headers: await this.auth_headers() },
            );

            return response.data as FpNotificationWebhook;
        } catch (error: any) {
            logger.error("Error registering FP notification webhook ==> ", error?.response?.data || error.message);
            throw new AppError(
                "Failed to register FP notification webhook",
                502,
                "FP_WEBHOOK_REGISTER_FAILED",
                { event },
            );
        }
    }

    /** GET /v2/notification_webhooks - `event` narrows the list, omit it for everything. */
    list_webhooks = async (event?: string) => {
        try {
            const response = await axios.get(`${this.base_url}/v2/notification_webhooks`, {
                headers: await this.auth_headers(),
                params: event ? { event } : undefined,
            });

            return (response.data?.data ?? []) as FpNotificationWebhook[];
        } catch (error: any) {
            logger.error("Error listing FP notification webhooks ==> ", error?.response?.data || error.message);
            throw new AppError(
                "Failed to list FP notification webhooks",
                502,
                "FP_WEBHOOK_LIST_FAILED",
            );
        }
    }

    /**
     * Registers every event in FP_WEBHOOK_EVENTS that isn't already pointing at `callback_url`.
     * Idempotent by design - re-running after adding an event to the list only registers the gap,
     * so this is safe to call again on redeploy or when the callback URL rotates.
     *
     * Failures are collected rather than thrown: one rejected event shouldn't abandon the other
     * 28. The caller gets a per-event breakdown to act on.
     */
    register_all = async (callback_url: string) => {
        const existing = await this.list_webhooks();

        const already_registered = new Set(
            existing
                .filter((hook) => hook.url === callback_url && hook.status === "enabled")
                .map((hook) => hook.event),
        );

        const registered: string[] = [];
        const skipped: string[] = [];
        const failed: { event: string; reason: string }[] = [];

        for (const event of FP_WEBHOOK_EVENTS) {
            if (already_registered.has(event)) {
                skipped.push(event);
                continue;
            }

            try {
                await this.create_webhook(callback_url, event);
                registered.push(event);
            } catch (error: any) {
                failed.push({ event, reason: error?.message ?? "unknown" });
            }
        }

        logger.info("FP webhook registration complete", {
            registered: registered.length,
            skipped: skipped.length,
            failed: failed.length,
        });

        return { registered, skipped, failed, total: FP_WEBHOOK_EVENTS.length };
    }
}

export const fintech_primitive_notification_webhook_service =
    new FintechPrimitiveNotificationWebhookServiceClass();
