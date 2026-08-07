import { Router } from "express";
import { handleMandateWebhook } from "../../controller/webhooks/mandate.webhook.controller.js";

export const mandate_webhook_router = Router();

mandate_webhook_router.post("/", handleMandateWebhook);
