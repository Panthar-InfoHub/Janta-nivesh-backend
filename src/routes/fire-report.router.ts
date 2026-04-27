import { Router } from "express";
import { fire_report_controller } from "../controller/fire-report.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const fire_report_router = Router();

fire_report_router.get("/", login_require, fire_report_controller.get_fire_report);
fire_report_router.get("/pdf", login_require, fire_report_controller.get_fire_report_pdf);
