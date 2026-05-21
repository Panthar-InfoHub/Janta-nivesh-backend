import { Router } from "express";
import { login_require } from "../middleware/session.middleware.js";
import { report_controller } from "../controller/report.controller.js";

export const report_router = Router();

report_router.get("/", login_require, report_controller.export_report);
