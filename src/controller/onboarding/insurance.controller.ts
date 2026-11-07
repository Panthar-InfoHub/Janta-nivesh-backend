import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import { onboarding_insurance_schema } from "../../lib/zod-schemas/onboarding.schema.js";
import { user_insurance_service } from "../../services/onboarding/user.insurance.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";
import { zoho_webhook_service } from "../../services/zoho.webhook.service.js";

class InsuranceOnboardingControllerClass {
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
                onboarding_insurance_schema.safeParse(req.body);

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
                        insurance_status: "SKIPPED",
                        current_stage: "GOAL_DETAILS",
                    },
                );

                await user_onboarding_service.recompute_completion(user.id);
                const onboarding = await user_onboarding_service.get_status_summary(user.id);

                res.status(200).json({
                    success: true,
                    message: "Insurance stage skipped",
                    data: null,
                    onboarding,
                });
                return;
            }

            const insurance =
                await user_insurance_service.create(
                    user.id,
                    validation_result.data,
                );

            await user_onboarding_service.update_stage(
                user.id,
                {
                    insurance_status: "VERIFIED",
                    current_stage: "GOAL_DETAILS",
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
                message: "Insurance details saved successfully",
                data: insurance,
                onboarding,
            });
        } catch (error) {
            next(error);
        }
    };
}

export const insurance_onboarding_controller =
    new InsuranceOnboardingControllerClass();