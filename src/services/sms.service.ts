/**
 * SMS Service for MSG91 Integration
 */

import axios from "axios";
import { env } from "../lib/config-env.js";
import logger from "../middleware/logger.js";

// const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY!;
// const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID!;
// const MSG91_BASE_URL = "https://control.msg91.com/api/v5/flow";

class SMS_SERVICE_CLASS {

    /**
     * Format phone number to include country code if missing
     * Defaults to 91 (India) if 10 digits
     */
    format_phone_no = (phoneNumber: string): string => {
        // Remove all non-numeric characters
        const cleaned = phoneNumber.replace(/\D/g, "");

        // If 10 digits, assume India and add 91
        if (cleaned.length === 10) {
            return `91${cleaned}`;
        }

        // Otherwise return as is (assuming country code is already present)
        return cleaned;
    };

    private _send_flow = async (phoneNumber: string, template_id: string, variables: Record<string, string>): Promise<boolean> => {
        try {
            const formattedPhone = this.format_phone_no(phoneNumber);

            const payload = {
                template_id,
                realTimeResponse: 1,
                short_url: "0",
                recipients: [
                    {
                        mobiles: formattedPhone,
                        ...variables,
                    },
                ],
            };

            logger.debug(`Formatted phone for msg91 sms --> `, formattedPhone);
            logger.debug(`Payload for otp --> `, payload);
            logger.debug(`Base url --> `, env.MSG91_BASE_URL);
            const response = await axios.post(
                env.MSG91_BASE_URL,
                payload,
                {
                    headers: {
                        'accept': 'application/json',
                        'content-type': 'application/json',
                        'authkey': env.MSG91_AUTH_KEY
                    }
                }
            );
            logger.debug("msg 91 response ==> ", response.data);

            if (response.data.type != "success") return false;
            return true;
        } catch (error) {
            logger.error("[SMS] Error sending MSG91 OTP:", error);
            return false;
        }
    };

    /**
     * Send Login/Auth OTP via MSG91
     */
    send_otp_sms = async (phoneNumber: string, otp: string): Promise<boolean> => {
        return this._send_flow(phoneNumber, env.MSG91_TEMPLATE_ID, { number: otp });
    };

    /**
     * Send Mutual Fund Purchase OTP via MSG91 (Lumpsum, SIP, Cart checkout)
     */
    send_purchase_otp_sms = async (phoneNumber: string, otp: string): Promise<boolean> => {
        return this._send_flow(phoneNumber, env.MSG91_MF_PURCHASE_TEMPLATE_ID, { name: otp });
    };

    /**
     * Send Mutual Fund Redemption OTP via MSG91 (One-shot, SWP, Switch)
     */
    send_redemption_otp_sms = async (phoneNumber: string, otp: string): Promise<boolean> => {
        return this._send_flow(phoneNumber, env.MSG91_MF_REDEMPTION_TEMPLATE_ID, { name: otp });
    };

}


export const sms_service = new SMS_SERVICE_CLASS()