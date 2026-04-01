import axios from "axios";
import { NextFunction, Request, Response } from "express";
import { env } from "../lib/config-env.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { job_service } from "../services/job.service.js";

class JobControllerClass {

    get_blostem_token = async () => {
        try {

            logger.debug("Attempting to retrieve Blostem token with credentials: ", { email: env.BLOSTEM_USERNAME, password: env.BLOSTEM_PASSWORD });
            logger.debug(`Blostem Master URL: ${env.BLOSTEM_MASTER_URL}/binvestt/partner/login`);
            const res = await axios.post(`${env.BLOSTEM_MASTER_URL}/binvestt/partner/login`, {
                email: env.BLOSTEM_USERNAME,
                password: env.BLOSTEM_PASSWORD,
            },
            );

            logger.debug("Blostem login response: ", res.data);
            return res.data.data.access.token;
        } catch (error: any) {
            logger.error("Error getting Blostem token: ", error.response?.data ?? error.message);
        }
    }



    get_redirect_blostem_token = async () => {
        try {

            logger.debug("Attempting to retrieve Blostem token with credentials: ", { email: env.BLOSTEM_USERNAME, password: env.BLOSTEM_PASSWORD });
            logger.debug(`Blostem Master URL: ${env.BLOSTEM_MASTER_URL}/auth/v1/partner/login`);
            const res = await axios.post(`${env.BLOSTEM_MASTER_URL}/auth/v1/partner/login`, {
                email: env.BLOSTEM_USERNAME,
                password: env.BLOSTEM_DASH_PASSWORD,
            },
            );

            logger.debug("Blostem login response: ", res.data);
            return res.data.data.access.token;
        } catch (error: any) {
            logger.error("Error getting Blostem token: ", error.response?.data ?? error.message);
        }
    }





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













    daily_fd_product_sync_job = async (req: Request, res: Response, next: NextFunction) => {

        try {
            logger.info("FD Sync Job Initiated.");
            const token = await this.get_blostem_token();

            if (!token) {
                logger.error("Failed to retrieve Blostem token. Aborting FD sync job.");
                throw new AppError("Failed to authenticate with Blostem API", 500, "BLOSTEM_AUTH_FAILED");
            }

            logger.debug("Blostem sign-in successful. Token acquired, starting FD product sync..., Token: ", token);

            await job_service.daily_fd_job(token);
            logger.info("FD MASTER SYNC SUCCESSFUL");

            res.status(200).json({
                success: true,
                message: "Daily fd job completed successfully"
            })
            return;
        } catch (error: any) {
            logger.error("CRITICAL: FD Sync Job Failed. Rollback executed.", error.response?.data ?? error.message);
            next(error);
            return;
        }
    };
}

export const job_controller = new JobControllerClass();