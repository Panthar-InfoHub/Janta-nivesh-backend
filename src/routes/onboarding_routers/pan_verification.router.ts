import { Router } from "express";
import { pan_verification_controller } from "../../controller/onboarding/pan_verification.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const pan_verification_router = Router();

pan_verification_router.post("/", login_require, pan_verification_controller.verify_pan);

// Client polls this - no id needed, we already know the user's pre_verification_id from step 1
pan_verification_router.get("/status", login_require, pan_verification_controller.check_pan_verification_status);
