import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { provider_token_service } from "../tokens/provider-token.service.js";

// Always UPI for this app, same kind of product constant as gateway: "ondc" elsewhere - never
// client input. provider_name is fixed to ONDC to match the gateway the orders are created on.
const PAYMENT_METHOD = "UPI";
const PROVIDER_NAME = "ONDC";

type CreatePaymentInput = {
    /** old_id (numeric) of the orders being paid for - NOT the mfp_ string ids. */
    amc_order_ids: number[];
    /** UserBankDetails.fp_bank_account_old_id - TPV is done against this account. */
    bank_account_id: number;
    payment_postback_url?: string;
};

// Thin Fintech Primitives client for order payments. Note this is the older /api/pg/* surface
// (same generation as mandates), which keys off numeric old_ids rather than the /v2 prefixed
// string ids - see CONTEXT.md section 1. The endpoint path is literally "/netbanking" even when
// paying by UPI; `method` in the body is what selects the rail, so don't "correct" the path.
class FintechPrimitivePaymentServiceClass {

    private base_url: string;

    constructor() {
        this.base_url = env.FINTECH_PRIMITIVE_API_BASE_URL;
    }

    private async auth_headers(extra: Record<string, string> = {}) {
        const token = await provider_token_service.get_fintech_primitive_token();
        return {
            Authorization: `Bearer ${token}`,
            "x-tenant-id": env.FINTECH_PRIMITIVE_TENANT_ID,
            ...extra,
        };
    }

    /** POST /api/pg/payments/netbanking - creates the payment an order is confirmed against. */
    create_payment = async (input: CreatePaymentInput) => {
        const payload = {
            amc_order_ids: input.amc_order_ids,
            bank_account_id: input.bank_account_id,
            method: PAYMENT_METHOD,
            provider_name: PROVIDER_NAME,
            ...(input.payment_postback_url ? { payment_postback_url: input.payment_postback_url } : {}),
        };

        logger.debug("Creating FP payment", { payload });

        try {
            const response = await axios.post(`${this.base_url}/api/pg/payments/netbanking`, payload, {
                headers: await this.auth_headers({ "Content-Type": "application/json" }),
            });

            logger.debug("FP payment create response ==> ", response.data);
            return response.data;
        } catch (error: any) {
            logger.error("Error creating FP payment ==> ", error?.response?.data || error.message);
            throw new AppError("Failed to create payment", 502, "PAYMENT_CREATE_FAILED");
        }
    }
}

export const fintech_primitive_payment_service = new FintechPrimitivePaymentServiceClass();
