import { Router } from "express";
import { mf_purchase_plan_controller } from "../controller/mf-purchase-plan.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_purchase_plan_router = Router();

mf_purchase_plan_router.post("/", login_require, mf_purchase_plan_controller.create_purchase_plan);
mf_purchase_plan_router.get("/", login_require, mf_purchase_plan_controller.get_purchase_plans);
