import { Router } from "express";
import { login_require } from "../../middleware/session.middleware.js";
import { assets_onboarding_controller } from "../../controller/onboarding/assets.controller.js";

export const assets_router = Router();

assets_router.post(
    "/",
    login_require,
    assets_onboarding_controller.create,
);