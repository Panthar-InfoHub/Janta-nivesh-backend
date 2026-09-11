import { Request, Response, NextFunction } from "express";
import logger from "../../middleware/logger.js";
import { fp_webhook_event_service } from "../../services/webhooks/fp-webhook-event.service.js";
import { mf_transaction_plan_service } from "../../services/mf-transaction-plan.service.js";

/**
 * Single entry point for every FP notification webhook.
 *
 * One endpoint rather than one per resource: the envelope is self-describing (`type` is
 * `<resource>.<event>` and `data.object.object` names the resource), so dispatching here beats
 * six near-identical routes. Todo.md's WHK-1..WHK-6 describe a route per resource - this is a
 * deliberate departure, and it's why those tickets only need a handler each.
 *
 * Deliberately NOT modelled on mandate.webhook.controller.ts, which trusts its payload and is
 * a browser-mediated redirect POST rather than a server-to-server webhook.
 *
 * Order matters here:
 *   1. parse  - shape check on the routing fields only
 *   2. claim  - dedup, because FP retries anything that isn't 200
 *   3. fetch  - re-read the object from FP; THIS is the authenticity check
 *   4. dispatch - WHK-1..WHK-6 persist the trusted object
 */
export const handleFpWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    let event_id: string | undefined;

    try {
        const event = fp_webhook_event_service.parse_event(req.body);
        event_id = event.id;

        const object_type = event.data.object.object;
        const fp_id = event.data.object.id;

        logger.info("Received FP webhook", {
            event_id: event.id,
            event_type: event.type,
            event_time: event.time,
            object_type,
            fp_id,
        });

        // Dedup before any work. A retry of an already-applied event must not re-apply it.
        const claimed = await fp_webhook_event_service.claim_event(event.id);

        if (!claimed) {
            logger.info("Duplicate FP webhook ignored", { event_id: event.id, event_type: event.type });

            // 200, not 4xx - FP should stop retrying something we've already handled.
            res.status(200).json({ success: true, duplicate: true });
            return;
        }

        // The payload is a hint. Re-read the object from FP over our own authenticated client
        // and treat THAT as authoritative - a forged POST buys nothing but this wasted call.
        const trusted_object = await fp_webhook_event_service.fetch_trusted_object(object_type, fp_id);

        if (!trusted_object) {
            // No fetcher yet for this resource (mf_switch until OPS-5 lands). Ack so FP stops
            // retrying, and leave the claim in place - there's no handler to run later anyway.
            logger.warn("FP webhook acknowledged without processing - no fetcher", {
                event_id: event.id,
                object_type,
            });

            res.status(200).json({ success: true, processed: false });
            return;
        }

        logger.debug("Fetched trusted FP object for webhook", {
            event_id: event.id,
            object_type,
            state: trusted_object?.state,
        });

        if (object_type === "mf_purchase") {
            await mf_transaction_plan_service.sync_purchase_from_webhook(
                trusted_object
            );
        }
        // WHK-1..WHK-6: dispatch on `object_type` and persist `trusted_object` via
        // mf_transaction_plan_service.upsert_from_fp. Intentionally a no-op in WHK-0 - this
        // ticket is the shared plumbing, the per-resource handlers are their own tickets.
        //
        // NOTE for WHK-1/WHK-4: a SIP installment is its own mf_purchase whose `plan` field
        // holds the parent mfpp_ id. There is no MfTransactionPlan row per installment, so
        // persisting them needs the installments child table first - see CONTEXT.md section 9.


        if (object_type === "mf_redemption") {
            const allowed_events = new Set([
                "mf_redemption.created",
                "mf_redemption.confirmed",
                "mf_redemption.submitted",
                "mf_redemption.successful",
                "mf_redemption.cancelled",
                "mf_redemption.reversed",
            ]);

            if (!allowed_events.has(event.type)) {
                logger.warn("Unsupported MF redemption webhook event", {
                    event_id: event.id,
                    event_type: event.type,
                    fp_id,
                });

                res.status(200).json({
                    success: true,
                    processed: false,
                    unsupported_event: true,
                });

                return;
            }

            const updated =
                await mf_transaction_plan_service.sync_redemption_from_webhook(
                    trusted_object,
                );

            logger.info("MF redemption webhook processed successfully", {
                event_id: event.id,
                event_type: event.type,
                fp_id: updated.fp_id,
                state: updated.state,
            });

            res.status(200).json({
                success: true,
                processed: true,
                data: {
                    fp_id: updated.fp_id,
                    state: updated.state,
                },
            });

            return;
        }


        res.status(200).json({ success: true, processed: false });
        return;
    } catch (error) {
        // Release the claim so FP's retry gets a real attempt - otherwise a transient failure
        // would permanently swallow the event.
        if (event_id) {
            await fp_webhook_event_service.release_event(event_id);
        }

        logger.error("FP Webhook Processing Error:", error);

        next(error);
        return;
    }
};
