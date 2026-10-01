import { Router } from "express";
import { frontend_controller } from "../controller/frontend.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const frontend_router = Router();

frontend_router.get("/mf-data", frontend_controller.get_frontend_mf_data);
frontend_router.post("/request-connection", login_require, frontend_controller.request_connection);

// Pincode -> City lookup: GET /api/v2/frontend/city?pin=110001
frontend_router.get("/city", frontend_controller.get_city_by_pincode);
frontend_router.get("/pincode", frontend_controller.get_city_by_pincode);