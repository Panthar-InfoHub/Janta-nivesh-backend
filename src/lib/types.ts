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
    }
}>

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