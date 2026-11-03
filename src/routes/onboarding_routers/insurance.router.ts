import { Router } from "express";
import { login_require } from "../../middleware/session.middleware.js";
import { insurance_onboarding_controller } from "../../controller/onboarding/insurance.controller.js";

export const insurance_router = Router();

insurance_router.post(
    "/",
    login_require,
    insurance_onboarding_controller.create,
);