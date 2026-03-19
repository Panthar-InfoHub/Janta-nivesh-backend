import { Request, Response, NextFunction } from "express";
import logger from "../middleware/logger.js";
import { TransactionStatus } from "../prisma/generated/prisma/enums.js";
import AppError from "../middleware/error.middleware.js";

export const handleFdWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Blostem sends jid at the top level 
        const { event, jid, data } = req.body;

        logger.info(`Received Webhook: ${event} with jid: ${jid}`);

        if (!jid) {
            logger.warn("Webhook missing jid (our transactionId), cannot process.");
            throw new AppError("Invalid payload: missing jid", 400, "MISSING_JID");
        }

        let statusToUpdate: TransactionStatus | undefined;
        let updateData: any = {};

        switch (event) {
            case "SSO": // Initial confirmation of user journey 
            case "ONBOARDING": // Triggered during onboarding steps
                statusToUpdate = TransactionStatus.ONBOARDING_COMPLETED;
                updateData.onboarded_at = new Date();
                // Check if it's a Bank to flag VKYC requirement
                if (req.body.type === 'BANK') {
                    updateData.is_vkyc_required = true;
                }
                break;

            case "PAYMENT": // Triggered for initiated/success events 
                if (data.isPaymentCompleted === true) {
                    statusToUpdate = TransactionStatus.PAYMENT_SUCCESS;
                    updateData.payment_completed_at = new Date();
                    updateData.is_vkyc_initiated = false; // Reset to move to next step
                }
                // Handling Payment Initiated status [cite: 202, 257]
                else if (data.isPaymentInitiated === true) {
                    statusToUpdate = TransactionStatus.PAYMENT_PENDING;
                    updateData.is_vkyc_initiated = false;
                }

                // Capture ROI and Tenure regardless of success/initiated for record keeping
                updateData.roi_at_booking = parseFloat(data.roi);
                updateData.tenure_at_booking = data.tenure;
                updateData.payment_tx_id = data.paymentTxId;
                break
            case "PAYMENT_FAILED": // Explicit event for failures
                statusToUpdate = TransactionStatus.PAYMENT_FAILED;
                updateData.failure_reason = data.reason; // "Transaction failed due to customer pressing cancel" 
                updateData.payment_tx_id = data.paymentTxId;
                break;

            case "VKYC":
                // Checking nested flags: isVkycCompleted, isVkycInitiated, isVkycPending
                if (data.isVkycCompleted === true) {
                    statusToUpdate = TransactionStatus.VKYC_COMPLETED;
                    updateData.vkyc_completed_at = new Date();
                    updateData.is_vkyc_pending = false;
                } else if (data.isVkycPending === true) {
                    statusToUpdate = TransactionStatus.VKYC_PENDING;
                    updateData.is_vkyc_pending = true;
                    updateData.is_vkyc_initiated = false;
                } else if (data.isVkycInitiated === true) {
                    // User has started VKYC but not finished [cite: 306]
                    updateData.is_vkyc_initiated = true;
                    updateData.is_vkyc_pending = false;
                }
                break;

            case "FD_CREATED": // Final success event
                statusToUpdate = TransactionStatus.FD_CREATED;
                updateData.fd_issued_at = new Date();
                // Use accountNumber if bank, or the id for NBFC
                updateData.fd_account_number = data.accountNumber || data.id;
                updateData.maturity_amount = parseFloat(data.maturityAmount); // 
                updateData.maturity_date = new Date(data.maturityDate); // 
                break;

            default:
                logger.info(`Event ${event} not handled in success flow yet.`);
        }

        if (statusToUpdate) {
            // Your service call here to persist the updateData using 'jid' as the 'id'
            // await fd_transaction_service.updateStatus(jid, statusToUpdate, updateData);
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error("Webhook Processing Error:", error);
        next(error);
    }
};
