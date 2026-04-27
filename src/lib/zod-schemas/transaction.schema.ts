import { z } from "zod";

export const PurchaseTransactionSchema = z.object({
    data: z.object({
        transaction_details: z.array(z.object({
            order_ref_number: z.string().optional(),
            scheme_code: z.string(),
            trxn_type: z.string().default("P"),
            buy_sell_type: z.string().default("FRESH"),
            client_code: z.string(),
            demat_physical: z.enum(["P", "D"]).default("P"),
            order_amount: z.string(), // or number? Finnsys usually expects string
            folio_no: z.string().optional().default(""),
            remarks: z.string().optional().default(""),
            kyc_flag: z.string().default("Y"),
            sub_broker_code: z.string().optional().default(""),
            euin_number: z.string().optional().default(""),
            euin_declaration: z.enum(["Y", "N"]).default("Y"),
            min_redemption_flag: z.enum(["Y", "N"]).default("N"),
            dpc_flag: z.enum(["Y", "N"]).default("Y"),
            all_units: z.enum(["Y", "N"]).default("N"),
            redemption_units: z.string().optional().default(""),
            sub_broker_arn: z.string().optional().default(""),
            bank_ref_no: z.string().optional().default(""),
            account_no: z.string().optional(),
            mobile_no: z.string().optional(),
            email: z.string().email().optional(),
            mandate_id: z.string().optional().default(""),
            
            // SIP Specific fields
            sip_st_date: z.string().optional(),
            sip_en_date: z.string().optional(),
            sip_freq: z.string().optional(),
            sip_day: z.string().optional(),
            sip_amt: z.string().optional(),

        }))
    })
});

export type PurchaseTransactionInput = z.infer<typeof PurchaseTransactionSchema>;
