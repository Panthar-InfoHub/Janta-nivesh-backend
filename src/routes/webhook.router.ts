import { Router } from "express";
import { handleFdWebhook } from "../controller/webhook.controller.js";

export const webhook_router = Router();

webhook_router.post("/fd", handleFdWebhook);
