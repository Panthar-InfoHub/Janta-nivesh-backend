import { Router } from "express";
import { handleKycWebhook } from "../../controller/webhooks/kyc.webhook.controller.js";

export const kyc_webhook_router = Router();

kyc_webhook_router.post("/", handleKycWebhook);
