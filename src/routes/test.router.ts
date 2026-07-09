import { Router } from "express";
import { test_controller } from "../controller/test.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const test_router = Router();

test_router.post("/notification", login_require, test_controller.send_test_notification);

test_router.post("/nse/client-kyc-report", test_controller.test_nse_client_kyc_report);
