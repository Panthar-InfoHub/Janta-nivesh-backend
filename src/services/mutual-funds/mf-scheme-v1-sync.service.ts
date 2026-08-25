import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { db } from "../../server.js";
import {
    fintech_primitive_mf_scheme_v1_service,
    type FpV1FundScheme,
} from "../fintech-primitive/mf_scheme_v1.service.js";

/**
 * Maps FP's v1 fund_scheme payload onto the v1-owned half of MfSchemePlan.
 *
 * Deliberately returns ONLY columns the v1 job owns - nothing the v2 scheme-plan sync writes
 * appears here, so the two jobs can run in any order, at any cadence, without overwriting each
 * other. Same reasoning as the model's own comment.
 */
export const map_v1_fund_scheme = (scheme: FpV1FundScheme) => ({
    fund_category: scheme.fund_category ?? null,
    // FP sends this blank for some funds in the client's master data - store the blank as null
    // rather than an empty string so "no sub-category" is one value, not two.
    sub_category: scheme.sub_category?.trim() || null,
    amfi_code: scheme.amfi_code ?? null,

    close_ended: scheme.close_ended ?? null,
    lock_in: scheme.lock_in ?? null,
    lock_in_period: scheme.lock_in_period ?? null,

    purchase_allowed_v1: scheme.purchase_allowed ?? null,
    redemption_allowed_v1: scheme.redemption_allowed ?? null,
    instant_redemption_allowed: scheme.instant_redemption_allowed ?? null,
    sip_allowed: scheme.sip_allowed ?? null,
    stp_in_allowed: scheme.stp_in_allowed ?? null,
    stp_out_allowed: scheme.stp_out_allowed ?? null,

    // Unlike v2's thresholds[], where a missing entry is what tells you a mode is unsupported,
    // v1 states it outright - so trust the flag and default to false when FP omits it.
    switch_in_allowed: scheme.switch_in_allowed ?? false,
    switch_in_amount_min: scheme.min_switch_in_amount ?? null,
    switch_in_amount_multiples: scheme.switch_in_amount_multiples ?? null,

    switch_out_allowed: scheme.switch_out_allowed ?? false,
    switch_out_amount_min: scheme.min_switch_out_amount ?? null,
    switch_out_amount_multiples: scheme.switch_out_amount_multiples ?? null,
    switch_out_units_min: scheme.min_switch_out_units ?? null,
    switch_out_unit_multiples: scheme.switch_out_unit_multiples ?? null,

    sip_frequency_data: (scheme.sip_frequency_specific_data ?? null) as any,
    stp_frequency_data: (scheme.stp_frequency_specific_data ?? null) as any,

    raw_response_v1: scheme as any,
    v1_synced_at: new Date(),
});

class MfSchemeV1SyncServiceClass {

    /**
     * Updates the v1-owned columns for one ISIN. Update-only, never create: MfSchemePlan's row is
     * created by the v2 scheme-plan sync, which owns the required columns (scheme_name, plan_type,
     * option, ...) this payload can't supply. A fund the v2 job hasn't reached yet is skipped
     * rather than half-written.
     */
    sync_by_isin = async (isin: string) => {
        if (!isin) {
            throw new AppError("ISIN is required for v1 scheme sync", 400, "MF_ISIN_REQUIRED");
        }

        logger.info("Starting MF v1 fund-scheme sync", { isin });

        const scheme_plan = await db.mfSchemePlan.findUnique({
            where: { isin },
            select: { id: true },
        });

        if (!scheme_plan) {
            throw new AppError(
                `No MfSchemePlan row for ISIN ${isin} - run the v2 scheme-plan sync first`,
                404,
                "MF_SCHEME_PLAN_NOT_FOUND"
            );
        }

        const scheme = await fintech_primitive_mf_scheme_v1_service.get_fund_scheme_by_isin(isin);

        if (!scheme?.isin) {
            throw new AppError(
                `FP v1 fund_scheme response missing ISIN for ${isin}`,
                502,
                "MF_SCHEME_V1_RESPONSE_INVALID"
            );
        }

        const updated = await db.mfSchemePlan.update({
            where: { id: scheme_plan.id },
            data: map_v1_fund_scheme(scheme),
        });

        logger.info("MF v1 fund-scheme sync completed", {
            isin,
            mf_scheme_plan_id: updated.id,
            fund_category: updated.fund_category,
            sub_category: updated.sub_category,
        });

        return updated;
    };
}

export const mf_scheme_v1_sync_service = new MfSchemeV1SyncServiceClass();
