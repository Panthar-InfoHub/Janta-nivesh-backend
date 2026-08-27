import { Router } from "express";
import { handleMfPurchaseWebhook } from "../../controller/webhooks/mf_purchase.webhook.controller.js";
import { verify_fp_webhook_signature } from "../../middleware/fp-webhook.middleware.js";

export const mf_purchase_webhook_router = Router();

mf_purchase_webhook_router.post("/", verify_fp_webhook_signature, handleMfPurchaseWebhook);
