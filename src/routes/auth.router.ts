import { Router } from "express";
import { auth_controller } from "../controller/auth.controller.js";

export const auth_router = Router();

auth_router.post("/req-otp", auth_controller.auth_req_otp);

auth_router.post("/validate-otp", auth_controller.auth_validate_otp);

auth_router.post("/login-invId", auth_controller.auth_login_invId);

auth_router.post("/login-creds", auth_controller.auth_login_creds);

auth_router.post("/refresh-token", auth_controller.refresh_token);