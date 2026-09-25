import { isIPv4 } from "net";
import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { mf_cart_service } from "../services/mf-cart.service.js";
import {
    confirm_lumpsum_checkout_schema,
    confirm_sip_checkout_schema,
} from "../lib/zod-schemas/mf-cart.schema.js";

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

            let raw_ip =
                req.headers["x-forwarded-for"] ||
                req.ip ||
                req.socket.remoteAddress ||
                "127.0.0.1";

            let user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip)
                .split(",")[0]
                .replace("::ffff:", "")
                .trim();

            if (!isIPv4(user_ip)) {
                user_ip = "127.0.0.1";
            }

            const result =
                await mf_cart_service.initiate_lumpsum_checkout(
                    user_id,
                    user_ip,
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

    confirm_lumpsum_checkout = async (
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

            const {
                batch_id,
                otp,
                payment_postback_url,
            } = confirm_lumpsum_checkout_schema.parse(req.body);

            const result =
                await mf_cart_service.confirm_lumpsum_checkout(
                    user_id,
                    batch_id,
                    otp,
                    payment_postback_url,
                );

            res.status(200).json({
                success: true,
                message: "Lumpsum checkout confirmed",
                data: result,
            });

            return;
        } catch (error) {
            logger.error(
                "Error confirming lumpsum cart checkout ==> ",
                error,
            );

            next(error);
            return;
        }
    };

    initiate_sip_checkout = async (
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

            let raw_ip =
                req.headers["x-forwarded-for"] ||
                req.ip ||
                req.socket.remoteAddress ||
                "127.0.0.1";

            let user_ip = (Array.isArray(raw_ip) ? raw_ip[0] : raw_ip)
                .split(",")[0]
                .replace("::ffff:", "")
                .trim();

            if (!isIPv4(user_ip)) {
                user_ip = "127.0.0.1";
            }

            const result =
                await mf_cart_service.initiate_sip_checkout(
                    user_id,
                    user_ip,
                );

            res.status(200).json({
                success: true,
                message: "SIP checkout initiated",
                data: result,
            });

            return;
        } catch (error) {
            logger.error(
                "Error initiating SIP cart checkout ==> ",
                error,
            );

            next(error);
            return;
        }
    };

    confirm_sip_checkout = async (
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

            const {
                batch_id,
                otp,
            } = confirm_sip_checkout_schema.parse(req.body);

            const result =
                await mf_cart_service.confirm_sip_checkout(
                    user_id,
                    batch_id,
                    otp,
                );

            res.status(200).json({
                success: true,
                message: "SIP checkout confirmed",
                data: result,
            });

            return;
        } catch (error) {
            logger.error(
                "Error confirming SIP cart checkout ==> ",
                error,
            );

            next(error);
            return;
        }
    };
}

export const mf_cart_checkout_controller =
    new MfCartCheckoutControllerClass();