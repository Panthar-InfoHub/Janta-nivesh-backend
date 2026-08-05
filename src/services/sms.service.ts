/**
 * SMS Service for MSG91 Integration
 */

import { env } from "../lib/config-env.js";

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

    /**
     * Send OTP via MSG91
     */
    send_otp_sms = async (phoneNumber: string, otp: string): Promise<boolean> => {
        try {
            const formattedPhone = this.format_phone_no(phoneNumber);

            const payload = {
                template_id: env.MSG91_TEMPLATE_ID,
                realTimeResponse: 1,
                recipients: [
                    {
                        mobiles: formattedPhone,
                        OTP: otp, // Assuming VAR1 is the placeholder for OTP in the MSG91 template
                    },
                ],
            };


            const response = await fetch(env.MSG91_BASE_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "authkey": env.MSG91_AUTH_KEY,
                    "accept": "application/json",
                },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (result.type === "error") {
                throw new Error(result.message);
            }

            return response.ok;
        } catch (error) {
            console.error("[SMS] Error sending MSG91 OTP:", error);
            return false;
        }
    };

}


export const sms_service = new SMS_SERVICE_CLASS()