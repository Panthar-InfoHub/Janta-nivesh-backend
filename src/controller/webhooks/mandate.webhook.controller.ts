import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { mandate_service } from "../../services/mandate.service.js";

/**
 * FP e-mandate authorization outcome - delivered as a form-encoded (not JSON) HTTP POST "via
 * web browser" to a preconfigured tenant URL (per the "Authorize a mandate" docs - this is a
 * browser-mediated redirect-POST, not necessarily a true server-to-server webhook - worth
 * confirming with FP/Cybrilla support if there's also a real webhook for this event, since a
 * browser-mediated POST is lost if the user closes the tab/app before the redirect completes).
 * Matched to our Mandate row via fp_payment_id (the `id` returned from the authorize call,
 * distinct from mandate_id).
 */
export const handleMandateWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { paymentId, status, failureReason } = req.body;

        logger.info(`Received mandate webhook for paymentId: ${paymentId}, status: ${status}`);

        if (!paymentId) {
            logger.warn("Mandate webhook missing paymentId, cannot process.");
            throw new AppError("Invalid payload: missing paymentId", 400, "MISSING_PAYMENT_ID");
        }

        const mandate = await mandate_service.get_by_fp_payment_id(String(paymentId));
        if (!mandate) {
            logger.warn(`No mandate found for fp_payment_id: ${paymentId}`);
            throw new AppError("Mandate not found for paymentId", 404, "MANDATE_NOT_FOUND");
        }

        await mandate_service.update(mandate.id, {
            status: status === "success" ? "SUCCESS" : "FAILED",
            failure_reason: failureReason || null,
        });

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error("Mandate Webhook Processing Error:", error);
        next(error);
    }
};
