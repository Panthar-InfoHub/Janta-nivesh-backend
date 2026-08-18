import { Router } from "express";
import { basic_details_controller } from "../../controller/onboarding/basic_details.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const basic_details_router = Router();

basic_details_router.post("/", login_require, basic_details_controller.submit_basic_details);
