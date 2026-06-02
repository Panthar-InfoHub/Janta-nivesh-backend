import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { TransactionStatus } from "../prisma/generated/prisma/enums.js";
import { FdTransactionUpdateInput } from "../prisma/generated/prisma/models.js";
import { fd_transaction_service } from "../services/fd.transaction.service.js";
import { zoho_webhook_service } from "../services/zoho.webhook.service.js";

export const handleFdWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Blostem sends jid at the top level 
        const { event, jid, data } = req.body;

        logger.info(`Received Webhook: ${event} with jid: ${jid}`);

        if (!jid) {
            logger.warn("Webhook missing jid (our transactionId), cannot process.");
            throw new AppError("Invalid payload: missing jid", 400, "MISSING_JID");
        }

        let status_to_update: TransactionStatus | undefined;
        let update_data: FdTransactionUpdateInput = {};

        // Event left : FD_Update, REFUND

        switch (event) {
            case "SSO": // Initial confirmation of user journey 
            case "ONBOARDING": // Triggered during onboarding steps
                status_to_update = TransactionStatus.ONBOARDING_COMPLETED;
                update_data.onboarded_at = new Date();
                // Check if it's a Bank to flag VKYC requirement
                if (req.body.type === 'BANK') {
                    update_data.is_vkyc_required = true;
                }
                break;

            case "PAYMENT": // Triggered for initiated/success events 
                if (data.isPaymentCompleted === true) {
                    status_to_update = TransactionStatus.PAYMENT_SUCCESS;
                    update_data.payment_completed_at = new Date();
                    update_data.is_vkyc_initiated = false; // Reset to move to next step
                }
                    // Handling Payment Initiated status
                else if (data.isPaymentInitiated === true) {
                    status_to_update = TransactionStatus.PAYMENT_PENDING;
                    update_data.is_vkyc_initiated = false;
                }

                // Capture ROI and Tenure regardless of success/initiated for record keeping
                update_data.amount = parseFloat(data.amount);
                update_data.roi_at_booking = parseFloat(data.roi);
                update_data.tenure_at_booking = data.tenure;
                update_data.payment_tx_id = data.paymentTxId;


                if (data.isVkycRequired === false) {
                    update_data.is_vkyc_required = false;
                    update_data.is_vkyc_pending = false;
                }
                break
            case "PAYMENT_FAILED": // Explicit event for failures
                status_to_update = TransactionStatus.PAYMENT_FAILED;
                update_data.failure_reason = data.reason; // "Transaction failed due to customer pressing cancel" 
                update_data.payment_tx_id = data.paymentTxId;

                await zoho_webhook_service.send_event({
                    event_type: "FD_BOOKING_FAILED",
                    timestamp: new Date().toISOString(),
                    fd_transaction_id: jid,
                    failure_reason: data.reason || "Payment failed",
                    payment_tx_id: data.paymentTxId
                });
                break;

            case "VKYC":
                // Checking nested flags: isVkycCompleted, isVkycInitiated, isVkycPending
                if (data.isVkycCompleted === true) {
                    status_to_update = TransactionStatus.VKYC_COMPLETED;
                    update_data.vkyc_completed_at = new Date();
                    update_data.is_vkyc_pending = false;
                } else if (data.isVkycPending === true) {
                    status_to_update = TransactionStatus.VKYC_PENDING;
                    update_data.is_vkyc_pending = true;
                    update_data.is_vkyc_initiated = false;
                } else if (data.isVkycInitiated === true) {
                    // User has started VKYC but not finished 
                    update_data.is_vkyc_initiated = true;
                    update_data.is_vkyc_pending = false;
                }
                break;
            case "VKYC_FAILED":
                status_to_update = TransactionStatus.VKYC_FAILED;
                update_data.vkyc_failure_reason = data.VkycFailureReason; // e.g. "Pan not clear" 
                update_data.vkyc_failed_by = data.VkycFailedBy; // AGENT or AUDITOR

                update_data.failure_reason = `VKYC Failed by ${data.VkycFailedBy}: ${data.VkycFailureReason}`;
                break;


            case "REFUND":
                status_to_update = TransactionStatus.REFUNDED;
                update_data.refund_date = new Date(data.refundDate); //
                update_data.failure_reason = "VKYC timeout (72 hours)"; // 
                break;


            case "FD_CREATED":
                status_to_update = TransactionStatus.FD_CREATED;
                update_data.fd_issued_at = new Date(req.body.createdAt);
                // Normalize: NBFC uses data.id/applicationId, Bank uses data.accountNumber
                update_data.fd_account_number =
                    data.accountNumber ||  // Best: The actual FD account number
                    data.id ||             // Second best: The unique deposit ID
                    data.applicationId ||  // Third: The application reference
                    jid;                   // Fallback: Our own transaction ID
                update_data.maturity_amount = parseFloat(data.maturityAmount);
                update_data.maturity_date = new Date(data.maturityDate);
                update_data.is_vkyc_pending = false;
                update_data.maturity_instruction = data.maturityInstructions || data.maturity_instruction;

                await zoho_webhook_service.send_event({
                    event_type: "FD_BOOKING_SUCCESSFUL",
                    timestamp: new Date().toISOString(),
                    fd_transaction_id: jid,
                    fd_account_number: data.accountNumber || data.id,
                    maturity_amount: Number(data.maturityAmount),
                    maturity_date: data.maturityDate,
                    maturity_instruction: data.maturityInstructions || data.maturity_instruction,
                    fd_issued_at: req.body.createdAt
                });
                break;

            case "MATURITY_INSTRUCTION_UPDATED":
                // No status change, just update the instruction field
                update_data.maturity_instruction = data.updatedInstruction;
                break;

            case "PREMATURE_WITHDRAW":
                status_to_update = TransactionStatus.PREMATURE_WITHDRAWN;
                // Capture how much they actually got back after penalties
                update_data.maturity_amount = parseFloat(data.withdrawalAmount);
                break;

            case "MATURITY":
                status_to_update = TransactionStatus.MATURED;
                break;

            case "REINVEST":
                // Logic: Mark current as MATURED, and then trigger your service 
                // to create a NEW transaction record for the next cycle.
                status_to_update = TransactionStatus.MATURED;
                break;



            default:
                logger.info(`Event ${event} not handled in success flow yet.`);
        }

        if (status_to_update) {
            // Your service call here to persist the update_data using 'jid' as the 'id'
            await fd_transaction_service.update_status_and_details(jid, status_to_update, update_data);
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error("Webhook Processing Error:", error);
        next(error);
    }
};
