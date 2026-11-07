import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import { onboarding_goals_schema } from "../../lib/zod-schemas/onboarding.schema.js";
import { user_goal_service } from "../../services/onboarding/user.goal.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";
import { zoho_webhook_service } from "../../services/zoho.webhook.service.js";

class GoalsOnboardingControllerClass {
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
                onboarding_goals_schema.safeParse(req.body);

            if (!validation_result.success) {
                throw new AppError(
                    "Validation failed",
                    400,
                    "VALIDATION_ERROR",
                );
            }

            const data = validation_result.data;

            if ("skip" in data && data.skip === true) {
                await user_onboarding_service.update_stage(
                    user.id,
                    {
                        goals_status: "SKIPPED",
                        current_stage: "COMPLETED",
                    },
                );

                await user_onboarding_service.recompute_completion(user.id);
                const onboarding = await user_onboarding_service.get_status_summary(user.id);

                res.status(200).json({
                    success: true,
                    message: "Goals stage skipped",
                    data: null,
                    onboarding,
                });
                return;
            }

            // Extract goal(s) to create
            let created_goals: any[] = [];
            if (Array.isArray(data)) {
                created_goals = await Promise.all(
                    data.map((g) => user_goal_service.createGoal(user.id, g))
                );
            } else if ("goals" in data && Array.isArray(data.goals)) {
                created_goals = await Promise.all(
                    data.goals.map((g) => user_goal_service.createGoal(user.id, g))
                );
            } else if ("goal" in data && data.goal) {
                const single = await user_goal_service.createGoal(user.id, data.goal);
                created_goals = [single];
            } else {
                const single = await user_goal_service.createGoal(user.id, data as any);
                created_goals = [single];
            }

            await user_onboarding_service.update_stage(
                user.id,
                {
                    goals_status: "VERIFIED",
                    current_stage: "COMPLETED",
                },
            );

            await user_onboarding_service.recompute_completion(
                user.id,
            );

            const onboarding =
                await user_onboarding_service.get_status_summary(
                    user.id,
                );

            const db_user =
                await user_service.get_user_by_id(user.id);

            await zoho_webhook_service.send_event({
                event_type: "FINANCIAL_ONBOARDING_COMPLETED",
                timestamp: new Date().toISOString(),
                user_id: user.id,
                user_phone: db_user?.phone_no,
                full_name: db_user?.full_name,
                email: db_user?.email,
            });

            res.status(200).json({
                success: true,
                message: "Goal details saved successfully",
                data: created_goals.length === 1 ? created_goals[0] : created_goals,
                onboarding,
            });
        } catch (error) {
            next(error);
        }
    };
}

export const goals_onboarding_controller =
    new GoalsOnboardingControllerClass();

