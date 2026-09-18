/**
 * Janta Nivesh Goals v2 Financial Calculation Engine
 *
 * Implements:
 * 1. Inflation-adjusted future target cost
 * 2. Compounded future value of existing savings
 * 3. Net corpus required
 * 4. Required monthly SIP (Ordinary Annuity formula, end-of-month payments)
 * 5. Required lumpsum investment today
 */

export interface GoalCalculationInput {
    current_cost: number;
    years_remaining: number;
    current_savings?: number;
    inflation_rate?: number | null; // e.g. 0.06 for 6%
    expected_return_rate: number;   // e.g. 0.10 for 10%
    is_inflation_adjusted?: boolean; // false for Type 5 (Build My Savings), true for others
}

export interface GoalCalculationResult {
    future_target_amount: number;
    fv_current_savings: number;
    net_required_corpus: number;
    required_monthly_sip: number;
    required_lumpsum_today: number;
}

/**
 * Normalizes rates: if a user passes `6` instead of `0.06`, converts to decimal `0.06`.
 */
export function normalizeRate(rate: number | null | undefined): number {
    if (rate === null || rate === undefined || isNaN(rate)) {
        return 0;
    }
    // If rate is entered as percentage e.g. 6 or 10 instead of 0.06 or 0.10
    return rate > 1 ? rate / 100 : rate;
}

/**
 * Rounds a number to two decimal places (paise precision).
 */
export function roundToTwoDecimals(val: number): number {
    return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates goal projections according to client specifications.
 */
export function calculateGoalProjections(input: GoalCalculationInput): GoalCalculationResult {
    const cost = Math.max(0, input.current_cost || 0);
    const years = Math.max(0, input.years_remaining || 0);
    const savings = Math.max(0, input.current_savings || 0);
    const inflation = normalizeRate(input.inflation_rate);
    const returnRate = normalizeRate(input.expected_return_rate);
    const isInflationAdjusted = input.is_inflation_adjusted ?? true;

    // 1. Future Target Amount (FV_cost)
    let future_target_amount = cost;
    if (isInflationAdjusted && years > 0 && inflation > 0) {
        future_target_amount = cost * Math.pow(1 + inflation, years);
    }
    future_target_amount = roundToTwoDecimals(future_target_amount);

    // 2. Future Value of Current Savings (FV_savings)
    let fv_current_savings = savings;
    if (savings > 0 && years > 0 && returnRate > 0) {
        fv_current_savings = savings * Math.pow(1 + returnRate, years);
    }
    fv_current_savings = roundToTwoDecimals(fv_current_savings);

    // 3. Net Required Corpus
    const net_required_corpus = roundToTwoDecimals(Math.max(0, future_target_amount - fv_current_savings));

    // 4. Required Monthly SIP (Ordinary Annuity formula)
    let required_monthly_sip = 0;
    if (net_required_corpus > 0 && years > 0 && returnRate > 0) {
        const monthlyRate = returnRate / 12;
        const totalMonths = years * 12;
        const denominator = Math.pow(1 + monthlyRate, totalMonths) - 1;
        if (denominator > 0) {
            required_monthly_sip = (net_required_corpus * monthlyRate) / denominator;
        }
    }
    required_monthly_sip = roundToTwoDecimals(required_monthly_sip);

    // 5. Required Lump Sum Today (Present Value of Net Corpus)
    let required_lumpsum_today = 0;
    if (net_required_corpus > 0 && years > 0 && returnRate > 0) {
        required_lumpsum_today = net_required_corpus / Math.pow(1 + returnRate, years);
    }
    required_lumpsum_today = roundToTwoDecimals(required_lumpsum_today);

    return {
        future_target_amount,
        fv_current_savings,
        net_required_corpus,
        required_monthly_sip,
        required_lumpsum_today,
    };
}
