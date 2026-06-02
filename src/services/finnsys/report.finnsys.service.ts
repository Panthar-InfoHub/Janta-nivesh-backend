import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";

type ReportExportParams = {
    log: string;
    pwd: string;
    repname: string; // 'capital' | 'portfolio' | 'tax' | 'soa'
    year?: number;
    investor_id?: number;
    group_id?: number;
    folio?: string;
    expand?: number;
}

class ReportFinnsysServiceClass {

    private finnsys_base_url: string;

    constructor() {
        this.finnsys_base_url = `${env.finsys_base_api}`;
    }

    export_report = async (params: ReportExportParams) => {
        try {
            logger.info(`Exporting ${params.repname} report for user ${params.log}`);
            logger.debug(`Report export params ==> `, params);

            const res = await axios.get(`${this.finnsys_base_url}/finnsys/app/api.pdf.php`, {
                params: {
                    log: params.log,
                    pwd: params.pwd,
                    repname: params.repname,
                    usrtyp: 'I',
                    ...(params.year && { year: params.year }),
                    ...(params.investor_id && { investor_id: params.investor_id }),
                    ...(params.group_id && { group_id: params.group_id }),
                    ...(params.folio && { folio: params.folio }),
                    ...(params.expand !== undefined && { expand: params.expand })
                }
            });

            logger.debug(`Report export successful for user ${params.log}. Response type: ${typeof res.data}`);
            return res.data;

        } catch (error) {
            logger.error(`Error exporting ${params.repname} report from Finnsys ==> `, error);
            throw error;
        }
    }
}

export const report_finnsys_service = new ReportFinnsysServiceClass();
