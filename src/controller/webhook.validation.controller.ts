import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { fd_transaction_service } from "../services/fd.transaction.service.js";
import { zoho_webhook_service } from "../services/zoho.webhook.service.js";

export const validateFdWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { jid, event } = req.body;

        logger.info(`Validating webhook: jid=${jid}, event=${event}`);

        if (!jid || !event) {
            throw new AppError("Missing jid or event", 400, "MISSING_REQUIRED_FIELDS");
        }

        const transaction = await fd_transaction_service.get_transaction_by_id(jid);

        if (!transaction) {
            logger.warn(`Transaction ${jid} not found`);
            return res.status(200).json({ success: false });
        }

        logger.info(`Transaction ${jid} validated successfully`);

        res.status(200).json({
            success: true,
            return_url: `${process.env.VELVET_WEBHOOK_CALLBACK_URL || "http://localhost:3000"}/api/v1/fd/webhook/receive`,
            project_id: "FD",
        });
        return;
    } catch (error) {
        logger.error("Error in validateFdWebhook: ", error);
        next(error);
    }
};

export const receiveFdWebhookCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { jid, event, status, update_data } = req.body;

        logger.info(`Receiving webhook callback: jid=${jid}, event=${event}, status=${status}`);

        if (!jid || !update_data) {
            throw new AppError("Missing required webhook callback fields", 400, "INVALID_CALLBACK_PAYLOAD");
        }

        // Only persist if a status transition is present
        if (status) {
            await fd_transaction_service.update_status_and_details(jid, status, update_data);
            logger.info(`Transaction ${jid} updated to status=${status}`);
        }

        // Zoho side-effects that live in Velvet (central_server is stateless)
        if (event === "PAYMENT_FAILED") {
            await zoho_webhook_service.send_event({
                event_type: "FD_BOOKING_FAILED",
                timestamp: new Date().toISOString(),
                fd_transaction_id: jid,
                failure_reason: update_data.failure_reason || "Payment failed",
                payment_tx_id: update_data.payment_tx_id,
            });
        } else if (event === "FD_CREATED") {
            await zoho_webhook_service.send_event({
                event_type: "FD_BOOKING_SUCCESSFUL",
                timestamp: new Date().toISOString(),
                fd_transaction_id: jid,
                fd_account_number: update_data.fd_account_number,
                maturity_amount: Number(update_data.maturity_amount),
                maturity_date: update_data.maturity_date,
                maturity_instruction: update_data.maturity_instruction,
                fd_issued_at: update_data.fd_issued_at,
            });
        }

        res.status(200).json({ success: true });
        return;
    } catch (error) {
        logger.error("Error in receiveFdWebhookCallback: ", error);
        next(error);
    }
};
