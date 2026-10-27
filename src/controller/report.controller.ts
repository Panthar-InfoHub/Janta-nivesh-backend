import { Request, Response, NextFunction } from "express";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { jn_report_service } from "../services/fintech-primitive/jn-report.service.js";

class ReportControllerClass {

    /**
     * GET /api/v1/report/portfolio/pdf
     * Generates and downloads the Janta Nivesh Overall Portfolio Statement PDF
     */
    get_portfolio_report_pdf = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            logger.info(`Generating Janta Nivesh Portfolio PDF for user_id=${user_id}`);

            const buffer = await jn_report_service.generate_portfolio_report_pdf(user_id);

            res.set({
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="janta-nivesh-portfolio-report-${user_id}.pdf"`,
                "Content-Length": buffer.length.toString(),
            });

            res.send(buffer);
        } catch (error) {
            logger.error(`Error generating Portfolio Report PDF: ${error instanceof Error ? error.message : String(error)}`);
            next(error);
        }
    };

    /**
     * GET /api/v1/report/fund-holding/pdf?isin=...
     * Generates and downloads the Janta Nivesh Fund Holding Report PDF for a specific scheme
     */
    get_fund_holding_report_pdf = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            const folio = (req.query.folio || req.query.folio_number)
                ? String(req.query.folio || req.query.folio_number).trim()
                : undefined;
            const isin = req.query.isin ? String(req.query.isin).trim() : undefined;
            logger.info(`Generating Janta Nivesh Fund Holding PDF for user_id=${user_id}, folio=${folio || 'any'}, isin=${isin || 'any'}`);

            const buffer = await jn_report_service.generate_fund_holding_report_pdf(user_id, { folio, isin });

            const filenameIdent = folio || isin || 'primary';
            res.set({
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="janta-nivesh-fund-holding-${filenameIdent}.pdf"`,
                "Content-Length": buffer.length.toString(),
            });

            res.send(buffer);
        } catch (error) {
            logger.error(`Error generating Fund Holding Report PDF: ${error instanceof Error ? error.message : String(error)}`);
            next(error);
        }
    };
}

export const report_controller = new ReportControllerClass();
