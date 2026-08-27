import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { mf_transaction_plan_service } from "../../services/mf-transaction-plan.service.js";

const MF_PURCHASE_WEBHOOK_EVENTS = new Set([
    "mf_purchase.created",
    "mf_purchase.confirmed",
    "mf_purchase.submitted",
    "mf_purchase.successful",
    "mf_purchase.failed",
    "mf_purchase.reversed",
]);

type MfPurchaseWebhookEvent = {
    id?: string;
    object?: string;
    type?: string;
    time?: string;
    data?: {
        object?: {
            object?: string;
            id?: string;
            state?: string;
            [key: string]: unknown;
        };
        previous_attributes?: unknown;
    };
};

export const handleMfPurchaseWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const event = req.body as MfPurchaseWebhookEvent;

        logger.info("Received verified MF purchase webhook", {
            event_id: event?.id,
            event_type: event?.type,
            event_time: event?.time,
        });

        if (event?.object !== "event") {
            throw new AppError(
                "Invalid FP webhook object",
                400,
                "MF_PURCHASE_WEBHOOK_INVALID_OBJECT",
            );
        }

        if (
            !event.type ||
            !MF_PURCHASE_WEBHOOK_EVENTS.has(event.type)
        ) {
            throw new AppError(
                `Unsupported MF purchase webhook event: ${event.type ?? "unknown"}`,
                400,
                "MF_PURCHASE_WEBHOOK_EVENT_UNSUPPORTED",
            );
        }

        const purchase = event.data?.object;

        if (!purchase) {
            throw new AppError(
                "MF purchase webhook is missing event data",
                400,
                "MF_PURCHASE_WEBHOOK_DATA_MISSING",
            );
        }

        if (purchase.object !== "mf_purchase") {
            throw new AppError(
                "Webhook data object is not an MF purchase",
                400,
                "MF_PURCHASE_WEBHOOK_RESOURCE_INVALID",
            );
        }

        if (!purchase.id) {
            throw new AppError(
                "MF purchase webhook is missing purchase id",
                400,
                "MF_PURCHASE_WEBHOOK_ID_MISSING",
            );
        }

        if (!purchase.state) {
            throw new AppError(
                "MF purchase webhook is missing purchase state",
                400,
                "MF_PURCHASE_WEBHOOK_STATE_MISSING",
            );
        }

        const updated =
            await mf_transaction_plan_service.sync_purchase_from_webhook(
                purchase,
            );

        logger.info("MF purchase webhook processed successfully", {
            event_id: event.id,
            event_type: event.type,
            fp_id: updated.fp_id,
            state: updated.state,
        });

        res.status(200).json({
            success: true,
            data: {
                fp_id: updated.fp_id,
                state: updated.state,
            },
        });

        return;
    } catch (error) {
        logger.error("MF purchase webhook processing failed", {
            error,
        });

        next(error);
        return;
    }
};