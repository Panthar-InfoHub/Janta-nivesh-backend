import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { parseEcas } from "../lib/ecas-parser.js";

class CasReportControllerClass {

    /**
     * POST /user/cas-report
     *
     * Accepts multipart/form-data with:
     *   - file     : the eCAS PDF file (field name: "file")
     *   - password : optional PDF password (field name: "password")
     *
     * Returns the normalised eCAS JSON payload.
     */
    parse_cas_report = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            logger.info(`Parsing CAS report for User ID: ${user_id}`);

            // Multer attaches the file to req.file
            const uploaded_file = req.file;
            if (!uploaded_file) {
                throw new AppError("No CAS PDF file provided", 400, "CAS_FILE_MISSING");
            }

            const password: string | undefined = req.body?.password || undefined;

            logger.debug(
                `CAS file received: ${uploaded_file.originalname} (${uploaded_file.size} bytes), ` +
                `password provided: ${!!password}`
            );

            // parseEcas accepts a Buffer directly — no disk write needed
            const cas_data = await parseEcas(uploaded_file.buffer, { password });

            logger.debug(`CAS report parsed successfully for User ID: ${user_id}`);

            res.status(200).json({
                code: 200,
                message: "CAS report parsed successfully",
                data: cas_data,
            });
            return;

        } catch (error: any) {
            // Surface pdf-lib / pdf-parse decryption errors as a clean 422
            if (
                error?.message?.toLowerCase().includes("password") ||
                error?.message?.toLowerCase().includes("encrypted") ||
                error?.message?.toLowerCase().includes("decrypt")
            ) {
                logger.warn(`CAS PDF decryption failed: ${error.message}`);
                next(new AppError("Incorrect PDF password or file is corrupted", 422, "CAS_DECRYPT_FAILED"));
                return;
            }

            logger.error(`Error in parse_cas_report: `, error);
            next(error);
            return;
        }
    };
}

export const cas_report_controller = new CasReportControllerClass();
