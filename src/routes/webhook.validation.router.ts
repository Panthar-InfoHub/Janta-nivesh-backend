import { Router } from "express";
import { validateFdWebhook, receiveFdWebhookCallback } from "../controller/webhook.validation.controller.js";

export const webhook_router = Router();

webhook_router.post("/validate", validateFdWebhook);
webhook_router.post("/receive", receiveFdWebhookCallback);
