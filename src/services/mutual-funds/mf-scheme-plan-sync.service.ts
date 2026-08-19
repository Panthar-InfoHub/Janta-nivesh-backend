
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { db } from "../../server.js";
import { fintech_primitive_mf_scheme_service } from "../fintech-primitive/mf_scheme.service.js";

type MfSchemeThreshold = {
    type: "lumpsum" | "withdrawal" | "sip";
    frequency?: "daily" | "monthly";

    amount_min?: number | null;
    amount_max?: number | null;
    amount_multiples?: number | null;

    additional_amount_min?: number | null;

    units_min?: number | null;
    units_max?: number | null;
    units_multiples?: number | null;

    installments_min?: number | null;
    dates?: number[] | null;
};

type MfSchemePlanResponse = {
    object?: string;
    gateway?: string;
    isin: string;
    type: string;
    option: string;
    idcw_option?: string | null;
    active: boolean;

    mf_scheme?: {
        name?: string;
    };

    mf_fund?: {
        name?: string;
    };

    thresholds?: MfSchemeThreshold[];
};

export const map_thresholds_to_scheme_plan = (
    thresholds: MfSchemeThreshold[] = []
) => {
    const mapped = {
        lumpsum_allowed: false,
        lumpsum_amount_min: null as number | null,
        lumpsum_amount_max: null as number | null,
        lumpsum_amount_multiples: null as number | null,
        lumpsum_additional_amount_min: null as number | null,

        withdrawal_allowed: false,
        withdrawal_amount_min: null as number | null,
        withdrawal_amount_max: null as number | null,
        withdrawal_amount_multiples: null as number | null,
        withdrawal_units_min: null as number | null,
        withdrawal_units_multiples: null as number | null,

        sip_daily_allowed: false,
        sip_daily_amount_min: null as number | null,
        sip_daily_amount_max: null as number | null,
        sip_daily_amount_multiples: null as number | null,
        sip_daily_installments_min: null as number | null,

        sip_monthly_allowed: false,
        sip_monthly_amount_min: null as number | null,
        sip_monthly_amount_max: null as number | null,
        sip_monthly_amount_multiples: null as number | null,
        sip_monthly_installments_min: null as number | null,
        sip_monthly_dates: [] as number[],
    };

    for (const threshold of thresholds) {

        if (threshold.type === "lumpsum") {
            mapped.lumpsum_allowed = true;
            mapped.lumpsum_amount_min = threshold.amount_min ?? null;
            mapped.lumpsum_amount_max = threshold.amount_max ?? null;
            mapped.lumpsum_amount_multiples = threshold.amount_multiples ?? null;
            mapped.lumpsum_additional_amount_min =
                threshold.additional_amount_min ?? null;
        }

        if (threshold.type === "withdrawal") {
            mapped.withdrawal_allowed = true;
            mapped.withdrawal_amount_min = threshold.amount_min ?? null;
            mapped.withdrawal_amount_max = threshold.amount_max ?? null;
            mapped.withdrawal_amount_multiples =
                threshold.amount_multiples ?? null;
            mapped.withdrawal_units_min = threshold.units_min ?? null;
            mapped.withdrawal_units_multiples =
                threshold.units_multiples ?? null;
        }

        if (
            threshold.type === "sip" &&
            threshold.frequency === "daily"
        ) {
            mapped.sip_daily_allowed = true;
            mapped.sip_daily_amount_min = threshold.amount_min ?? null;
            mapped.sip_daily_amount_max = threshold.amount_max ?? null;
            mapped.sip_daily_amount_multiples =
                threshold.amount_multiples ?? null;
            mapped.sip_daily_installments_min =
                threshold.installments_min ?? null;
        }

        if (
            threshold.type === "sip" &&
            threshold.frequency === "monthly"
        ) {
            mapped.sip_monthly_allowed = true;
            mapped.sip_monthly_amount_min = threshold.amount_min ?? null;
            mapped.sip_monthly_amount_max = threshold.amount_max ?? null;
            mapped.sip_monthly_amount_multiples =
                threshold.amount_multiples ?? null;
            mapped.sip_monthly_installments_min =
                threshold.installments_min ?? null;
            mapped.sip_monthly_dates = threshold.dates ?? [];
        }
    }

    return mapped;
};

class MfSchemePlanSyncServiceClass {

    sync_by_isin = async (isin: string) => {
        if (!isin) {
            throw new AppError(
                "ISIN is required for scheme-plan sync",
                400,
                "MF_ISIN_REQUIRED"
            );
        }

        logger.info("Starting MF scheme-plan sync", { isin });

        const response =
            await fintech_primitive_mf_scheme_service.get_scheme_by_isin(isin);

        if (!response?.isin) {
            throw new AppError(
                `FP scheme-plan response missing ISIN for ${isin}`,
                502,
                "MF_SCHEME_RESPONSE_INVALID"
            );
        }

        const product = await db.mfProduct.findUnique({
            where: { isin },
            select: { id: true },
        });

        if (!product) {
            throw new AppError(
                `MfProduct not found for ISIN ${isin}`,
                404,
                "MF_PRODUCT_NOT_FOUND"
            );
        }

        const threshold_data = map_thresholds_to_scheme_plan(
            response.thresholds ?? []
        );

        const scheme_plan = await db.mfSchemePlan.upsert({
            where: {
                mf_product_id: product.id,
            },
            create: {
                mf_product_id: product.id,
                isin: response.isin,
                scheme_name: response.mf_scheme?.name ?? "",
                fund_name: response.mf_fund?.name ?? "",
                gateway: response.gateway ?? "cybrillapoa",
                plan_type: response.type,
                option: response.option,
                idcw_option: response.idcw_option ?? null,
                active: response.active,

                ...threshold_data,

                raw_response: response,
                last_synced_at: new Date(),
            },
            update: {
                isin: response.isin,
                scheme_name: response.mf_scheme?.name ?? "",
                fund_name: response.mf_fund?.name ?? "",
                gateway: response.gateway ?? "cybrillapoa",
                plan_type: response.type,
                option: response.option,
                idcw_option: response.idcw_option ?? null,
                active: response.active,

                ...threshold_data,

                raw_response: response,
                last_synced_at: new Date(),
            },
        });

        logger.info("MF scheme-plan sync completed", {
            isin,
            mf_product_id: product.id,
            mf_scheme_plan_id: scheme_plan.id,
        });

        return scheme_plan;
    };
}

export const mf_scheme_plan_sync_service =
    new MfSchemePlanSyncServiceClass();