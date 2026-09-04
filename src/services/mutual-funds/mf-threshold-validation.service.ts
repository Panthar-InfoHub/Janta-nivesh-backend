import { db } from "../../server.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import type { Decimal } from "../../prisma/generated/prisma/internal/prismaNamespace.js";

type Numeric = Decimal | number | null;

/**
 * Per-scheme amount rules from MfSchemePlan (FP's `thresholds[]`), checked before we send anything
 * to FP - an out-of-range amount should be a clean 400 naming the broken rule, not an opaque 502.
 *
 * IMPORTANT: every check is skipped when the fund has no MfSchemePlan row. That table is populated
 * by the FP scheme-plan sync job, which isn't built yet, so today it's empty - validating
 * unconditionally would reject every single order. Validation switches itself on per-fund as the
 * sync fills the table.
 */
class MfThresholdValidationServiceClass {

    private to_number = (value: Numeric): number | null => {
        if (value === null || value === undefined) return null;
        return typeof value === "number" ? value : Number(value);
    }

    /**
     * Multiples check scaled to micro-units (1e6), avoiding JS floating-point `%` errors
     * (e.g. 1000.05 % 0.05 !== 0) while supporting both rupee amounts (multiples like 0.01 or 100)
     * and mutual fund units (multiples like 0.001 or 0.0001).
     */
    private is_multiple_of = (amount: number, multiple: number | null): boolean => {
        if (!multiple || multiple <= 0) return true;
        const scale = 1_000_000;
        const scaled_mult = Math.round(multiple * scale);
        if (scaled_mult === 0) return true;
        return Math.round(amount * scale) % scaled_mult === 0;
    }

    private check_amount = (
        amount: number,
        min: Numeric,
        max: Numeric,
        multiples: Numeric,
        label: string,
    ) => {
        const min_n = this.to_number(min);
        const max_n = this.to_number(max);
        const mult_n = this.to_number(multiples);

        if (min_n !== null && amount < min_n) {
            throw new AppError(`Minimum ${label} amount for this fund is ${min_n}`, 400, "AMOUNT_BELOW_MINIMUM");
        }
        if (max_n !== null && amount > max_n) {
            throw new AppError(`Maximum ${label} amount for this fund is ${max_n}`, 400, "AMOUNT_ABOVE_MAXIMUM");
        }
        if (!this.is_multiple_of(amount, mult_n)) {
            throw new AppError(`${label} amount must be a multiple of ${mult_n}`, 400, "AMOUNT_NOT_MULTIPLE");
        }
    }

    /** Returns null when the fund has no synced scheme plan - callers treat that as "skip". */
    private get_scheme_plan = async (isin: string) => {
        const scheme_plan = await db.mfSchemePlan.findUnique({ where: { isin } });
        if (!scheme_plan) {
            logger.warn("No MfSchemePlan for this ISIN - skipping threshold validation", { isin });
        }
        return scheme_plan;
    }

    /** Lumpsum purchase (mf_purchase). */
    validate_lumpsum = async (isin: string, amount: number) => {
        const plan = await this.get_scheme_plan(isin);
        if (!plan) return;

        if (!plan.lumpsum_allowed) {
            throw new AppError("This fund does not accept lumpsum purchases", 400, "TRANSACTION_MODE_NOT_ALLOWED");
        }

        this.check_amount(amount, plan.lumpsum_amount_min, plan.lumpsum_amount_max, plan.lumpsum_amount_multiples, "lumpsum");
    }

    /** SIP (mf_purchase_plan). installment_day is checked against the fund's own allowed dates. */
    validate_sip = async (
        isin: string,
        amount: number,
        frequency: "monthly" | "daily",
        installment_day?: number,
        number_of_installments?: number,
    ) => {
        const plan = await this.get_scheme_plan(isin);
        if (!plan) return;

        const is_monthly = frequency === "monthly";

        if (is_monthly ? !plan.sip_monthly_allowed : !plan.sip_daily_allowed) {
            throw new AppError(`This fund does not accept ${frequency} SIPs`, 400, "TRANSACTION_MODE_NOT_ALLOWED");
        }

        this.check_amount(
            amount,
            is_monthly ? plan.sip_monthly_amount_min : plan.sip_daily_amount_min,
            is_monthly ? plan.sip_monthly_amount_max : plan.sip_daily_amount_max,
            is_monthly ? plan.sip_monthly_amount_multiples : plan.sip_daily_amount_multiples,
            `${frequency} SIP`,
        );

        // The authoritative allowed-dates list, which varies by fund - this is the real constraint,
        // not the loose numeric bound in the zod schema.
        if (is_monthly && installment_day !== undefined && plan.sip_monthly_dates.length > 0) {
            if (!plan.sip_monthly_dates.includes(installment_day)) {
                throw new AppError(
                    `Installment day ${installment_day} is not allowed for this fund`,
                    400,
                    "INSTALLMENT_DAY_NOT_ALLOWED",
                );
            }
        }

        const min_installments = is_monthly ? plan.sip_monthly_installments_min : plan.sip_daily_installments_min;
        if (min_installments && number_of_installments !== undefined && number_of_installments < min_installments) {
            throw new AppError(
                `This fund requires at least ${min_installments} installments`,
                400,
                "INSTALLMENTS_BELOW_MINIMUM",
            );
        }
    }

    /**
     * Redemption - both the SWP (mf_redemption_plan) and the one-shot sell (mf_redemption), which
     * isn't built yet. FP's master data only ships a single `withdrawal` threshold, so the same
     * limits apply to both; there is no SWP-specific entry to map.
     */
    validate_redemption = async (isin: string, amount: number) => {
        const plan = await this.get_scheme_plan(isin);
        if (!plan) return;

        if (!plan.withdrawal_allowed) {
            throw new AppError("This fund does not accept redemptions", 400, "TRANSACTION_MODE_NOT_ALLOWED");
        }

        this.check_amount(amount, plan.withdrawal_amount_min, plan.withdrawal_amount_max, plan.withdrawal_amount_multiples, "redemption");
    }
    validate_redemption_units = async (
        isin: string,
        units: number,
    ) => {
        const plan = await this.get_scheme_plan(isin);
        if (!plan) return;

        if (!plan.withdrawal_allowed) {
            throw new AppError(
                "This fund does not accept redemptions",
                400,
                "TRANSACTION_MODE_NOT_ALLOWED",
            );
        }

        const min_units = this.to_number(plan.withdrawal_units_min);
        const multiples = this.to_number(plan.withdrawal_units_multiples);

        if (min_units !== null && units < min_units) {
            throw new AppError(
                `Minimum redemption units for this fund is ${min_units}`,
                400,
                "UNITS_BELOW_MINIMUM",
            );
        }

        if (!this.is_multiple_of(units, multiples)) {
            throw new AppError(
                `Redemption units must be a multiple of ${multiples}`,
                400,
                "UNITS_NOT_MULTIPLE",
            );
        }
    }
}

export const mf_threshold_validation_service = new MfThresholdValidationServiceClass();
