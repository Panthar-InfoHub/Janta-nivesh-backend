import { NextFunction, Request, Response } from "express";
import { fire_report_service } from "../services/fire.report.service.js";
import { to_report_view_data } from "../lib/fire-report.transformer.js";
import { generateFireReportHTML } from "../lib/fire-report.template.js";
import { renderPDF } from "../lib/fire-report.renderer.js";
import logger from "../middleware/logger.js";

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execPromise = promisify(exec);

export const fire_report_controller = {
    async get_fire_report(req: Request, res: Response, next: NextFunction) {
        try {
            const user_id: string = req.user!.id;

            // projection_years: must be one of 5 | 10 | 20, defaults to 20
            const raw_years = Number(req.query.projection_years);
            const projection_years = [5, 10, 20].includes(raw_years) ? raw_years : 20;

            logger.info(`Generating FIRE report for user_id: ${user_id} (projection_years=${projection_years})`);

            const data = await fire_report_service.get_fire_report(user_id, projection_years);
            res.status(200).json({
                code: 200,
                message: "FIRE report generated successfully",
                data
            });
        } catch (error) {
            logger.error(`Error generating FIRE report: ${error instanceof Error ? error.message : String(error)}`);
            next(error);
            return;
        }
    },

    async get_fire_report_pdf(req: Request, res: Response, next: NextFunction) {
        try {
            const user_id: string = req.user!.id;
            await checkChromeDependencies();

            logger.info(`Generating FIRE PDF report for user_id: ${user_id}`);

            const report = await fire_report_service.get_fire_report(user_id, 30);
            const view_data = to_report_view_data(report);
            const html = generateFireReportHTML(view_data);
            const buffer = await renderPDF(html);

            res.set({
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="velvet-wealth-report-${user_id}.pdf"`,
                "Content-Length": buffer.length.toString(),
            });
            res.send(buffer);
        } catch (error) {
            logger.error(`Error generating FIRE PDF: ${error instanceof Error ? error.message : String(error)}`);
            next(error);
            return;
        }
    },

};


async function checkChromeDependencies() {
    // Path to the bundled chrome binary in your .cache folder
    // Note: The version number might change if puppeteer updates, 
    // so we use a wildcard or the specific one from your logs.
    const chromePath = "/workspace/.cache/puppeteer/chrome/linux-146.0.7680.66/chrome-linux64/chrome"

    try {
        logger.info("Starting dependency check for Chrome...");
        // ldd lists all shared library dependencies and their status
        const { stdout, stderr } = await execPromise(`ldd ${chromePath}`);

        if (stderr) logger.warn(`ldd stderr: ${stderr}`);

        const missing = stdout
            .split("\n")
            .filter(line => line.includes("not found"))
            .map(line => line.trim());

        if (missing.length > 0) {
            logger.error(`🚨 MISSING LIBRARIES DETECTED: \n${missing.join("\n")}`);
        } else {
            logger.info("✅ All Chrome shared libraries are present.");
        }
    } catch (error) {
        logger.error(`Could not run dependency check: ${error instanceof Error ? error.message : String(error)}`);
    }
}