import { Request, Response, NextFunction } from "express";
import logger from "../middleware/logger.js";
import { report_finnsys_service } from "../services/finnsys/report.finnsys.service.js";
import { report_export_query_schema, type ReportExportQueryInput } from "../schemas/report.schema.js";
import AppError from "../middleware/error.middleware.js";
import { jn_report_service } from "../services/fintech-primitive/jn-report.service.js";

type ReportTypeMap = {
    [key: string]: string;
};

class ReportControllerClass {

    private report_type_mapping: ReportTypeMap = {
        "capital": "capital",
        "portfolio": "portfolio",
        "tax": "tax",
        "soa": "soa"
    };

    private map_report_type_to_rename(report_type: string): string {
        const mapped = this.report_type_mapping[report_type.toLowerCase()];
        if (!mapped) {
            throw new AppError(`Invalid report type: ${report_type}`, 400, "INVALID_REPORT_TYPE");
        }
        return mapped;
    }

    /**
     * Legacy Finnsys export endpoint
     */
    export_report = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const query_params = req.query;

            logger.info(`Exporting report for User ID: ${user.id}. Query params: ${JSON.stringify(query_params)}`);

            // Parse and validate query parameters
            let validated_query: ReportExportQueryInput;
            try {
                validated_query = report_export_query_schema.parse(query_params);
            } catch (validation_error) {
                logger.error(`Query validation failed ==> `, validation_error);
                throw new AppError("Invalid query parameters", 400, "INVALID_QUERY_PARAMS");
            }

            // Extract credentials from user session
            const user_log = user.log;
            const user_pwd = user.pwd;
            const invester_id = user.inv_id;

            // Map report type to Finnsys rename parameter
            const rename = this.map_report_type_to_rename(validated_query.type);

            // Call Finnsys service
            logger.debug(`Calling report finnsys service with type: ${validated_query.type}, rename: ${rename}`);

            const report_data = await report_finnsys_service.export_report({
                log: user_log,
                pwd: user_pwd,
                repname: rename,
                year: validated_query.year,
                investor_id: invester_id,
                group_id: validated_query.group_id,
                folio: validated_query.folio,
                expand: validated_query.expand
            });

            logger.info(`Report exported successfully for User ID: ${user.id}, type: ${validated_query.type}`);

            res.status(200).json({
                code: 200,
                message: `${validated_query.type} report exported successfully`,
                data: report_data
            });

            return;

        } catch (error) {
            logger.error(`Error in export_report: `, error);
            next(error);
            return;
        }
    };

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
