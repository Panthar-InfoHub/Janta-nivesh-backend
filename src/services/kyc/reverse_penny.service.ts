import axios from "axios";
import { db } from "../../server.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { user_onboarding_service } from "./user.onboarding.service.js";
import { user_bank_details_service } from "../user-bank-details.service.js";
import cuid from "cuid";

// Central Server configuration with placeholders
const DECENTRO_CENTRAL_SERVER_URL = "https://decentro-central-proxy-prod-357888765640.asia-south1.run.app";

const DECENTRO_INTERNAL_SECRET = process.env.DECENTRO_INTERNAL_SECRET;

class ReversePennyServiceClass {

    /**
     * Step 1: User clicks Reverse Penny
     * Backend hits Decentro Central Server (POST /intent) ->
     * receives intent & UPI links -> saves intent details in DB ->
     * updates onboarding to IN_PROGRESS -> returns response.
     */
    initiate = async (user_id: string, options?: { redirect_url?: string }) => {
        const user = await db.user.findUnique({
            where: { id: user_id },
            select: { id: true, full_name: true, phone_no: true },
        });

        if (!user) {
            throw new AppError("User not found", 404, "USER_NOT_FOUND");
        }

        const reference_id = cuid();

        logger.info("Calling Decentro central server to initiate reverse penny", {
            user_id,
            reference_id,
            url: `${DECENTRO_CENTRAL_SERVER_URL}/intent`,
        });

        let decentro_data: any = null;

        try {
            const response = await axios.post(
                `${DECENTRO_CENTRAL_SERVER_URL}/intent`,
                {
                    reference_id,
                    expiry_time: 60,
                    generate_qr: false,
                    generate_psp_uri: true,
                    redirect_url: options?.redirect_url,
                },
                {
                    headers: {
                        "x-internal-secret": DECENTRO_INTERNAL_SECRET,
                        "Content-Type": "application/json",
                    },
                    timeout: 15000,
                }
            );
            decentro_data = response.data;
        } catch (error: any) {
            logger.error("Decentro central server intent call failed", {
                error: error?.response?.data || error.message,
                status: error?.response?.status,
            });

            throw new AppError(
                error?.response?.data?.message || error?.response?.data?.error || "Failed to create reverse penny validation link",
                error?.response?.status || 502,
                "REVERSE_PENNY_INITIATE_FAILED"
            );
        }

        const decentro_txn_id = decentro_data?.decentro_txn_id;
        const validation_links = decentro_data?.data || {};

        if (!decentro_txn_id) {
            throw new AppError(
                "Invalid response from Decentro central server: missing decentro_txn_id",
                502,
                "DECENTRO_INVALID_RESPONSE"
            );
        }

        // Save intent and identifiers to DB
        const verification = await db.userReversePennyVerification.create({
            data: {
                user_id,
                reference_id,
                decentro_txn_id,
                status: "PENDING",
                response_code: decentro_data?.response_code ?? "S00000",
                response_key: decentro_data?.response_key ?? "success_validation_link_created",
                validation_link: validation_links.validation_link,
                gpay_uri: validation_links.gpay_uri,
                phonepe_uri: validation_links.phonepe_uri,
                paytm_uri: validation_links.paytm_uri,
                raw_initiate_response: decentro_data as any,
            },
        });

        // Update onboarding stage to IN_PROGRESS
        await user_onboarding_service.update_stage(user_id, {
            reverse_penny_status: "IN_PROGRESS",
            current_stage: "REVERSE_PENNY_VERIFICATION",
        });

        return {
            reference_id: verification.reference_id,
            decentro_txn_id: verification.decentro_txn_id,
            api_status: decentro_data?.api_status ?? "SUCCESS",
            response_code: verification.response_code,
            message: decentro_data?.message ?? "Validation Link created Successfully.",
            data: validation_links,
            response_key: verification.response_key,
        };
    };

    /**
     * Step 2: Query Transaction Status
     * Takes decentro_txn_id from frontend or queries latest from DB ->
     * hits Decentro central server status endpoint (GET /status/:txnId) ->
     * saves transaction status & bank info in DB ->
     * if SUCCESS: auto pre-fills UserBankDetails & advances stage to PENNY_DROP_VERIFICATION.
     */
    check_status = async (
        user_id: string,
        params?: { decentro_txn_id?: string; reference_id?: string }
    ) => {
        // Resolve verification record from DB
        let verification = null;

        if (params?.decentro_txn_id) {
            verification = await db.userReversePennyVerification.findFirst({
                where: { user_id, decentro_txn_id: params.decentro_txn_id },
            });
        } else if (params?.reference_id) {
            verification = await db.userReversePennyVerification.findFirst({
                where: { user_id, reference_id: params.reference_id },
            });
        }

        if (!verification) {
            verification = await db.userReversePennyVerification.findFirst({
                where: { user_id },
                orderBy: { createdAt: "desc" },
            });
        }

        if (!verification) {
            throw new AppError(
                "No reverse penny record found. Initiate verification first.",
                404,
                "REVERSE_PENNY_NOT_FOUND"
            );
        }

        const decentro_txn_id = params?.decentro_txn_id || verification.decentro_txn_id;

        if (!decentro_txn_id) {
            throw new AppError(
                "Missing decentro_txn_id for status check",
                400,
                "DECENTRO_TXN_ID_REQUIRED"
            );
        }

        logger.info("Calling Decentro central server for transaction status", {
            user_id,
            decentro_txn_id,
            url: `${DECENTRO_CENTRAL_SERVER_URL}/status/${decentro_txn_id}`,
        });

        let status_response: any = null;

        try {
            const response = await axios.get(
                `${DECENTRO_CENTRAL_SERVER_URL}/status/${decentro_txn_id}`,
                {
                    headers: {
                        "x-internal-secret": DECENTRO_INTERNAL_SECRET,
                    },
                    timeout: 15000,
                }
            );
            status_response = response.data;
        } catch (error: any) {
            logger.error("Decentro central server status call failed", {
                decentro_txn_id,
                error: error?.response?.data || error.message,
                status: error?.response?.status,
            });

            throw new AppError(
                error?.response?.data?.message || error?.response?.data?.error || "Failed to fetch reverse penny transaction status",
                error?.response?.status || 502,
                "REVERSE_PENNY_STATUS_FAILED"
            );
        }

        const status_data = status_response?.data || status_response;
        const transaction_status = status_data?.transaction_status;

        // Save status and bank info to DB
        const updated_verification = await db.userReversePennyVerification.update({
            where: { id: verification.id },
            data: {
                request_decentro_txn_id: status_data?.request_decentro_txn_id || decentro_txn_id,
                status: transaction_status || "PENDING",
                status_description: status_data?.transaction_status_description,
                bank_reference_number: status_data?.bank_reference_number,
                npci_txn_id: status_data?.npci_txn_id,
                provider_message: status_data?.provider_message,
                payer_account_ifsc: status_data?.payer_account_ifsc,
                payer_account_number: status_data?.payer_account_number,
                payer_account_type: status_data?.payer_account_type,
                payer_name: status_data?.payer_name,
                payer_vpa: status_data?.payer_vpa,
                error_key: status_data?.error_key,
                transaction_auth_timestamp: status_data?.transaction_authentication_timestamp
                    ? new Date(status_data.transaction_authentication_timestamp)
                    : new Date(),
                raw_status_response: status_response as any,
            },
        });

        // On SUCCESS: Save verified details into UserBankDetails for Penny Drop prefill & advance stage
        if (transaction_status === "SUCCESS") {
            if (status_data?.payer_account_number && status_data?.payer_account_ifsc) {
                await user_bank_details_service.save_from_reverse_penny(user_id, {
                    account_number: status_data.payer_account_number,
                    ifsc_code: status_data.payer_account_ifsc,
                    account_holder_name: status_data.payer_name,
                    account_type: status_data.payer_account_type,
                    bank_reference_number: status_data.bank_reference_number,
                    raw_response: status_data,
                });
            }

            await user_onboarding_service.update_stage(user_id, {
                reverse_penny_status: "VERIFIED",
                current_stage: "PENNY_DROP_VERIFICATION",
            });
            await user_onboarding_service.recompute_completion(user_id);
        } else if (
            transaction_status === "FAILED" ||
            transaction_status === "EXPIRED"
        ) {
            await user_onboarding_service.update_stage(user_id, {
                reverse_penny_status: "FAILED",
            });
        }

        const onboarding = await user_onboarding_service.get_status_summary(user_id);

        return {
            status: updated_verification.status,
            status_description: updated_verification.status_description,
            data: status_data,
            onboarding,
        };
    };

    /**
     * Helper: Returns pre-filled bank details captured from Reverse Penny.
     */
    get_prefill = async (user_id: string) => {
        const successful_rp = await db.userReversePennyVerification.findFirst({
            where: { user_id, status: "SUCCESS" },
            orderBy: { updatedAt: "desc" },
        });

        if (successful_rp?.payer_account_number && successful_rp?.payer_account_ifsc) {
            return {
                has_prefilled: true,
                account_number: successful_rp.payer_account_number,
                ifsc_code: successful_rp.payer_account_ifsc,
                account_holder_name: successful_rp.payer_name,
                account_type: successful_rp.payer_account_type || "SAVINGS",
                payer_vpa: successful_rp.payer_vpa,
                bank_name: null,
                bank_reference_number: successful_rp.bank_reference_number,
                source: "REVERSE_PENNY",
            };
        }

        const bank = await user_bank_details_service.get_primary(user_id);
        if (bank) {
            return {
                has_prefilled: true,
                account_number: bank.account_no,
                ifsc_code: bank.ifsc_code,
                account_holder_name: bank.account_holder_name,
                account_type: bank.account_type || "SAVINGS",
                payer_vpa: null,
                bank_name: bank.bank_name,
                bank_reference_number: bank.provider_reference_id,
                source: bank.verification_method || "BANK_DETAILS",
            };
        }

        return {
            has_prefilled: false,
            account_number: null,
            ifsc_code: null,
            account_holder_name: null,
            account_type: null,
            payer_vpa: null,
            bank_name: null,
            bank_reference_number: null,
            source: null,
        };
    };
}

export const reverse_penny_service = new ReversePennyServiceClass();
