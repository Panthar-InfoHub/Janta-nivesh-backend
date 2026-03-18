import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { mututal_funds_service } from "../services/mutual-fund.service.js";
import { job_service } from "../services/job.service.js";

class JobControllerClass {

    daily_mf_job = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";

            if (scheduler_token !== secret) {
                console.warn(`[SECURITY] Unauthorized attempt to access daily mf job with token: ${scheduler_token}`);
                throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            }

            logger.info("Running daily mutual fund job...");

            await job_service.daily_mf_product_job();

            res.status(200).json({
                success: true,
                message: "Daily mutual fund job completed successfully"
            })
            return;

        } catch (error: any) {
            console.error("Error while running daily mf job ==> ", error.message);
            // logger.error("Error while running daily mf job ==> ", error.message);
            next(error);
            return;
        }
    }


    mf_nav_history_job = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";

            if (scheduler_token !== secret) {
                console.warn(`[SECURITY] Unauthorized attempt to access mf nav history job with token: ${scheduler_token}`);
                throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            }

            logger.info("Running mf nav history job...");

            await job_service.nav_history_job();

            res.status(200).json({
                success: true,
                message: "MF NAV history job completed successfully"
            })
            return;

        } catch (error: any) {
            console.error("Error while running mf nav history job ==> ", error.message);
            // logger.error("Error while running mf nav history job ==> ", error.message);
            next(error);
            return;
        }
    }


    mf_single_nav_history_job = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const scheme_id = req.params.id as string;

            logger.info(`Running single nav history job for scheme code: ${scheme_id}...`);

            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";

            if (scheduler_token !== secret) {
                console.warn(`[SECURITY] Unauthorized attempt to access mf single nav history job with token: ${scheduler_token}`);
                throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            }

            logger.info("Running mf single nav history job...");

            await job_service.single_nav_history_job(scheme_id);

            res.status(200).json({
                success: true,
                message: "MF NAV history job completed successfully"
            })
            return;

        } catch (error: any) {
            console.error("Error while running mf nav history job ==> ", error.message);
            // logger.error("Error while running mf nav history job ==> ", error.message);
            next(error);
            return;
        }
    }
}

export const job_controller = new JobControllerClass();