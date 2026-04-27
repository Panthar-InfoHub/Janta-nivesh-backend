import { FireReportCoreResponse, YearlyGoalRequirement } from "./fire-report.types.js";

// ─── View-model interfaces (consumed by the TSX report component + PDF) ───────

export interface VelvetReportGoal {
    no: number;
    name: string;
    todayCost: number;
    targetYear: number;
    timeInHand: number;
    monthlySavingsReq: number;
    yearlySavingsReq: number;
    futureValue: number;
}

export interface VelvetReportViewData {
    currentQuarter: string;
    previousQuarter: string;

    clientData: {
        name: string;
        age: number;
        city: string;
    };

    snapshot: {
        netWorth: number;
        netWorthPrevQ: number;
        netWorthHistory: { quarter: string; value: number }[];
        fireCurrentCorpus: number;
        fireNumber: number;
        firePercentage: number;
        fireGap: number;
        annualExpenses: number;
        annualExpensesPrevQ: number;
        monthlyExpenses: number;
        fireHistory: { quarter: string; fire: number }[];
        fiYear: number | null;
        fiAge: number | null;
    };

    incomeExpense: {
        monthlyIncome: number;
        monthlyExpense: number;
        monthlySurplus: number;
        annualSurplus: number;
        savingsRate: number;
        expenseBreakdown: { category: string; amount: number; percentage: number }[];
    };

    balanceSheet: {
        assets: { name: string; value: number }[];
        liabilities: { name: string; outstanding: number; emi: number; tenure_months: number }[];
        totalAssets: number;
        totalLiabilities: number;
        netWorth: number;
        netWorthPrevQ: number;
        qoqNwPct: string;
    };

    netWorthPage: {
        equityTrend: { q: string; value: number }[];
        debtTrend: { q: string; value: number }[];
        realEstateTrend: { q: string; value: number }[];
        goldCashTrend: { q: string; value: number }[];
        pieData: { name: string; value: number; percentage: number }[];
    };

    goals: VelvetReportGoal[];
    goalsTotal: { monthlySavingsReq: number; yearlySavingsReq: number; futureValue: number };
    yearlyGoalRequirements: YearlyGoalRequirement[];

    insurance: {
        termLife: { have: number; recommended: number; gap: number };
        health: { have: number; recommended: number; gap: number };
    };

    thirtyYearProjection: {
        year: number;
        portfolioValue: number;
        expenses: number;
        goals: number;
        fireNumber: number;
        firePercent: number;
    }[];

    qoqChanges: {
        netWorth: string;
        expenses: string;
        fireNumber: string;
        firePercent: string;
    };

    summaryQuarter: {
        netWorth: string;
        fireProgress: string;
        savingsRate: string;
        nextReview: string;
    };
}

// ─── Transformer ──────────────────────────────────────────────────────────────

export function to_report_view_data(report: FireReportCoreResponse): VelvetReportViewData {
    const { computed_metrics: m, projection, quarterly_simulation: qs, goals, assets_breakdown: ab, liabilities, expense_breakdown: eb, insurance_summary: ins } = report;

    // ── Quarter labels from simulation ────────────────────────────────────────
    const currentQuarter = qs[5]?.quarter ?? "Q1 2026";
    const previousQuarter = qs[4]?.quarter ?? "Q4 2025";

    // ── Snapshot ──────────────────────────────────────────────────────────────
    const netWorth = m.net_worth;
    const netWorthPrevQ = Math.round(qs[4] ? qs[4].net_worth * 100_000 : netWorth * 0.98);
    const netWorthHistory = qs.map(q => ({ quarter: q.quarter, value: q.net_worth }));
    const fireCurrentCorpus = projection[0]?.portfolio_value.emi_include ?? 0;
    const fireNumber = projection[0]?.fire_number.emi_include ?? 0;
    const firePercentage = projection[0]?.fire_percentage.emi_include ?? 0;
    const fireGap = Math.max(0, fireNumber - fireCurrentCorpus);
    const annualExpenses = m.total_annual_expenses;
    // approximate previous quarter's annual expenses (monthly rate deflated by 6% p.a. ÷ 4 quarters)
    const annualExpensesPrevQ = Math.round(annualExpenses / Math.pow(1.06, 0.25));
    const monthlyExpenses = Math.round(annualExpenses / 12);
    const fireHistory = qs.map(q => ({ quarter: q.quarter, fire: Math.round(q.fire_number * 100_000) }));
    const fiYear = projection.find(r => r.fire_percentage.emi_include >= 100)?.year ?? null;
    const fiAge = fiYear ? report.user_profile.age + (fiYear - new Date().getFullYear()) : null;

    // ── Income & Expense ──────────────────────────────────────────────────────
    const monthlyIncome = m.monthly_income;
    const monthlyExpense = eb.total_monthly;
    const monthlySurplus = Math.round(monthlyIncome - monthlyExpense);
    const annualSurplus = Math.round(m.annual_savings);
    const savingsRate = parseFloat(m.savings_rate.toFixed(1));
    const totalExp = eb.total_annual || 1;
    const expenseBreakdown = [
        { category: "Housing", amount: Math.round(eb.house / 12), percentage: Math.round((eb.house / totalExp) * 100) },
        { category: "Food & Groceries", amount: Math.round(eb.food / 12), percentage: Math.round((eb.food / totalExp) * 100) },
        { category: "Transport", amount: Math.round(eb.transportation / 12), percentage: Math.round((eb.transportation / totalExp) * 100) },
        { category: "Others", amount: Math.round(eb.others / 12), percentage: Math.round((eb.others / totalExp) * 100) },
    ];

    // ── Balance Sheet ─────────────────────────────────────────────────────────
    const bsAssets = [
        { name: "Mutual Funds", value: ab.mutual_funds },
        { name: "Stocks/Equity", value: ab.stocks },
        { name: "Fixed Deposits", value: ab.fd },
        { name: "Gold", value: ab.gold },
        { name: "Real Estate", value: ab.real_estate },
        { name: "Cash & Savings", value: ab.cash_saving },
    ];
    const bsLiabilities = liabilities.map(l => ({
        name: l.loan_type,
        outstanding: l.outstanding,
        emi: l.monthly_emi,
        tenure_months: l.tenure_months,
    }));
    const qoqNwPct = netWorthPrevQ > 0
        ? ((netWorth - netWorthPrevQ) / netWorthPrevQ * 100).toFixed(1)
        : "0.0";

    // ── Net Worth Page (asset-class trends for last 3 quarters) ──────────────
    const last3 = qs.slice(-3);
    const scale_factor = (q_index: number) => qs[5]?.net_worth > 0 ? last3[q_index]!.net_worth / qs[5].net_worth : 1;
    const to_L = (v: number) => parseFloat((v / 100_000).toFixed(2));

    const equity_now = ab.mutual_funds + ab.stocks;
    const debt_now = ab.fd;
    const re_now = ab.real_estate;
    const gold_cash_now = ab.gold + ab.cash_saving;
    const total_assets_now = ab.total;

    const equityTrend = last3.map((q, i) => ({ q: q.quarter, value: to_L(equity_now * scale_factor(i)) }));
    const debtTrend = last3.map((q, i) => ({ q: q.quarter, value: to_L(debt_now * scale_factor(i)) }));
    const realEstateTrend = last3.map((q, i) => ({ q: q.quarter, value: to_L(re_now * scale_factor(i)) }));
    const goldCashTrend = last3.map((q, i) => ({ q: q.quarter, value: to_L(gold_cash_now * scale_factor(i)) }));

    const safe_pct = (v: number) => total_assets_now > 0 ? Math.round((v / total_assets_now) * 100) : 0;
    const pieData = [
        { name: "Financial Assets", value: ab.total_liquid - ab.cash_saving, percentage: safe_pct(ab.total_liquid - ab.cash_saving) },
        { name: "Real Estate", value: ab.real_estate, percentage: safe_pct(ab.real_estate) },
        { name: "Cash & Savings", value: ab.cash_saving, percentage: safe_pct(ab.cash_saving) },
        { name: "Gold", value: ab.gold, percentage: safe_pct(ab.gold) },
    ];

    // ── Goals ─────────────────────────────────────────────────────────────────
    const current_year = new Date().getFullYear();
    const goalRows: VelvetReportGoal[] = goals.map((g, idx) => ({
        no: idx + 1,
        name: g.name,
        todayCost: g.target_amount,
        targetYear: g.target_year,
        timeInHand: g.target_year - current_year,
        monthlySavingsReq: g.required_monthly_sip,
        yearlySavingsReq: g.required_monthly_sip * 12,
        futureValue: g.future_value,
    }));
    const goalsTotal = {
        monthlySavingsReq: goalRows.reduce((s, g) => s + g.monthlySavingsReq, 0),
        yearlySavingsReq: goalRows.reduce((s, g) => s + g.yearlySavingsReq, 0),
        futureValue: goalRows.reduce((s, g) => s + g.futureValue, 0),
    };

    // ── Insurance ─────────────────────────────────────────────────────────────
    const insurance = {
        termLife: { have: ins.term_life_have, recommended: ins.term_life_recommended, gap: ins.term_life_gap },
        health: { have: ins.health_have, recommended: ins.health_recommended, gap: ins.health_gap },
    };

    // ── 30-year projection table ───────────────────────────────────────────────
    const thirtyYearProjection = projection.map(r => ({
        year: r.year,
        portfolioValue: r.portfolio_value.emi_include,
        expenses: r.total_expenses.emi_include,
        goals: r.goals_payout,
        fireNumber: r.fire_number.emi_include,
        firePercent: r.fire_percentage.emi_include,
    }));

    // ── QoQ Changes ───────────────────────────────────────────────────────────
    const cur = qs[5];
    const prev = qs[4];
    const pct_change = (c: number, p: number) =>
        p > 0 ? ((c - p) / p * 100).toFixed(1) : "0.0";
    const qoqChanges = {
        netWorth: pct_change(cur?.net_worth ?? 0, prev?.net_worth ?? 1),
        expenses: pct_change(annualExpenses, annualExpensesPrevQ),
        fireNumber: pct_change(cur?.fire_number ?? 0, prev?.fire_number ?? 1),
        firePercent: pct_change(cur?.fire_percentage ?? 0, prev?.fire_percentage ?? 1),
    };

    // ── Quarter-end Summary ───────────────────────────────────────────────────
    const fmt_cr = (v: number) => v >= 10_000_000 ? `₹${(v / 10_000_000).toFixed(2)} Cr` : `₹${(v / 100_000).toFixed(1)} L`;
    const next_q_num = ((Math.floor(new Date().getMonth() / 3) + 1) % 4) + 1;
    const next_q_year = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const summaryQuarter = {
        netWorth: fmt_cr(netWorth),
        fireProgress: `${firePercentage.toFixed(1)}%`,
        savingsRate: `${savingsRate.toFixed(1)}%`,
        nextReview: `Q${next_q_num} ${next_q_year}`,
    };

    return {
        currentQuarter,
        previousQuarter,
        clientData: {
            name: report.user_profile.name ?? "Client",
            age: report.user_profile.age,
            city: report.user_profile.city ?? "India",
        },
        snapshot: {
            netWorth,
            netWorthPrevQ,
            netWorthHistory,
            fireCurrentCorpus,
            fireNumber,
            firePercentage,
            fireGap,
            annualExpenses,
            annualExpensesPrevQ,
            monthlyExpenses,
            fireHistory,
            fiYear,
            fiAge,
        },
        incomeExpense: {
            monthlyIncome,
            monthlyExpense,
            monthlySurplus,
            annualSurplus,
            savingsRate,
            expenseBreakdown,
        },
        balanceSheet: {
            assets: bsAssets,
            liabilities: bsLiabilities,
            totalAssets: ab.total,
            totalLiabilities: m.total_liabilities,
            netWorth,
            netWorthPrevQ,
            qoqNwPct,
        },
        netWorthPage: {
            equityTrend,
            debtTrend,
            realEstateTrend,
            goldCashTrend,
            pieData,
        },
        goals: goalRows,
        goalsTotal,
        yearlyGoalRequirements: report.yearly_goal_requirements,
        insurance,
        thirtyYearProjection,
        qoqChanges,
        summaryQuarter,
    };
}
