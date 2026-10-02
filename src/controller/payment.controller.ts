import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { fintech_primitive_payment_service } from "../services/fintech-primitive/payment.service.js";

class PaymentControllerClass {
    /**
     * GET /api/v2/payment/:id
     * Returns payment status and details for given payment ID.
     */
    get_payment_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const payment_id = req.params.id as string;

            if (!payment_id) {
                throw new AppError("Payment ID is required", 400, "PAYMENT_ID_REQUIRED");
            }

            logger.info("Fetching payment status", { payment_id });
            const result = await fintech_primitive_payment_service.fetch_payment(payment_id);

            res.status(200).json({
                success: true,
                message: "Payment status fetched successfully",
                data: result,
            });
            return;
        } catch (error) {
            logger.error("Error in get_payment_status controller:", error);
            next(error);
            return;
        }
    };
}

export const payment_controller = new PaymentControllerClass();
