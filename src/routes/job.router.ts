import { Router } from "express";
import { job_controller } from "../controller/job.controller.js";

export const job_router = Router();

job_router.post("/mf-daily", job_controller.daily_mf_job);
job_router.post("/mf-nav-history", job_controller.mf_nav_history_job);
job_router.post("/fd-daily", job_controller.daily_fd_product_sync_job);
job_router.post("/mf-single-nav/:id", job_controller.mf_single_nav_history_job);