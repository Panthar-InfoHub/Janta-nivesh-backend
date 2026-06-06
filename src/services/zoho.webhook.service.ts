import axios from "axios";
import { env } from "../lib/config-env.js";
import logger from "../middleware/logger.js";

export interface ZohoWebhookPayload {
    event_type: string;
    timestamp: string; // ISO 8601 string
    user_id?: string;
    user_phone?: string;
    inv_id?: string;
    finnsys_usr?: string;
    onboarding_stage?: number;
    is_onboarding_completed?: boolean;
    full_name?: string;
    email?: string;
    dob?: string;
    projection_years?: number;
    pdf_filename?: string;
    bundle_id?: string;
    bundle_name?: string;
    recommendation_context?: string;
    products_added?: number;
    products_total?: number;
    scheme_id?: string;
    scheme_name?: string;
    investment_type?: string;
    order_type?: string;
    payment_url?: string;
    mandate_id?: string;
    mandate_approval_url?: string;
    status?: string;
    order_id?: string;
    status_remark?: string;
    order_date?: string;
    amc?: string;
    frequency?: string | null;
    amount?: number;
    fd_transaction_id?: string;
    product_id?: string;
    issuer_name?: string;
    investment_amount?: number;
    tenure_days?: number;
    roi?: number;
    payout_frequency?: string;
    fd_account_number?: string;
    maturity_amount?: number;
    maturity_date?: string;
    maturity_instruction?: string;
    fd_issued_at?: string;
    failure_reason?: string;
    payment_tx_id?: string;
    connection_type?: string;
    message?: string;
}

class ZohoWebhookServiceClass {
    ZOHO_WEBHOOK_URL: string;
    constructor() {
        this.ZOHO_WEBHOOK_URL = 'https://flow.zoho.in/60068453967/flow/webhook/incoming'
    }

    /**
     * Send event to Zoho Webhook url
     */
    async send_event(payload: ZohoWebhookPayload) {
        try {
            if (!this.ZOHO_WEBHOOK_URL) {
                logger.warn("ZOHO_WEBHOOK_URL is not configured, skipping webhook event.");
                return;
            }

            logger.info(`Sending Zoho webhook event: ${payload.event_type} for user: ${payload.user_id}`);
            const response = await axios.post(this.ZOHO_WEBHOOK_URL, payload, {
                headers: { "Content-Type": "application/json" }
            });

            logger.debug(`Zoho webhook response: status=${response.status}`);
            return response.data;
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                logger.error(`Failed to send Zoho webhook event ${payload.event_type}: status=${error.response?.status} message=${error.message}`, {
                    responseData: error.response?.data
                });
            } else {
                logger.error(`Failed to send Zoho webhook event ${payload.event_type}:`, error);
            }
            // Non-blocking: fail silently to prevent interrupting user actions
        }
    }
}

export const zoho_webhook_service = new ZohoWebhookServiceClass();
