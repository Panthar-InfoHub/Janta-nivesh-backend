import { Router } from "express";
import { handleFpWebhook } from "../../controller/webhooks/fp.webhook.controller.js";
import { verify_fp_webhook_signature } from "../../middleware/fp-webhook.middleware.js";

export const fp_webhook_router = Router();

fp_webhook_router.post("/", verify_fp_webhook_signature, handleFpWebhook);