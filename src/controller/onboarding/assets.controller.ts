import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import { onboarding_assets_schema } from "../../lib/zod-schemas/onboarding.schema.js";
import { user_assets_service } from "../../services/onboarding/user.assets.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";

class AssetsOnboardingControllerClass {
    create = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        try {
            const user = req.user;

            if (!user?.id) {
                throw new AppError(
                    "Unauthorized",
                    401,
                    "UNAUTHORIZED",
                );
            }

            const validation_result =
                onboarding_assets_schema.safeParse(req.body);

            if (!validation_result.success) {
                throw new AppError(
                    "Validation failed",
                    400,
                    "VALIDATION_ERROR",
                );
            }

            if ("skip" in validation_result.data && validation_result.data.skip === true) {
                await user_onboarding_service.update_stage(
                    user.id,
                    {
                        assets_status: "SKIPPED",
                        current_stage: "ASSET_DETAILS",
                    },
                );

                await user_onboarding_service.recompute_completion(user.id);
                const onboarding = await user_onboarding_service.get_status_summary(user.id);

                res.status(200).json({
                    success: true,
                    message: "Assets stage skipped",
                    data: null,
                    onboarding,
                });
                return;
            }

            const assets =
                await user_assets_service.create(
                    user.id,
                    validation_result.data,
                );

            await user_onboarding_service.update_stage(
                user.id,
                {
                    assets_status: "VERIFIED",
                    current_stage: "LOAN_DETAILS",
                },
            );

            await user_onboarding_service.recompute_completion(
                user.id,
            );

            const onboarding =
                await user_onboarding_service.get_status_summary(
                    user.id,
                );

            res.status(200).json({
                success: true,
                message: "Asset details saved successfully",
                data: assets,
                onboarding,
            });
        } catch (error) {
            next(error);
        }
    };
}

export const assets_onboarding_controller =
    new AssetsOnboardingControllerClass();