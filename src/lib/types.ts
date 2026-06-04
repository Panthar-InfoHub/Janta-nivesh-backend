import { UserGetPayload } from "../prisma/generated/prisma/models.js";
import { z } from "zod";

export interface DeviceDetails {
    dtyp: "A" | "I";
    dver: string;
    dbn: string;
    did: string;
}

export interface AuthResponse {
    code: number;
    results?: any;
}

export type UserWithAllData = UserGetPayload<{
    include: {
        user_finance: true
        user_assets: true
        user_insurance: true
        user_loan: true
        user_goals: true
        kyc_types: true
        mfKycIdentities: true
    }
}>

export type UserFireReportData = UserGetPayload<{
    include: {
        user_finance: true;
        user_assets: {
            select: {
                id: true;
                user_id: true;
                mutual_funds: true;
                stocks: true;
                fd: true;
                gold: true;
                cash_saving: true;
            };
        };
        user_insurance: true;
        user_loan: true;
        user_goals: true;
    };
}>;

export const lumpsum_cart_zod_schema = z.object({
    amc_code: z.string().min(1),
    amc_name: z.string().min(1),
    prod_code: z.string().min(1),
    prod_name: z.string().min(1),
    folio: z.string().optional(),
    reinv_flag: z.enum(["N", "Y", "Z"]).optional(),
    txn_amount: z.number().positive(),
    schm_id: z.number().optional(),
});

export type Lumpsum_cart_data = z.infer<typeof lumpsum_cart_zod_schema>

export const sip_cart_zod_schema = z.object({

    // sip_freq Varchar(2) N DZ: Daily
    // D: Daily
    // OM: Monthly
    // Q: Quarterly
    // WD: Weekly
    // OW: Once a Week
    // H: Half Yearly
    // Y: Yearly

    amc_code: z.string().min(1),
    amc_name: z.string().min(1),
    prod_code: z.string().min(1),
    prod_name: z.string().min(1),
    folio: z.string().optional(),
    reinv_flag: z.enum(["N", "Y", "Z"]).optional(),
    txn_amount: z.number().positive(),
    sip_st_date: z.string().refine((date) => {
        const now = new Date();
        const inputDate = new Date(date);
        return inputDate.getTime() - now.getTime() >= 30 * 24 * 60 * 60 * 1000; // At least 30 days in the future, Finnsys limitation
    }, {
        message: "SIP start date must be at least 30 days in the future"
    }),
    sip_en_date: z.string().refine((date) => {
        const inputDate = new Date(date);
        const maxDate = new Date("2099-12-31");
        return inputDate <= maxDate; // Must be on or before December 31, 2099 : Finnsys limitation
    }, {
        message: "SIP end date must be on or before December 31, 2099"
    }),
    sip_freq: z.enum(["DZ", "D", "OM", "Q", "WD", "OW", "H", "Y"]),
    sip_day: z.number(),
    sip_amt: z.number().positive(),
    schm_id: z.number().optional(),
});

export type Sip_cart_data = z.infer<typeof sip_cart_zod_schema>

// ─── Redemption ───────────────────────────────────────────────────────────────

// Base partial/full fields shared by both sources
const redeem_partial_fields = z.object({
    redem_type: z.literal("PARTIAL"),
    folio_no: z.string().min(1, "folio_no is required"),
    redemption_units: z.number().positive("redemption_units must be positive").nullable().optional(),
    redemption_amount: z.number().positive("redemption_amount must be positive").nullable().optional(),
}).refine(
    (data) => data.redemption_units || data.redemption_amount,
    { message: "Either redemption_units or redemption_amount must be provided" }
);

const redeem_full_fields = z.object({
    redem_type: z.literal("FULL"),
    folio_no: z.string().min(1, "folio_no is required"),
});

// Path 1: from Transaction/Holdings — frontend has schemeid (number)
export const redeem_from_transaction_schema = z.discriminatedUnion("redem_type", [
    redeem_full_fields.extend({ source: z.literal("transaction"), scheme_id: z.number().int().positive() }),
    redeem_partial_fields.extend({ source: z.literal("transaction"), scheme_id: z.number().int().positive() }),
]);

// Path 2: from Cart — frontend has prod_code (Finnsys code string directly)
export const redeem_from_cart_schema = z.discriminatedUnion("redem_type", [
    redeem_full_fields.extend({ source: z.literal("cart"), prod_code: z.string().min(1, "prod_code is required") }),
    redeem_partial_fields.extend({ source: z.literal("cart"), prod_code: z.string().min(1, "prod_code is required") }),
]);

// Combined schema — discriminate by source first
export const redeem_request_zod_schema = z.union([
    redeem_from_transaction_schema,
    redeem_from_cart_schema,
]);

export type Redeem_request_data = z.infer<typeof redeem_request_zod_schema>;

export const invest_more_lumpsum_schema = z.object({
    type: z.literal("LUMPSUM"),
    items: z.array(z.object({
        amount: z.number().positive(),
        scheme_id: z.string().min(1),
        folio: z.string().min(1, "folio is required for invest more")
    })).min(1, "At least one item is required for lumpsum investment"),
});

export const invest_more_sip_schema = z.object({
    type: z.literal("SIP"),
    amount: z.number().positive(),
    scheme_id: z.string().min(1),
    folio: z.string().min(1, "folio is required for invest more"),
    sip_st_date: z.string().min(1, "SIP start date is required"),
    sip_en_date: z.string().min(1, "SIP end date is required"),
    sip_freq: z.enum(["DZ", "D", "OM", "Q", "WD", "OW", "H", "Y"]),
    sip_day: z.number(),
    mandate_id: z.string().optional(),
});

export const invest_more_zod_schema = z.discriminatedUnion("type", [
    invest_more_lumpsum_schema,
    invest_more_sip_schema
]);

export type Invest_more_data = z.infer<typeof invest_more_zod_schema>;

// ─── SIP Purchase with Step-Up ────────────────────────────────────────────────

export const sip_purchase_item_schema = z.object({
    amc_code: z.string().min(1, "amc_code is required"),
    prod_code: z.string().min(1, "prod_code is required"),
    sip_freq: z.enum(["DZ", "D", "OM", "Q", "WD", "OW", "H", "Y"]),
    sip_amt: z.number().positive("sip_amt must be positive"),
    folio: z.string().optional().default(""),
    sip_st_date: z.string().min(1, "sip_st_date is required"),
    sip_en_date: z.string().min(1, "sip_en_date is required"),
    step_up_required: z.enum(["Y", "N"]),
    step_up_amount: z.string().default(""),
    step_up_start_date: z.string().default(""),
    step_up_end_date: z.string().default(""),
}).refine(data => {
    if (data.step_up_required === "Y") {
        return (
            !!data.step_up_amount &&
            !!data.step_up_start_date &&
            !!data.step_up_end_date
        );
    }
    return true;
}, {
    message: "step_up_amount, step_up_start_date, and step_up_end_date are required when step_up_required is Y"
});

export const purchase_sip_body_schema = z.object({
    items: z.array(sip_purchase_item_schema).min(1, "At least one SIP item is required"),
});

export type Sip_purchase_item = z.infer<typeof sip_purchase_item_schema>;
export type Purchase_sip_body = z.infer<typeof purchase_sip_body_schema>;