import { Router } from "express";
import { penny_drop_controller } from "../../controller/onboarding/penny_drop.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const penny_drop_router = Router();

penny_drop_router.post("/", login_require, penny_drop_controller.submit_bank_details);
