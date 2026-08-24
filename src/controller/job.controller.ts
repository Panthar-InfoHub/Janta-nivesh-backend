import axios from "axios";
import { NextFunction, Request, Response } from "express";
import { env } from "../lib/config-env.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { job_service } from "../services/job.service.js";

class JobControllerClass {

    get_blostem_token = async () => {
        try {

            logger.debug(`Environment: ${env.ENVIRONMENT}, therefore using URL: ${env.ENVIRONMENT === "dev" ? `${env.BLOSTEM_MASTER_URL}/binvestt/partner/login` : `https://binvestt-api.blostem.com/partner/login`}`);
            const res = env.ENVIRONMENT === "dev"
                ? await axios.post(`${env.BLOSTEM_MASTER_URL}/binvestt/partner/login`, {
                    email: env.BLOSTEM_USERNAME,
                    password: env.BLOSTEM_PASSWORD,
                },
                )
                : await axios.post(`https://binvestt-api.blostem.com/partner/login`, {
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
            const res = env.ENVIRONMENT === "dev"
                ? await axios.post(`${env.BLOSTEM_MASTER_URL}/auth/v1/partner/login`, {
                    email: env.BLOSTEM_USERNAME,
                    password: env.BLOSTEM_DASH_PASSWORD,
                })
                : await axios.post(`${env.BLOSTEM_MASTER_URL}/auth/v1/partner/login`, {
                    email: env.BLOSTEM_USERNAME, //nitin@adgrid.ai
                    password: env.BLOSTEM_DASH_PASSWORD,
                },
                );
            logger.debug("Blostem login response: ", res.data);
            return res.data.data.access.token;
        } catch (error: any) {
            logger.error("Error getting Blostem token: ", error.response?.data ?? error.message);
        }
    }





    // daily_mf_job (Finnsys ~30k bulk upsert) removed - see the comment above
    // job_service.daily_mf_product_job's old location in job.service.ts for the replacement.

    /**
     * Historical NAV seed - pulls every curated fund's FULL history from mfapi into MfNavHistory.
     * Run once before go-live (and again after importing new funds); mf_nav_daily_job appends on
     * top of it daily. Without this seed the metrics job has no lookback and every return_* is null.
     */
    mf_nav_history_job = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const scheduler_token = req.headers["x-scheduler-token"];

            logger.debug(`Scheduler token ${scheduler_token}`);
            const secret = process.env.SCHEDULER_SECRET || "default_secret";

            logger.debug(`Secret token ${secret}`);
            if (scheduler_token !== secret) {
                logger.warn(`[SECURITY] Unauthorized attempt to access mf nav history job with token: ${scheduler_token}`);
                throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            }

            logger.info("Running MF NAV history backfill job...");

            const data = await job_service.nav_history_job();

            res.status(200).json({
                success: true,
                message: "MF NAV history job completed successfully",
                data
            })
            return;
        } catch (error: any) {
            console.error("Error while running mf nav history job ==> ", error.message);
            next(error);
            return;
        }
    }

    monthly_user_snapshot_job = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";

            if (scheduler_token !== secret) {
                console.warn(`[SECURITY] Unauthorized attempt to access monthly user snapshot job with token: ${scheduler_token}`);
                throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            }

            logger.info("Running monthly user snapshot job...");

            const data = await job_service.monthly_user_snapshot_job();

            res.status(200).json({
                success: true,
                message: "Monthly user snapshot job completed successfully",
                data
            })
            return;

        } catch (error: any) {
            console.error("Error while running monthly user snapshot job ==> ", error.message);
            next(error);
            return;
        }
    }

    // mf_single_nav_history_job disabled alongside mf_nav_history_job - same underlying
    // job_service.single_nav_history_job is commented out. See the TODO in job.service.ts.
    // mf_single_nav_history_job = async (req: Request, res: Response, next: NextFunction) => {
    //     try {
    //         const scheme_id = req.params.id as string;
    //         const scheduler_token = req.headers["x-scheduler-token"];
    //         const secret = process.env.SCHEDULER_SECRET || "default_secret";
    //         if (scheduler_token !== secret) {
    //             throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
    //         }
    //         await job_service.single_nav_history_job(scheme_id);
    //         res.status(200).json({ success: true, message: "MF NAV history job completed successfully" })
    //         return;
    //     } catch (error: any) {
    //         next(error);
    //         return;
    //     }
    // }

    /**
     * Stage 2 of the NAV pipeline - resolve each curated fund's mfapi scheme_code by matching our
     * ISIN against their master list. Occasional, not daily: the master list only changes when
     * schemes are added/retired. Returns the unmatched ISINs so gaps are visible.
     */
    mf_scheme_code_sync_job = async (req: Request, res: Response, next: NextFunction) => {
        try {
            // const scheduler_token = req.headers["x-scheduler-token"];
            // const secret = process.env.SCHEDULER_SECRET || "default_secret";

            // if (scheduler_token !== secret) {
            //     console.warn(`[SECURITY] Unauthorized attempt to access mf scheme code sync job with token: ${scheduler_token}`);
            //     throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            // }

            logger.info("Running MF scheme code sync job...");

            const data = await job_service.mf_scheme_code_sync_job();

            res.status(200).json({
                success: true,
                message: "MF scheme code sync completed successfully",
                data
            });
            return;
        } catch (error: any) {
            console.error("Error while running mf scheme code sync job ==> ", error.message);
            next(error);
            return;
        }
    }

    /**
     * Stage 3 - daily latest-NAV refresh for every fund that has a scheme_code. Writes both
     * MfProduct.latest_nav/latest_nav_date and an MfNavHistory point.
     */
    mf_nav_daily_job = async (req: Request, res: Response, next: NextFunction) => {
        try {
            // const scheduler_token = req.headers["x-scheduler-token"];
            // const secret = process.env.SCHEDULER_SECRET || "default_secret";

            // if (scheduler_token !== secret) {
            //     console.warn(`[SECURITY] Unauthorized attempt to access mf nav daily job with token: ${scheduler_token}`);
            //     throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            // }

            logger.info("Running MF daily NAV job...");

            const data = await job_service.mf_nav_daily_job();

            logger.info(`MF daily NAV job completed. Results --> `, data)

            res.status(200).json({
                success: true,
                message: "MF daily NAV job completed successfully",
                data
            });
            return;
        } catch (error: any) {
            console.error("Error while running mf nav daily job ==> ", error.message);
            next(error);
            return;
        }
    }

    mf_metrics_calc_job = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";

            if (scheduler_token !== secret) {
                console.warn(`[SECURITY] Unauthorized attempt to access mf metrics calc job with token: ${scheduler_token}`);
                throw new AppError("Unauthorized: Invalid or missing scheduler token", 401, "Unauthorized");
            }

            logger.info("Running MF metrics calculation job...");
            await job_service.calculate_all_mf_metrics();

            res.status(200).json({
                success: true,
                message: "MF metrics calculation job completed successfully"
            });
            return;
        } catch (error: any) {
            console.error("Error while running mf metrics calc job ==> ", error.message);
            next(error);
            return;
        }
    }
    mf_scheme_plan_sync_job = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";
            if (scheduler_token !== secret) {
                console.warn(
                    `[SECURITY] Unauthorized attempt to access MF scheme-plan sync job with token: ${scheduler_token}`
                );
                throw new AppError(
                    "Unauthorized: Invalid or missing scheduler token",
                    401,
                    "Unauthorized"
                );
            }
            logger.info("Running MF scheme-plan sync job...");
            const data = await job_service.mf_scheme_plan_sync_job();
            res.status(200).json({
                success: true,
                message: "MF scheme-plan sync job completed successfully",
                data,
            });
            return;
        } catch (error: any) {
            logger.error(
                "Error while running MF scheme-plan sync job ==> ",
                error.message
            );
            next(error);
            return;
        }
    };
    mf_holding_sync_job = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            const scheduler_token = req.headers["x-scheduler-token"];
            const secret = process.env.SCHEDULER_SECRET || "default_secret";
            if (scheduler_token !== secret) {
                console.warn(
                    `[SECURITY] Unauthorized attempt to access MF holdings sync job with token: ${scheduler_token}`
                );
                throw new AppError(
                    "Unauthorized: Invalid or missing scheduler token",
                    401,
                    "Unauthorized"
                );
            }
            logger.info("Running MF holdings sync job...");
            const data = await job_service.mf_holding_sync_job();
            res.status(200).json({
                success: true,
                message: "MF holdings sync job completed successfully",
                data,
            });
            return;
        } catch (error: any) {
            logger.error(
                "Error while running MF holdings sync job ==> ",
                error.message
            );
            next(error);
            return;
        }
    };
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