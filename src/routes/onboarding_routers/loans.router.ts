import { Router } from "express";
import { login_require } from "../../middleware/session.middleware.js";
import { loans_onboarding_controller } from "../../controller/onboarding/loans.controller.js";

export const loans_router = Router();

loans_router.post(
    "/",
    login_require,
    loans_onboarding_controller.create,
);