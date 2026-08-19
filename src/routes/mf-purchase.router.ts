import { Router } from "express";
import { mf_purchase_controller } from "../controller/mf-purchase.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_purchase_router = Router();

mf_purchase_router.post("/", login_require, mf_purchase_controller.create_purchase);
mf_purchase_router.get("/:id", login_require, mf_purchase_controller.fetch_purchase);
mf_purchase_router.post("/:id/confirm/request-otp", login_require, mf_purchase_controller.request_confirmation_otp);
mf_purchase_router.post("/:id/confirm/verify-otp", login_require, mf_purchase_controller.verify_confirmation_otp);