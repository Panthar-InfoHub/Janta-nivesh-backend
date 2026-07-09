import axios from "axios";
import { env } from "../lib/config-env.js";
import { generate_nse_mfdesk_auth_header } from "../lib/nse-mfdesk-auth.util.js";
import logger from "../middleware/logger.js";

export interface ClientKycReportPayload {
    pan_no?: string;
    client_code?: string;
    from_date?: string;
    to_date?: string;
}

class NSEMfdeskServiceClass {
    base_url = 'https://nseinvestuat.nseindia.com';

    get_headers = () => {
        return {
            "Content-Type": "application/json",
            memberId: env.NSE_MFDESK_MEMBER_ID,
            Authorization: `BASIC ${generate_nse_mfdesk_auth_header()}`,
        };
    };

    get_client_kyc_status_report = async (payload: ClientKycReportPayload) => {

        logger.debug(`Inside get client kyc status report`);
        logger.debug(payload);

        logger.debug(`Base url ==> ${this.base_url}`)

        logger.debug(`Nse headers ==> `, this.get_headers())

        const response = await axios.post(
            `${this.base_url}/nsemfdesk/api/v2/reports/CLIENT_KYC_REPORT`,
            payload,
            { headers: this.get_headers() }
        );

        logger.debug("NSE MFDESK Client KYC Status report ==> ", response.data);
        return response.data;
    };
}

export const nse_mfdesk_service = new NSEMfdeskServiceClass();
