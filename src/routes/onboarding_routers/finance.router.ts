import { Router } from "express";
import { login_require } from "../../middleware/session.middleware.js";
import { finance_onboarding_controller } from "../../controller/onboarding/finance.controller.js";

export const finance_router = Router();

finance_router.post(
    "/",
    login_require,
    finance_onboarding_controller.create,
);