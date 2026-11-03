import { Request, Response, NextFunction } from "express";
import AppError from "./error.middleware.js";
import { user_onboarding_service } from "../services/kyc/user.onboarding.service.js";

export const require_fire_onboarding = async (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    try {
        const user_id = req.user?.id;
        if (!user_id) {
            throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const onboarding = await user_onboarding_service.recompute_completion(user_id);

        if (!onboarding.is_fire_completed) {
            throw new AppError(
                "Please complete FIRE onboarding first",
                403,
                "FIRE_ONBOARDING_REQUIRED",
                {
                    current_stage: onboarding.current_stage,
                    is_fire_completed: false,
                }
            );
        }

        next();
    } catch (error) {
        next(error);
    }
};

