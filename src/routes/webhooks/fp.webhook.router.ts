import { Router } from "express";
import { handleFpWebhook } from "../../controller/webhooks/fp.webhook.controller.js";

/**
 * No verification middleware in front of this route - FP sends no signature (confirmed against
 * a real delivery's headers: content-type, user-agent, Sentry trace headers, x-forwarded-*, and
 * nothing else) and /v2/notification_webhooks issues no signing secret to check one against.
 *
 * Security instead lives in fp-webhook-event.service.ts: the POST body is never trusted for its
 * values, only for routing (which object to re-fetch). A forged delivery can make us call FP's
 * API once; it cannot make us persist anything, because what gets persisted is always re-read
 * from FP over our own authenticated client.
 */
export const fp_webhook_router = Router();

fp_webhook_router.post("/", handleFpWebhook);
