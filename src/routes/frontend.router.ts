import { Router } from "express";
import { frontend_controller } from "../controller/frontend.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const frontend_router = Router();

frontend_router.get("/mf-data", frontend_controller.get_frontend_mf_data);
frontend_router.post("/request-connection", login_require, frontend_controller.request_connection);