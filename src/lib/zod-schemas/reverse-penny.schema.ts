import { z } from "zod";

export const decentro_status_item_schema = z.object({
    reference_id: z.string().optional(),
    request_decentro_txn_id: z.string().optional(),
    transaction_status: z.string().optional(), // SUCCESS | PENDING | FAILED | EXPIRED | DEEMED | DISPUTED_AMOUNT | REQUEST_INITIALIZED
    transaction_status_description: z.string().optional(),
    bank_reference_number: z.string().optional(),
    npci_txn_id: z.string().optional(),
    provider_message: z.string().optional(),
    transaction_authentication_timestamp: z.string().optional(),
    payer_account_ifsc: z.string().optional(),
    payer_account_number: z.string().optional(),
    payer_account_type: z.string().optional(),
    payer_name: z.string().optional(),
    payer_vpa: z.string().optional(),
    error_key: z.string().optional(),
    purpose_message: z.string().optional(),
});

export const reverse_penny_initiate_input_schema = z.object({
    redirect_url: z.string().optional(),
    expiry_time: z.number().optional(),
    generate_qr: z.boolean().optional(),
    generate_psp_uri: z.boolean().optional(),
}).passthrough();

export type ReversePennyInitiateInput = z.infer<typeof reverse_penny_initiate_input_schema>;

export const reverse_penny_save_intent_schema = z.object({
    decentro_txn_id: z.string().optional(),
    api_status: z.string().optional(),
    response_code: z.string().optional(),
    message: z.string().optional(),
    reference_id: z.string().optional(),
    data: z.object({
        validation_link: z.string().optional(),
        gpay_uri: z.string().optional(),
        phonepe_uri: z.string().optional(),
        paytm_uri: z.string().optional(),
        reference_id: z.string().optional(),
    }).optional(),
    response_key: z.string().optional(),
}).passthrough();

export type ReversePennySaveIntentInput = z.infer<typeof reverse_penny_save_intent_schema>;

export const reverse_penny_status_input_schema = z.object({
    // Can receive directly or wrapped under data: { ... }
    reference_id: z.string().optional(),
    decentro_txn_id: z.string().optional(),
    request_decentro_txn_id: z.string().optional(),
    transaction_status: z.string().optional(),
    transaction_status_description: z.string().optional(),
    bank_reference_number: z.string().optional(),
    npci_txn_id: z.string().optional(),
    provider_message: z.string().optional(),
    transaction_authentication_timestamp: z.string().optional(),
    payer_account_ifsc: z.string().optional(),
    payer_account_number: z.string().optional(),
    payer_account_type: z.string().optional(),
    payer_name: z.string().optional(),
    payer_vpa: z.string().optional(),
    error_key: z.string().optional(),
    purpose_message: z.string().optional(),
    data: decentro_status_item_schema.optional(),
}).passthrough();

export type ReversePennyStatusInput = z.infer<typeof reverse_penny_status_input_schema>;

export const prefill_bank_details_response_schema = z.object({
    has_prefilled: z.boolean(),
    account_number: z.string().nullable(),
    ifsc_code: z.string().nullable(),
    account_holder_name: z.string().nullable(),
    account_type: z.string().nullable(),
    payer_vpa: z.string().nullable(),
    bank_name: z.string().nullable(),
    bank_reference_number: z.string().nullable(),
    source: z.string().nullable(),
});

export type PrefillBankDetailsResponse = z.infer<typeof prefill_bank_details_response_schema>;
