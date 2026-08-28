import { redis } from "../../lib/redis.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { fintech_primitive_mf_purchase_service } from "../fintech-primitive/mf_purchase.service.js";
import { fintech_primitive_mf_purchase_plan_service } from "../fintech-primitive/mf_purchase_plan.service.js";
import { fintech_primitive_mf_redemption_service } from "../fintech-primitive/mf_redemption.service.js";
import { fintech_primitive_mf_redemption_plan_service } from "../fintech-primitive/mf_redemption_plan.service.js";
import { fintech_primitive_mf_switch_plan_service } from "../fintech-primitive/mf_switch_plan.service.js";

/**
 * Shared plumbing every WHK-1..WHK-6 handler sits on.
 *
 * FP sends unsigned JSON - the header dump on a real delivery carried no signature, no HMAC and
 * no auth header, and /v2/notification_webhooks has no secret parameter to sign with. So the
 * inbound payload is treated as an untrusted *hint*: it tells us which object changed, and we
 * re-fetch that object from FP over our own authenticated client before persisting anything.
 * A forged POST then costs an attacker one wasted API call instead of a corrupted plan row.
 *
 * That costs nothing extra in practice - the handlers have to hand an FP object to
 * `upsert_from_fp` regardless, so this only changes where the object comes from.
 */

/** Stripe-shaped event envelope FP delivers. */
export interface FpWebhookEvent {
    id: string;
    object: "event";
    type: string;
    time: string;
    data: {
        object: Record<string, any> & { object: string; id: string };
        previous_attributes: Record<string, any> | null;
    };
}

/**
 * FP retries any delivery we don't answer 200, so the same event.id arrives more than once.
 * Without this, a retried `.successful` re-applies a state transition that already landed.
 * 24h covers FP's retry window with room to spare; the key is the event id, which is unique
 * per delivery attempt group (not per attempt).
 */
const DEDUP_TTL_SECONDS = 60 * 60 * 24;
const dedup_key = (event_id: string) => `fp_webhook_evt:${event_id}`;

/**
 * Maps `data.object.object` to the FP client that can re-fetch it.
 *
 * mf_switch is deliberately absent: its client lands with OPS-5 (PR #114) and doesn't exist on
 * staging_v2 yet. WHK-3 wires it in - until then a mf_switch.* delivery is acknowledged and
 * logged rather than half-processed.
 */
const FETCHERS: Record<string, (fp_id: string) => Promise<any>> = {
    mf_purchase: (id) => fintech_primitive_mf_purchase_service.get_purchase(id),
    mf_purchase_plan: (id) => fintech_primitive_mf_purchase_plan_service.get_purchase_plan(id),
    mf_redemption: (id) => fintech_primitive_mf_redemption_service.get_redemption(id),
    mf_redemption_plan: (id) => fintech_primitive_mf_redemption_plan_service.get_redemption_plan(id),
    mf_switch_plan: (id) => fintech_primitive_mf_switch_plan_service.get_switch_plan(id),
};

class FpWebhookEventServiceClass {

    /**
     * Marks the event seen and reports whether it already was. SET NX is atomic, so two
     * concurrent deliveries of the same event can't both win.
     */
    claim_event = async (event_id: string): Promise<boolean> => {
        const claimed = await redis.set(dedup_key(event_id), "1", {
            NX: true,
            EX: DEDUP_TTL_SECONDS,
        });

        return claimed === "OK";
    }

    /**
     * Releases a claim so FP's next retry is processed instead of being swallowed as a duplicate.
     * Call this when handling failed *after* the claim was taken - otherwise a transient FP
     * outage would permanently drop the event.
     */
    release_event = async (event_id: string): Promise<void> => {
        try {
            await redis.del(dedup_key(event_id));
        } catch (error) {
            logger.error("Failed to release FP webhook dedup key", { event_id, error });
        }
    }

    /** Shape check only - the payload is never trusted for its values, just its routing fields. */
    parse_event = (body: any): FpWebhookEvent => {
        const object_type = body?.data?.object?.object;
        const fp_id = body?.data?.object?.id;

        if (!body?.id || !body?.type || !object_type || !fp_id) {
            throw new AppError(
                "Malformed FP webhook event",
                400,
                "FP_WEBHOOK_EVENT_MALFORMED",
            );
        }

        return body as FpWebhookEvent;
    }

    /**
     * Re-reads the object from FP by id. This is the verification step - what it returns is
     * authoritative, what arrived in the POST body is not.
     *
     * Returns null for resources we can't fetch yet (see FETCHERS), so the caller can ack the
     * delivery instead of making FP retry something no handler exists for.
     */
    fetch_trusted_object = async (object_type: string, fp_id: string): Promise<any | null> => {
        const fetcher = FETCHERS[object_type];

        if (!fetcher) {
            logger.warn("No FP fetcher registered for webhook object type", { object_type, fp_id });
            return null;
        }

        return fetcher(fp_id);
    }
}

export const fp_webhook_event_service = new FpWebhookEventServiceClass();
