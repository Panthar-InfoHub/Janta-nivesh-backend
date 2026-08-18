import { Router } from "express";
import { email_verification_controller } from "../../controller/onboarding/email_verification.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const email_verification_router = Router();

email_verification_router.post("/request-otp", login_require, email_verification_controller.request_otp);
email_verification_router.post("/verify-otp", login_require, email_verification_controller.verify_otp);
