import { Router } from "express";
import { onboarding_controller } from "../controller/onboarding.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const onboarding_router = Router();

onboarding_router.post("/complete-onboarding", login_require, onboarding_controller.complete_onboarding)
onboarding_router.post("/complete-step", login_require, onboarding_controller.complete_onboarding)