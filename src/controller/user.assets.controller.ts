import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { user_assets_service } from "../services/onboarding/user.assets.service.js";

// Zod Schema for User Assets
const user_assets_zod_schema = z.object({
    mutual_funds: z.number().min(0).default(0),
    stocks: z.number().min(0).default(0),
    fd: z.number().min(0).default(0),
    real_estate: z.number().min(0).default(0),
    gold: z.number().min(0).default(0),
    cash_saving: z.number().min(0).default(0),
});

type UserAssetsInput = z.infer<typeof user_assets_zod_schema>;

class UserAssetsControllerClass {
    async onboarding_create(req: Request) {
        const user = req.user!;
        const { current_step, ...data }: any = req.body;

        logger.debug(`Processing onboarding assets for User ID: ${user.id} with current step: ${current_step}`);

        const validated_data: UserAssetsInput = user_assets_zod_schema.parse(data);
        return await user_assets_service.create(user.id, validated_data);
    }

    async create(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await this.onboarding_create(req);

            res.status(200).json({
                success: true,
                message: "Asset details created successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in create assets:", error);
            next(error);
            return;
        }
    }

    async update(req: Request, res: Response, next: NextFunction) {
        try {
            const user = req.user!;
            const data = req.body;

            const validated_data: UserAssetsInput = user_assets_zod_schema.parse(data);

            const result = await user_assets_service.update(user.id, validated_data);

            res.status(200).json({
                success: true,
                message: "Asset details updated successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in update assets:", error);
            next(error);
            return;
        }
    }

    async get_user_assets(req: Request, res: Response, next: NextFunction) {
        try {
            const user = req.user!;
            const result = await user_assets_service.get(user.id);

            if (!result) {
                throw new AppError("Asset details not found", 404);
            }

            res.status(200).json({
                success: true,
                message: "Asset details fetched successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in get assets:", error);
            next(error);
            return;
        }
    }

    async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const user = req.user!;
            await user_assets_service.delete(user.id);

            res.status(200).json({
                success: true,
                message: "Asset details deleted successfully"
            });
            return;
        } catch (error) {
            logger.error("Error in delete assets:", error);
            next(error);
            return;
        }
    }
}

export const user_assets_controller = new UserAssetsControllerClass();
