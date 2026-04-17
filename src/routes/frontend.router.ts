import { Router } from "express";
import { frontend_controller } from "../controller/frontend.controller.js";

export const frontend_router = Router();


frontend_router.get("/mf-data", frontend_controller.get_frontend_mf_data)