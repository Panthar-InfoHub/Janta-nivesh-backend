import { Router } from "express";
import { mf_purchase_plan_controller } from "../controller/mf-purchase-plan.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_purchase_plan_router = Router();

mf_purchase_plan_router.post("/", login_require, mf_purchase_plan_controller.create_purchase_plan);
mf_purchase_plan_router.get("/", login_require, mf_purchase_plan_controller.get_purchase_plans);
mf_purchase_plan_router.get("/:id", login_require, mf_purchase_plan_controller.fetch_purchase_plan);
mf_purchase_plan_router.post("/:id/confirm/request-otp", login_require, mf_purchase_plan_controller.request_confirmation_otp);
mf_purchase_plan_router.post("/:id/confirm/verify-otp", login_require, mf_purchase_plan_controller.verify_confirmation_otp);
mf_purchase_plan_router.post("/:id/cancel", login_require, mf_purchase_plan_controller.cancel_purchase_plan);