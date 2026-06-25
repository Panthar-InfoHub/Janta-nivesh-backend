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

interface MandateRegistrationPayload {
    arn: string;
    username: string;
    password: string;
    data: {
        reg_data: Array<{
            client_code: string;
            amount: string;
            mandate_type: "E";
            account_no: string;
            ac_type: string;
            ifsc_code: string;
            micr_code: string;
            start_date: string;
            end_date: string;
            member_mandate_no: string;
        }>;
    };
}

interface MandateStatusPayload {
    arn: string;
    username: string;
    password: string;
    data: {
        mandate_id: string;
        client_code: string;
    };
}

interface XSIPRegistrationPayload {
    arn: string;
    username: string;
    password: string;
    data: {
        reg_data: Array<{
            amc_code: string;
            sch_code: string;
            client_code: string;
            bank_ref_no: string;
            trans_mode: string;
            dp_txn_mode: string;
            start_date: string;
            frequency_type: string;
            frequency_allowed: string;
            installment_amount: string;
            status: string;
            member_code: string;
            folio_no: string;
            sip_remarks: string;
            installment_no: number;
            xsip_mandate_id: string;
            sub_broker_code: string;
            euin_number: string;
            euin_declaration: string;
            dpc_flag: string;
            first_order_today: string;
            sub_broker_arn: string;
            end_date: string;
            primary_holder_mobile: string;
            primary_holder_email: string;
            step_up_required: string;
            step_up_start_date: string;
            step_up_end_date: string;
            step_up_frequency: string;
            step_up_amount: string;
            filler_1: string;
            filler_2: string;
            filler_3: string;
            filler_4: string;
            filler_5: string;
        }>;
    };
}

interface CancelOrderPayload {
    arn: string;
    username: string;
    password: string;
    data: {
        can_data: Array<{
            client_code: string;
            order_no: string;
            remarks?: string;
        }>;
    };
}

interface CancelXSIPPayload {
    arn: string;
    username: string;
    password: string;
    data: {
        can_data: Array<{
            client_code: string;
            xsip_reg_no: string;
            remarks?: string;
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
    purchase_finnsys = async (payload: PurchasePayload) => {
        try {
            logger.info(`Submitting purchase order to Finnsys. Transactions: ${payload.data.transaction_details.length}`);
            // logger.debug(`Purchase payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/transaction/purchase-redemption-order`,
                payload,
            );

            // code 1 = full success, code 2 = partial success (some orders placed, some rejected)
            if (response.data?.code === 2) {
                logger.warn(`Partial success from Finnsys: ${response.data?.message}`);
                return response.data; // still return so caller can generate payment link for successful orders
            }

            if (response.data?.code !== 1) {
                logger.error("Finnsys API returned a full failure: ", response.data);
                throw new AppError(
                    response.data?.message || "Failed to create orders",
                    500,
                    "FINNSYS_ORDER_FAILED"
                );
            }

            logger.info("Purchase order submitted successfully");
            logger.debug(`Purchase response: `, response.data);

            return response.data;
        } catch (error: any) {
            logger.error("Error submitting purchase order to Finnsys: ", error.response.data);

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

    /**
     * Create mandate registration for SIP via Finnsys NSE API
     * @param payload - Mandate registration payload with ARN, credentials, and registration details
     * @returns API response containing mandate_id
     */
    create_mandate_registration = async (payload: MandateRegistrationPayload) => {
        try {
            logger.info(`Submitting mandate registration to Finnsys. Client: ${payload.data.reg_data[0]?.client_code}`);
            logger.debug(`Mandate registration payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/registration/mandate-registration`,
                payload,
            );

            if (response.data?.code !== 1) {
                logger.error("Finnsys mandate registration API returned failure: ", response.data);
                throw new AppError(
                    response.data?.message || "Failed to create mandate",
                    500,
                    "MANDATE_REGISTRATION_FAILED"
                );
            }

            logger.info("Mandate registration submitted successfully");
            logger.debug(`Mandate registration response: `, response.data);

            return response.data;
        } catch (error: any) {
            logger.error("Error submitting mandate registration to Finnsys: ", error);

            if (error.response?.data) {
                throw new AppError(
                    error.response.data?.message || "Failed to register mandate",
                    error.response.status || 500,
                    "MANDATE_REGISTRATION_FAILED"
                );
            }

            throw new AppError(
                "Failed to register mandate with Finnsys",
                500,
                "MANDATE_REGISTRATION_ERROR"
            );
        }
    }

    /**
     * Check mandate status via Finnsys NSE API
     * @param payload - Mandate status check payload with mandate_id and client_code
     * @returns API response containing mandate status
     */
    check_mandate_status = async (payload: MandateStatusPayload) => {
        try {
            logger.info(`Checking mandate status. Mandate ID: ${payload.data.mandate_id}`);
            logger.debug(`Mandate status payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/reports/mandate-status-report`,
                payload,
            );

            logger.info("Mandate status retrieved successfully");
            logger.debug(`Mandate status response: `, response.data);

            return response.data;
        } catch (error: any) {
            logger.error("Error checking mandate status from Finnsys: ", error);

            if (error.response?.data) {
                throw new AppError(
                    error.response.data?.message || "Failed to check mandate status",
                    error.response.status || 500,
                    "MANDATE_STATUS_CHECK_FAILED"
                );
            }

            throw new AppError(
                "Failed to check mandate status with Finnsys",
                500,
                "MANDATE_STATUS_ERROR"
            );
        }
    }

    /**
     * Create xSIP purchase via Finnsys NSE API
     * @param payload - xSIP registration payload with mandate-based order details
     * @returns API response containing order IDs
     */
    create_xsip_purchase = async (payload: XSIPRegistrationPayload) => {
        try {
            logger.info(`Submitting xSIP registration to Finnsys. Orders: ${payload.data.reg_data.length}`);
            logger.debug(`xSIP payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/registration/xsip-registration`,
                payload,
            );

            if (response.data?.code !== 1) {
                logger.error("Finnsys xSIP API returned failure: ", response.data);
                throw new AppError(
                    response.data?.message || "Failed to create xSIP orders",
                    400,
                    "XSIP_CREATION_FAILED"
                );
            }

            logger.info("xSIP registration submitted successfully");
            logger.debug(`xSIP response: `, response.data);

            return response.data;
        } catch (error: any) {
            // If the error is already an AppError (like from the code !== 1 check above), bubble it up directly!
            if (error instanceof AppError) {
                throw error;
            }

            // Safe navigation to prevent TypeError if error.response is undefined
            logger.error("Error submitting xSIP registration to Finnsys: ", error.response?.data || error.message);

            if (error.response?.data) {
                throw new AppError(
                    error.response.data?.message || "Failed to submit xSIP orders",
                    error.response.status || 500,
                    "XSIP_CREATION_FAILED"
                );
            }

            throw new AppError(
                "Failed to create xSIP orders with Finnsys",
                500,
                "XSIP_CREATION_ERROR"
            );
        }
    }

    /**
     * Get order status report for provisional/confirmed lumpsum orders
     */
    get_order_status_report = async (payload: any) => {
        try {
            logger.info(`Fetching order status report from Finnsys for type: ${payload.type}`);
            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/reports/order-status-report`,
                payload
            );

            logger.debug("Order status report response from Finnsys: ", response.data);

            return response.data;
        } catch (error: any) {
            logger.error("Error fetching order status report from Finnsys", error);
            throw new AppError("Failed to fetch order status report", 500, "ORDER_STATUS_REPORT_ERROR");
        }
    }

    /**
     * Get xSIP registration report
     */
    get_xsip_registration_report = async (payload: any) => {
        try {
            logger.info(`Fetching xSIP registration report from Finnsys`);
            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/reports/xsip-registration-report`,
                payload
            );

            // logger.debug("xSIP registration report response from Finnsys: ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error fetching xsip registration report from Finnsys", error);
            throw new AppError("Failed to fetch xsip registration report", 500, "XSIP_REPORT_ERROR");
        }
    }
    /**
     * Cancel an existing order via Finnsys NSE API
     */
    cancel_order_finnsys = async (payload: CancelOrderPayload) => {
        try {
            logger.info(`Submitting order cancellation to Finnsys. Order No: ${payload.data.can_data[0]?.order_no}`);
            logger.debug(`Cancel order payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/cancellation/order-cancellation`,
                payload
            );

            if (response.data?.code !== 1) {
                logger.error("Finnsys order cancellation API returned failure: ", response.data);
                const errorMessage = response.data?.data?.can_data?.[0]?.can_remark
                    || response.data?.message
                    || "Failed to cancel order";
                throw new AppError(
                    errorMessage,
                    500,
                    "ORDER_CANCELLATION_FAILED"
                );
            }

            logger.info("Order cancellation submitted successfully");
            logger.debug(`Cancel order response: `, response.data);

            return response.data;
        } catch (error: any) {
            if (error instanceof AppError) {
                throw error;
            }

            logger.error("Error submitting order cancellation to Finnsys: ", error);

            if (error.response?.data) {
                const errorMessage = error.response.data?.data?.can_data?.[0]?.can_remark
                    || error.response.data?.message
                    || "Failed to cancel order";
                throw new AppError(
                    errorMessage,
                    error.response.status || 500,
                    "ORDER_CANCELLATION_FAILED"
                );
            }

            throw new AppError(
                "Failed to cancel order with Finnsys",
                500,
                "ORDER_CANCELLATION_ERROR"
            );
        }
    }

    /**
     * Cancel an existing xSIP via Finnsys NSE API
     */
    cancel_xsip_finnsys = async (payload: CancelXSIPPayload) => {
        try {
            logger.info(`Submitting xSIP cancellation to Finnsys. xSIP Reg No: ${payload.data.can_data[0]?.xsip_reg_no}`);
            logger.debug(`Cancel xSIP payload ==> `, payload);

            const response = await axios.post(
                `${this.FINNSYS_BASE_URL}/nse/v2/cancellation/xsip-cancellation`,
                payload
            );

            if (response.data?.code !== 1) {
                logger.error("Finnsys xSIP cancellation API returned failure: ", response.data);
                const errorMessage = response.data?.data?.can_data?.[0]?.can_remark
                    || response.data?.message
                    || "Failed to cancel xSIP";
                throw new AppError(
                    errorMessage,
                    500,
                    "XSIP_CANCELLATION_FAILED"
                );
            }

            logger.info("xSIP cancellation submitted successfully");
            logger.debug(`Cancel xSIP response: `, response.data);

            return response.data;
        } catch (error: any) {
            if (error instanceof AppError) {
                throw error;
            }

            logger.error("Error submitting xSIP cancellation to Finnsys: ", error);

            if (error.response?.data) {
                const errorMessage = error.response.data?.data?.can_data?.[0]?.can_remark
                    || error.response.data?.message
                    || "Failed to cancel xSIP";
                throw new AppError(
                    errorMessage,
                    error.response.status || 500,
                    "XSIP_CANCELLATION_FAILED"
                );
            }

            throw new AppError(
                "Failed to cancel xSIP with Finnsys",
                500,
                "XSIP_CANCELLATION_ERROR"
            );
        }
    }

}
export const mutual_fund_finnsys_service = new MutualFundFinnsysServiceClass();