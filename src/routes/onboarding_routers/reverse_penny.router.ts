import { Router } from "express";
import { reverse_penny_controller } from "../../controller/onboarding/reverse_penny.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const reverse_penny_router = Router();

reverse_penny_router.post("/initiate", login_require, reverse_penny_controller.initiate);
reverse_penny_router.get("/status", login_require, reverse_penny_controller.check_status);
reverse_penny_router.get("/status/:txnId", login_require, reverse_penny_controller.check_status);
reverse_penny_router.get("/prefill", login_require, reverse_penny_controller.get_prefill);
