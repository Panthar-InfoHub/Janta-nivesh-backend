import { Router } from "express";
import { investor_profile_controller } from "../../controller/onboarding/investor_profile.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const investor_profile_router = Router();

investor_profile_router.post("/", login_require, investor_profile_controller.complete_profile_stage);
