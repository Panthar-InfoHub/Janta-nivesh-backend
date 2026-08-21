import { Router } from "express";
import { mf_switch_plan_controller } from "../controller/mf-switch-plan.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_switch_plan_router = Router();

mf_switch_plan_router.post("/", login_require, mf_switch_plan_controller.create_switch_plan,);
mf_switch_plan_router.get("/:id", login_require, mf_switch_plan_controller.fetch_switch_plan,);
mf_switch_plan_router.post("/:id/confirm/request-otp", login_require, mf_switch_plan_controller.request_confirmation_otp,);
mf_switch_plan_router.post("/:id/confirm/verify-otp", login_require, mf_switch_plan_controller.verify_confirmation_otp,);