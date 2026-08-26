import { Request, Response, NextFunction } from "express";
import logger from "../../middleware/logger.js";

export const handleFpWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const event = req.body;

        logger.info("Received verified FP webhook", {
            event_id: event?.id,
            event_type: event?.type,
            event_time: event?.time,
        });

        res.status(200).json({
            success: true,
        });

        return;
    } catch (error) {
        logger.error("FP Webhook Processing Error:", error);

        next(error);
        return;
    }
};