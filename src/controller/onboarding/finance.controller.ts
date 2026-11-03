import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import { onboarding_finance_schema } from "../../lib/zod-schemas/onboarding.schema.js";
import { user_finance_service } from "../../services/onboarding/user.finance.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";

class FinanceOnboardingControllerClass {
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
                onboarding_finance_schema.safeParse(req.body);

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
                        finance_status: "SKIPPED",
                        current_stage: "FINANCE_DETAILS",
                    },
                );

                await user_onboarding_service.recompute_completion(user.id);
                const onboarding = await user_onboarding_service.get_status_summary(user.id);

                res.status(200).json({
                    success: true,
                    message: "Finance stage skipped",
                    data: null,
                    onboarding,
                });
                return;
            }

            const finance =
                await user_finance_service.create(
                    user.id,
                    validation_result.data,
                );

            await user_onboarding_service.update_stage(
                user.id,
                {
                    finance_status: "VERIFIED",
                    current_stage: "ASSET_DETAILS",
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
                message: "Financial details saved successfully",
                data: finance,
                onboarding,
            });
        } catch (error) {
            next(error);
        }
    };
}

export const finance_onboarding_controller =
    new FinanceOnboardingControllerClass();