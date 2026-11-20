import { Router } from "express";
import { auth_controller } from "../controller/auth.controller.js";
import { auth_otp_rate_limiter, auth_validate_otp_rate_limiter } from "../middleware/rate-limiter.middleware.js";

export const auth_router = Router();

auth_router.post("/req-otp", auth_otp_rate_limiter, auth_controller.auth_req_otp);

auth_router.post("/validate-otp", auth_validate_otp_rate_limiter, auth_controller.auth_validate_otp);

auth_router.post("/refresh-token", auth_controller.refresh_token);