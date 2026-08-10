import { Router } from "express";
import { mf_redemption_plan_controller } from "../controller/mf-redemption-plan.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_redemption_plan_router = Router();

mf_redemption_plan_router.post("/", login_require, mf_redemption_plan_controller.create_redemption_plan);
mf_redemption_plan_router.get("/", login_require, mf_redemption_plan_controller.get_redemption_plans);
mf_redemption_plan_router.get("/:id", login_require, mf_redemption_plan_controller.fetch_redemption_plan);
mf_redemption_plan_router.post("/:id/confirm/request-otp", login_require, mf_redemption_plan_controller.request_confirmation_otp);
mf_redemption_plan_router.post("/:id/confirm/verify-otp", login_require, mf_redemption_plan_controller.verify_confirmation_otp);
