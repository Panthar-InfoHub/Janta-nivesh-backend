import { Router } from "express";
import { login_require } from "../../middleware/session.middleware.js";
import { goals_onboarding_controller } from "../../controller/onboarding/goals.controller.js";

export const goals_router = Router();

goals_router.post(
    "/",
    login_require,
    goals_onboarding_controller.create,
);

