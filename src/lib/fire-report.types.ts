// ─── Constants ───────────────────────────────────────────────────────────────

export const FIRE_CONSTANTS = {
    // Per-asset annual growth rates (mirrors ASSUMPTIONS.growth in FireReport.tsx)
    asset_growth: {
        mutual_funds: 0.10,
        stocks: 0.10,
        fd: 0.065,
        real_estate: 0.07,
        gold: 0.07,
        cash_saving: 0.04,
        nps: 0.07,   // not stored in DB — always 0 input
        ppf_epf: 0.06,   // not stored in DB — always 0 input
    },
    expense_growth: 0.06,   // 6% annual expense inflation
    income_growth: 0.05,   // 5% annual income growth
    fire_factor: 30,     // 30× (expenses + goal SIPs) = FIRE number
    default_projection_years: 20,    // default when no query param supplied
    default_age: 30,     // fallback when dob is null

    // Goal SIP formula constants (hardcoded — stored rates not used)
    goal_fv_growth: 0.08,   // FV inflation for non-retirement goal payouts
    goal_sip_return: 0.10,   // annual return for non-retirement SIP PMT (1.1 base)
    retirement_inflation: 0.06,   // corpus inflation for retirement goal
    retirement_return: 0.10,   // corpus growth for retirement goal
} as const;

// ─── Computed Metrics ────────────────────────────────────────────────────────

export interface ComputedMetrics {
    total_assets: number;
    total_liabilities: number;
    net_worth: number;
    monthly_income: number;
    total_annual_expenses: number;
    annual_savings: number;
    savings_rate: number;
    monthly_available_surplus: number;
    liquid_assets: number;
    illiquid_assets: number;
    total_monthly_emi: number;
    debt_to_income_ratio: number;
}

// ─── Per-asset portfolio state (mutable inside projection loop) ───────────────

export interface ProjectionAssets {
    mutual_funds: number;
    stocks: number;
    fd: number;
    real_estate: number;
    gold: number;
    cash_saving: number;
    nps: number;      // always starts at 0 — no DB column
    ppf_epf: number;  // always starts at 0 — no DB column
}

// ─── Dual-value wrapper for EMI-sensitive fields ────────────────────────────
// Both variants are always computed so the frontend can toggle display without re-fetching.

export interface DualEMI {
    emi_include: number;   // value when EMI is counted as an outflow
    emi_exclude: number;   // value when EMI is excluded from outflows
}

// ─── Projection Row (one entry per projection year) ──────────────────────────

export interface ProjectionRow {
    year: number;
    income: number;                         // same regardless of EMI toggle
    goal_commitment_annual: number;         // same regardless of EMI toggle
    goals_payout: number;                   // same regardless of EMI toggle
    goal_hits: { label: string; amount: number }[]; // same regardless of EMI toggle
    // ── EMI-sensitive fields (both variants always present) ──
    total_expenses: DualEMI;    // expenses_raw + emi  vs  expenses_raw
    savings: DualEMI;           // income − total_expenses − goal_sips
    portfolio_value: DualEMI;   // portfolio_after_growth + savings − goals_payout
    fire_number: DualEMI;       // (total_expenses + goal_sips) × 30
    fire_percentage: DualEMI;   // portfolio_value / fire_number × 100
}

// ─── Normalized goal with pre-computed SIP ───────────────────────────────────

export interface NormalizedGoalWithSIP {
    id: string;
    name: string;
    category: string;               // "Retirement" | "Child Education" | "Child Marriage" | display name
    target_year: number;            // calendar year of goal
    target_amount: number;          // 0 for retirement; current_goal_cost for others
    life_expectancy: number | null; // retirement only
    current_monthly_exp: number | null; // retirement only — used for corpus PV
    required_monthly_sip: number;   // pre-computed; deducted annually until target_year
    future_value: number;           // inflation-adjusted corpus at target_year
    goal_type_id: number;
}

// ─── Loan tracking ───────────────────────────────────────────────────────────

export interface TrackedLoan {
    loan_type: string;
    monthly_emi: number;
    tenure_months: number;          // original tenure — never mutated; used for partial-year calc
}

// ─── Enriched breakdown interfaces ───────────────────────────────────────────

export interface AssetsBreakdown {
    mutual_funds: number;
    stocks: number;
    fd: number;
    real_estate: number;
    gold: number;
    cash_saving: number;
    total_liquid: number;
    total_illiquid: number;
    total: number;
}

export interface LiabilityItem {
    loan_type: string;
    outstanding: number;
    monthly_emi: number;
    tenure_months: number;
}

export interface ExpenseBreakdown {
    house: number;
    food: number;
    transportation: number;
    others: number;
    total_monthly: number;
    total_annual: number;
}

export interface InsuranceSummary {
    term_life_have: number;
    term_life_recommended: number;
    term_life_gap: number;
    health_have: number;
    health_recommended: number;
    health_gap: number;
}

/** One backward-simulated quarterly data point for trend charts */
export interface QuarterlyPoint {
    quarter: string;
    net_worth: number;       // in Lakhs
    fire_number: number;     // in Lakhs
    fire_percentage: number; // %
}

export interface YearlyGoalRequirement {
    year: number;
    monthly_required: number;
    yearly_required: number;
}

// ─── User profile snapshot ───────────────────────────────────────────────────

export interface UserProfileSnapshot {
    name: string | null;
    age: number;
    city: string | null;
}

// ─── API response ─────────────────────────────────────────────────────────────

export interface FireReportCoreResponse {
    user_profile: UserProfileSnapshot;
    computed_metrics: ComputedMetrics;
    goals: NormalizedGoalWithSIP[];
    projection: ProjectionRow[];
    // ── Enriched breakdown fields ──
    assets_breakdown: AssetsBreakdown;
    liabilities: LiabilityItem[];
    expense_breakdown: ExpenseBreakdown;
    insurance_summary: InsuranceSummary;
    quarterly_simulation: QuarterlyPoint[];
    yearly_goal_requirements: YearlyGoalRequirement[];
}
