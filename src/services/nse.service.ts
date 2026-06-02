import axios from "axios";
import { env } from "../lib/config-env.js";

export class NSEServiceClass {
    finnsys_base_url: string;

    constructor() {
        this.finnsys_base_url = `${env.KYC_BASE_URL}`;
    }

    /**
     * Other NSE Service always extends to get the headers and other common functionalities. 
     * This is just a placeholder for now, can be extended in future as needed. 
     * */

    get_nse_headers = () => {
        return {
            "X-CUSTOM-MEMBER-ID": env.NSE_MEMBER_ID,
            "X-CUSTOM-API-KEY-MEMBER": env.NSE_API_KEY,
            "X-CUSTOM-API-SECRET-USER": env.NSE_API_SECRET,
            "X-CUSTOM-USERNAME": env.NSE_USERNAME,
        }
    }

    get_short_url = async (product_type: string, product_ref_id: string, user_log: string, user_pwd: string) => {
        const response = await axios.post(`${this.finnsys_base_url}/nse/v2/reports/get-short-url`, {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                "productType": product_type,
                "productRefId": product_ref_id
            }
        });

        return response.data;
    }

}

export const nse_service = new NSEServiceClass();