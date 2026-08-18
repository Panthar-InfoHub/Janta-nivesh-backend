import { NextFunction, Request, Response } from "express";
import AppError from "./error.middleware.js";
import logger from "./logger.js";
import { env } from "../lib/config-env.js";

/**
 * Guards every admin route: requires x-admin-secret to match ADMIN_API_SECRET.
 *
 * Two things to note about the failure mode:
 * - Rejects with 404, not 403. A 403 confirms the route exists and tells a prober exactly where
 *   to concentrate; a 404 is indistinguishable from the route not being mounted at all.
 * - Fails closed on a missing ADMIN_API_SECRET. An unset secret rejects everything rather than
 *   waving everything through, so a half-configured deploy can't accidentally open this up.
 *
 * This is the only gate on most admin routes (e.g. the MF product import - it needs to run in
 * production, so it can't also be dev-only). Routes that additionally mint credentials (login)
 * layer `dev_only_require` in front of this one - see that middleware below.
 */
export const admin_require = (req: Request, _res: Response, next: NextFunction) => {
    if (!env.ADMIN_API_SECRET) {
        logger.warn("Admin route hit but ADMIN_API_SECRET is not configured - rejecting");
        throw new AppError("Not found", 404, "NOT_FOUND");
    }

    if (req.header("x-admin-secret") !== env.ADMIN_API_SECRET) {
        logger.warn("Admin route hit with a bad or missing x-admin-secret", {
            ip: req.ip,
            path: req.originalUrl,
        });
        throw new AppError("Not found", 404, "NOT_FOUND");
    }

    next();
};

/**
 * Extra gate for routes that mint auth tokens (currently just /admin/login) - those are unsafe
 * anywhere but dev, unlike the rest of the admin router. Chain in front of admin_require:
 *   router.post("/login", dev_only_require, admin_require, controller.admin_login)
 * Same 404-not-403 reasoning as admin_require - don't confirm the route exists to a prober.
 */
export const dev_only_require = (_req: Request, _res: Response, next: NextFunction) => {
    if (process.env.ENVIRONMENT !== "dev") {
        throw new AppError("Not found", 404, "NOT_FOUND");
    }
    next();
};
