import { normalizeRate, roundToTwoDecimals } from "./goal-calculator.js";

export interface RetirementTimeline {
    current_age: number;
    retirement_age: number;
    plan_until_age: number;
    years_to_retirement: number; // Y
    months_to_retirement: number; // M = 12 * Y
    months_in_retirement: number; // N = 12 * [plan_until_age - max(current_age, retirement_age)]
    retirement_date?: Date;
    planning_end_date?: Date;
    is_drawdown_mode: boolean; // true if current_age >= retirement_age
}

export interface RetirementCalculationInput {
    monthly_lifestyle_cost: number; // E (today's rupees)
    existing_retirement_savings?: number; // S (today's eligible savings)
    current_monthly_sip?: number; // Existing SIP allocation to retirement
    pension_or_regular_income?: number; // P (monthly nominal at retirement)
    annual_pension_increase?: number; // g_p (annual decimal)
    pre_retirement_return?: number; // r_a (effective annual decimal, default 0.10)
    post_retirement_return?: number; // r_d (effective annual decimal, default 0.06)
    inflation_before_retirement?: number; // i_b (effective annual decimal, default 0.06)
    inflation_during_retirement?: number; // i_d (effective annual decimal, default 0.06)
    additional_corpus_buffer?: number; // b (decimal, default 0.10 for 10%)
}

export interface RetirementCalculationResult {
    monthly_cost_at_retirement: number; // E_ret
    base_retirement_corpus: number; // baseCorpus
    target_retirement_corpus: number; // targetCorpus = baseCorpus * (1 + b)
    fv_existing_savings: number; // FV_existing
    remaining_corpus_to_build: number; // gapAtRetirement = max(0, targetCorpus - FV_existing)
    total_monthly_sip: number; // total required SIP
    extra_monthly_sip: number; // max(0, total_monthly_sip - current_monthly_sip)
    additional_lumpsum_today: number; // alternative single lump sum today
    // Metadata snapshots
    pre_retirement_return_used: number;
    post_retirement_return_used: number;
    inflation_before_used: number;
    inflation_during_used: number;
    buffer_used: number;
    pension_increase_used: number;
}

/**
 * Derives age, milestones, and timeline from verified Date of Birth (or age inputs).
 */
export function timelineFromDob(
    dob: string | Date,
    retirementAge: number,
    planUntilAge: number,
    asOfDate: Date = new Date()
): RetirementTimeline {
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) {
        throw new Error("Invalid date of birth provided");
    }

    let currentAge = asOfDate.getFullYear() - birthDate.getFullYear();
    const monthDiff = asOfDate.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && asOfDate.getDate() < birthDate.getDate())) {
        currentAge--;
    }
    currentAge = Math.max(0, currentAge);

    if (planUntilAge <= Math.max(currentAge, retirementAge)) {
        throw new Error("plan_until_age must be greater than current age and retirement age");
    }

    const retirementDate = new Date(birthDate.getFullYear() + retirementAge, birthDate.getMonth(), birthDate.getDate());
    const planningEndDate = new Date(birthDate.getFullYear() + planUntilAge, birthDate.getMonth(), birthDate.getDate());

    const Y = Math.max(0, retirementAge - currentAge);
    const M = 12 * Y;
    const N = 12 * (planUntilAge - Math.max(currentAge, retirementAge));

    return {
        current_age: currentAge,
        retirement_age: retirementAge,
        plan_until_age: planUntilAge,
        years_to_retirement: Y,
        months_to_retirement: M,
        months_in_retirement: N,
        retirement_date: retirementDate,
        planning_end_date: planningEndDate,
        is_drawdown_mode: currentAge >= retirementAge,
    };
}

/**
 * Standalone timeline builder for simulator previews where DOB is not passed, only ages.
 */
export function timelineFromAges(
    currentAge: number,
    retirementAge: number,
    planUntilAge: number
): RetirementTimeline {
    if (planUntilAge <= Math.max(currentAge, retirementAge)) {
        throw new Error("plan_until_age must be greater than current age and retirement age");
    }

    const Y = Math.max(0, retirementAge - currentAge);
    const M = 12 * Y;
    const N = 12 * (planUntilAge - Math.max(currentAge, retirementAge));

    return {
        current_age: currentAge,
        retirement_age: retirementAge,
        plan_until_age: planUntilAge,
        years_to_retirement: Y,
        months_to_retirement: M,
        months_in_retirement: N,
        is_drawdown_mode: currentAge >= retirementAge,
    };
}

/**
 * Core calculation engine for Velvet Retirement Goal.
 * Implements discrete monthly cash flows, pensions, buffer, and effective compounding.
 */
export function calculateRetirement(
    input: RetirementCalculationInput,
    timeline: RetirementTimeline
): RetirementCalculationResult {
    const E = Math.max(0, input.monthly_lifestyle_cost || 0);
    const S = Math.max(0, input.existing_retirement_savings || 0);
    const existingMonthlySip = Math.max(0, input.current_monthly_sip || 0);
    const P = Math.max(0, input.pension_or_regular_income || 0);

    const r_a = input.pre_retirement_return !== undefined && input.pre_retirement_return !== null
        ? normalizeRate(input.pre_retirement_return)
        : 0.10;
    const r_d = input.post_retirement_return !== undefined && input.post_retirement_return !== null
        ? normalizeRate(input.post_retirement_return)
        : 0.06;
    const i_b = input.inflation_before_retirement !== undefined && input.inflation_before_retirement !== null
        ? normalizeRate(input.inflation_before_retirement)
        : 0.06;
    const i_d = input.inflation_during_retirement !== undefined && input.inflation_during_retirement !== null
        ? normalizeRate(input.inflation_during_retirement)
        : 0.06;
    const b = input.additional_corpus_buffer !== undefined && input.additional_corpus_buffer !== null
        ? normalizeRate(input.additional_corpus_buffer)
        : 0.10;
    const g_p = input.annual_pension_increase !== undefined && input.annual_pension_increase !== null
        ? normalizeRate(input.annual_pension_increase)
        : 0.00;

    const Y = timeline.years_to_retirement;
    const M = timeline.months_to_retirement;
    const N = timeline.months_in_retirement;

    // 1. Monthly lifestyle cost at retirement: E_ret = E * (1 + i_b)^Y
    const E_ret = E * Math.pow(1 + i_b, Y);

    // 2. Base retirement corpus via discrete monthly cash flow summation (k = 0 ... N - 1)
    let baseCorpus = 0;
    for (let k = 0; k < N; k++) {
        const timeYears = k / 12;
        const expense_k = E_ret * Math.pow(1 + i_d, timeYears);
        const pension_k = P * Math.pow(1 + g_p, timeYears);
        const shortfall_k = Math.max(0, expense_k - pension_k);
        const discount_factor = Math.pow(1 + r_d, timeYears);
        const discounted_k = shortfall_k / discount_factor;
        baseCorpus += discounted_k;
    }

    // 3. Target corpus with buffer: targetCorpus = baseCorpus * (1 + b)
    const targetCorpus = baseCorpus * (1 + b);

    // 4. Future value of existing eligible retirement savings: FV_existing = S * (1 + r_a)^Y
    const FV_existing = S * Math.pow(1 + r_a, Y);

    // 5. Funding gap at retirement: gapAtRetirement = max(0, targetCorpus - FV_existing)
    const gapAtRetirement = Math.max(0, targetCorpus - FV_existing);

    // 6. Monthly SIP required
    // Effective monthly compounding: r_m = (1 + r_a)^(1/12) - 1
    let totalMonthlySip = 0;
    if (gapAtRetirement > 0 && M > 0) {
        const r_m = Math.pow(1 + r_a, 1 / 12) - 1;
        if (Math.abs(r_m) < 1e-12) {
            totalMonthlySip = gapAtRetirement / M;
        } else {
            const accumulationFactor = Math.pow(1 + r_m, M) - 1;
            totalMonthlySip = (gapAtRetirement * r_m) / accumulationFactor;
        }
    }

    const extraMonthlySip = Math.max(0, totalMonthlySip - existingMonthlySip);

    // 7. Lump sum alternative today: gapAtRetirement / (1 + r_a)^Y
    let additionalLumpsumToday = 0;
    if (gapAtRetirement > 0) {
        additionalLumpsumToday = gapAtRetirement / Math.pow(1 + r_a, Y);
    }

    return {
        monthly_cost_at_retirement: roundToTwoDecimals(E_ret),
        base_retirement_corpus: roundToTwoDecimals(baseCorpus),
        target_retirement_corpus: roundToTwoDecimals(targetCorpus),
        fv_existing_savings: roundToTwoDecimals(FV_existing),
        remaining_corpus_to_build: roundToTwoDecimals(gapAtRetirement),
        total_monthly_sip: roundToTwoDecimals(totalMonthlySip),
        extra_monthly_sip: roundToTwoDecimals(extraMonthlySip),
        additional_lumpsum_today: roundToTwoDecimals(additionalLumpsumToday),
        pre_retirement_return_used: r_a,
        post_retirement_return_used: r_d,
        inflation_before_used: i_b,
        inflation_during_used: i_d,
        buffer_used: b,
        pension_increase_used: g_p,
    };
}
