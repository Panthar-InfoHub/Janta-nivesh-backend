import { Router } from "express";
import { mf_purchase_controller } from "../controller/mf-purchase.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_purchase_router = Router();

mf_purchase_router.post("/", login_require, mf_purchase_controller.create_purchase);
