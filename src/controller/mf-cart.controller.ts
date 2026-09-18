import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import {
    add_mf_cart_item_schema,
    update_mf_cart_item_schema,
} from "../lib/zod-schemas/mf-cart.schema.js";
import { mf_cart_service } from "../services/mf-cart.service.js";

class MfCartControllerClass {

    /**
     * GET /api/v2/mf/cart
     * Fetch all cart items for the authenticated user.
     */
    get_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;

            const cart = await mf_cart_service.get_cart(user_id);

            res.status(200).json({
                success: true,
                message: "MF cart fetched successfully",
                data: cart,
            });
            return;
        } catch (error) {
            logger.error("Error in get_cart controller:", error);
            next(error);
            return;
        }
    };

    add_to_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;

            const input = add_mf_cart_item_schema.parse(req.body);

            const cart_item = await mf_cart_service.add_to_cart(
                user_id,
                input,
            );

            res.status(200).json({
                success: true,
                message: "MF fund added to cart successfully",
                data: cart_item,
            });
            return;
        } catch (error) {
            logger.error("Error in add_to_cart controller:", error);
            next(error);
            return;
        }
    };

    update_cart_item = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const cart_item_id = req.params.id as string;

            if (!cart_item_id) {
                throw new AppError(
                    "Cart item id is required",
                    400,
                    "CART_ITEM_ID_MISSING",
                );
            }

            const input = update_mf_cart_item_schema.parse(req.body);

            const updated_item = await mf_cart_service.update_cart_item(
                user_id,
                cart_item_id,
                input,
            );

            res.status(200).json({
                success: true,
                message: "MF cart item updated successfully",
                data: updated_item,
            });
            return;
        } catch (error) {
            logger.error("Error in update_cart_item controller:", error);
            next(error);
            return;
        }
    };

    remove_from_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const cart_item_id = req.params.id as string;

            if (!cart_item_id) {
                throw new AppError(
                    "Cart item id is required",
                    400,
                    "CART_ITEM_ID_MISSING",
                );
            }

            await mf_cart_service.remove_from_cart(
                user_id,
                cart_item_id,
            );

            res.status(200).json({
                success: true,
                message: "MF cart item removed successfully",
                data: null,
            });
            return;
        } catch (error) {
            logger.error("Error in remove_from_cart controller:", error);
            next(error);
            return;
        }
    };

    clear_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;

            const cart_type = req.query.cart_type as
                | "LUMPSUM"
                | "SIP"
                | undefined;

            if (
                cart_type !== undefined &&
                cart_type !== "LUMPSUM" &&
                cart_type !== "SIP"
            ) {
                throw new AppError(
                    "cart_type must be either LUMPSUM or SIP",
                    400,
                    "INVALID_CART_TYPE",
                );
            }

            await mf_cart_service.clear_cart(user_id, cart_type);

            res.status(200).json({
                success: true,
                message: cart_type
                    ? `${cart_type} cart items cleared successfully`
                    : "MF cart cleared successfully",
                data: null,
            });
            return;
        } catch (error) {
            logger.error("Error in clear_cart controller:", error);
            next(error);
            return;
        }
    };
}

export const mf_cart_controller = new MfCartControllerClass();