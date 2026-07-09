import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { notification_producer_service } from "../services/notification.producer.service.js";
import { nse_mfdesk_service } from "../services/nse-mfdesk.service.js";

class TestControllerClass {

    send_test_notification = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!
            const { type, title, body, payload } = req.body;

            if (!type || !title || !body) {
                throw new AppError("type, title and body are required", 400, "MISSING_FIELDS");
            }

            logger.info(`Publishing test notification event for user: ${user.id}`);

            const published = await notification_producer_service.publish_notification_event(
                user.id,
                type,
                title,
                body,
                payload
            );

            if (!published) {
                throw new AppError("Failed to publish notification event", 500, "NOTIFICATION_PUBLISH_FAILED");
            }

            res.status(200).json({
                success: true,
                message: "Test notification event published successfully"
            });
            return;

        } catch (error: any) {
            logger.error("Error while sending test notification ==> ", error.message);
            next(error);
            return;
        }
    }

    test_nse_client_kyc_report = async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.debug("Checking client kyc report....")
            const { pan_no, client_code, from_date, to_date } = req.body;

            logger.debug(`Pan number : ${pan_no} client_code : ${client_code} | from_date : ${from_date} | to_date : ${to_date}`)

            if (!pan_no && !client_code) {
                throw new AppError(
                    "Either pan_no, client_code, or both from_date and to_date are required",
                    400,
                    "MISSING_FIELDS"
                );
            }

            const data = await nse_mfdesk_service.get_client_kyc_status_report({
                pan_no,
                client_code,
                from_date,
                to_date
            });

            res.status(200).json({
                success: true,
                data
            });
            return;

        } catch (error: any) {
            logger.error("Error while fetching NSE client KYC status report ==> ", error.message);
            next(error);
            return;
        }
    }
}

export const test_controller = new TestControllerClass();
