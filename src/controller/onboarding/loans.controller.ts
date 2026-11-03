import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import { onboarding_loans_schema } from "../../lib/zod-schemas/onboarding.schema.js";
import { user_loan_service } from "../../services/onboarding/user.loan.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";

class LoansOnboardingControllerClass {
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
                onboarding_loans_schema.safeParse(req.body);

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
                        loan_status: "SKIPPED",
                        current_stage: "LOAN_DETAILS",
                    },
                );

                await user_onboarding_service.recompute_completion(user.id);
                const onboarding = await user_onboarding_service.get_status_summary(user.id);

                res.status(200).json({
                    success: true,
                    message: "Loan stage skipped",
                    data: null,
                    onboarding,
                });
                return;
            }

            const loans_to_sync = Array.isArray(validation_result.data)
                ? validation_result.data
                : "loans" in validation_result.data
                    ? validation_result.data.loans
                    : [];

            await user_loan_service.sync(
                user.id,
                loans_to_sync,
            );

            await user_onboarding_service.update_stage(
                user.id,
                {
                    loan_status: "VERIFIED",
                    current_stage: "INSURANCE_DETAILS",
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
                message: "Loan details saved successfully",
                data: loans_to_sync,
                onboarding,
            });
        } catch (error) {
            next(error);
        }
    };
}

export const loans_onboarding_controller =
    new LoansOnboardingControllerClass();