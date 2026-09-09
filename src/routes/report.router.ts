import { Router } from "express";
import { login_require } from "../middleware/session.middleware.js";
import { report_controller } from "../controller/report.controller.js";

export const report_router = Router();

// Janta Nivesh Client PDF Reports
report_router.get("/portfolio/pdf", login_require, report_controller.get_portfolio_report_pdf);
report_router.get("/fund-holding/pdf", login_require, report_controller.get_fund_holding_report_pdf);

// Legacy Finnsys export
report_router.get("/", login_require, report_controller.export_report);
