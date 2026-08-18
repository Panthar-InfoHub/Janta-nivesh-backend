/**
 * Email Service for MSG91 Integration
 */

import axios from "axios";
import { env } from "../lib/config-env.js";
import logger from "../middleware/logger.js";

class EMAIL_SERVICE_CLASS {

    /**
     * Send OTP via MSG91 email API (template jn_email_otp_v1).
     *
     * The `variables` keys must match the {{...}} placeholders in the panel template exactly,
     * case included - {{otp}} and {{expiry_minutes}}. A key that doesn't match doesn't error,
     * it just leaves the placeholder rendered literally in the delivered email.
     *
     * Note the payload shape: MSG91's email API nests recipients + their variables under
     * `recipients[]`, unlike the flat SMS flow payload in sms.service.ts.
     */
    send_otp_email = async (email: string, otp: string, expiry_minutes: number, name?: string): Promise<boolean> => {
        try {
            const payload = {
                recipients: [
                    {
                        to: [{ email, name: name || email }],
                        variables: {
                            otp,
                            expiry_minutes: expiry_minutes.toString(),
                        },
                    },
                ],
                from: { email: env.MSG91_FROM_EMAIL },
                domain: env.MSG91_EMAIL_DOMAIN,
                template_id: env.MSG91_EMAIL_TEMPLATE_ID,
            };

            logger.debug(`Payload for email otp --> `, payload)
            logger.debug(`Email url --> `, env.MSG91_EMAIL_URL)
            const response = await axios.post(
                env.MSG91_EMAIL_URL,
                payload,
                {
                    headers: {
                        'accept': 'application/json',
                        'content-type': 'application/json',
                        'authkey': env.MSG91_AUTH_KEY
                    }
                }
            );
            logger.debug("msg 91 email response ==> ", response.data)

            if (response.data?.status !== "success") return false
            return true
        } catch (error) {
            logger.error("[EMAIL] Error sending MSG91 OTP:", error);
            return false;
        }
    };

}


export const email_service = new EMAIL_SERVICE_CLASS()
