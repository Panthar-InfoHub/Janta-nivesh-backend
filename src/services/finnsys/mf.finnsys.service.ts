import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import axios from "axios";
import AppError from "../../middleware/error.middleware.js";
import { nse_service } from "../nse.service.js";

interface PurchasePayload {
    data: {
        transaction_details: Array<{
            order_ref_number: string;
            scheme_code: string;
            trxn_type: string;
            buy_sell_type: string;
            client_code: string;
            demat_physical: string;
            order_amount: string;
            folio_no: string;
            remarks: string;
            kyc_flag: string;
            sub_broker_code: string;
            euin_number: string;
            euin_declaration: string;
            min_redemption_flag: string;
            dpc_flag: string;
            all_units: string;
            redemption_units: string;
            sub_broker_arn: string;
            bank_ref_no: string;
            account_no: string;
            mobile_no: string;
            email: string;
            mandate_id: string;
        }>;
    };
}

class MutualFundFinnsysServiceClass {

    FINNSYS_BASE_URL: string;
    constructor() {
        this.FINNSYS_BASE_URL = env.KYC_BASE_URL
    }

    /**
     * Execute lumpsum purchase order via Finnsys NSE API
     * @param payload - Purchase payload with transaction details
     * @returns API response from Finnsys
     */
    purchase_lumpsum_finnsys = async (payload: PurchasePayload) => {
        try {
            logger.info(`Submitting lumpsum purchase order to Finnsys. Transactions: ${payload.data.transaction_details.length}`);
            logger.debug(`Purchase payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/transaction/purchase-redemption-order`,
                payload,
            );

            logger.info("Lumpsum purchase order submitted successfully");
            logger.debug(`Purchase response: `, response.data);

            return response.data;
        } catch (error: any) {
            logger.error("Error submitting lumpsum purchase order to Finnsys: ", error);

            if (error.response?.data) {
                throw new AppError(
                    error.response.data?.message || "Failed to submit purchase order",
                    error.response.status || 500,
                    "PURCHASE_ORDER_FAILED"
                );
            }

            throw new AppError(
                "Failed to submit purchase order to Finnsys",
                500,
                "PURCHASE_ORDER_ERROR"
            );
        }
    }

    /**
     * Execute redemption order via Finnsys NSE API.
     * Uses the same unified endpoint as purchase but with trxn_type "R".
     */
    redeem_finnsys = async (payload: PurchasePayload) => {
        try {
            logger.info(`Submitting redemption order to Finnsys. Transactions: ${payload.data.transaction_details.length}`);
            logger.debug(`Redeem payload ==> `, payload);


            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/transaction/purchase-redemption-order`,
                payload,
            );

            logger.info("Redemption order submitted to Finnsys successfully");
            logger.debug(`Redeem response: `, response.data);

            return response.data;
        } catch (error: any) {
            logger.error("Error submitting redemption order to Finnsys: ", error);

            if (error.response?.data) {
                throw new AppError(
                    error.response.data?.message || "Failed to submit redemption order",
                    error.response.status || 500,
                    "REDEEM_ORDER_FAILED"
                );
            }

            throw new AppError(
                "Failed to submit redemption order to Finnsys",
                500,
                "REDEEM_ORDER_ERROR"
            );
        }
    }

}
export const mutual_fund_finnsys_service = new MutualFundFinnsysServiceClass();