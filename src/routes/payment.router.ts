import { Router } from "express";
import { payment_controller } from "../controller/payment.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const payment_router = Router();

payment_router.get("/:id", login_require, payment_controller.get_payment_status);
