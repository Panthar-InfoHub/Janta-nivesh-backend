import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { mf_cart_service } from "../services/mf-cart.service.js";

class MfCartCheckoutControllerClass {
    initiate_lumpsum_checkout = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user_id = req.user?.id;

            if (!user_id) {
                res.status(401).json({
                    success: false,
                    message: "Unauthorized",
                });
                return;
            }

            const result =
                await mf_cart_service.initiate_lumpsum_checkout(
                    user_id,
                );

            res.status(200).json({
                success: true,
                message: "Lumpsum checkout initiated",
                data: result,
            });

            return;
        } catch (error) {
            logger.error(
                "Error initiating lumpsum cart checkout ==> ",
                error,
            );

            next(error);
            return;
        }
    };
}

export const mf_cart_checkout_controller =
    new MfCartCheckoutControllerClass();