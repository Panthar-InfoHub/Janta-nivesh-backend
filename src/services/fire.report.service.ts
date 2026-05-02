import { Prisma } from "../prisma/generated/prisma/client.js";
import {
    FIRE_CONSTANTS,
    ComputedMetrics,
    ProjectionAssets,
    ProjectionRow,
    NormalizedGoalWithSIP,
    TrackedLoan,
    FireReportCoreResponse,
    AssetsBreakdown,
    LiabilityItem,
    ExpenseBreakdown,
    InsuranceSummary,
    QuarterlyPoint,
    YearlyGoalRequirement,
} from "../lib/fire-report.types.js";
import { UserFireReportData, UserWithAllData } from "../lib/types.js";
import { user_service } from "./user.service.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";

class FireReportServiceClass {

    async get_current_fire_number(user_id: string) {
        const data = await user_service.get_all_user_data(user_id, {
            user_finance: true,
            user_loan: true,
            user_goals: true,
            user_assets: true,
            user_insurance: true,
        });

        if (!data) {
            logger.error(`No user data found for user_id: ${user_id}`);
            throw new AppError("User data not found", 404, "USER_DATA_NOT_FOUND");
        }

        const computed_metrics = this.compute_metrics(data);
        const monthly_expenses_total = computed_metrics.total_annual_expenses / 12;
        const goals = this.normalize_goals_with_sip(
            data.user_goals ?? [],
            data.dob,
            monthly_expenses_total,
        );

        const current_year = new Date().getFullYear();
        const loans = this.normalize_loans(data.user_loan ?? []);

        const current_year_emi = loans.reduce((sum, loan) => {
            const months_paid = Math.max(0, Math.min(12, loan.tenure_months));
            return sum + (loan.monthly_emi * months_paid);
        }, 0);

        const goal_commitment_annual = goals.reduce((sum, goal) =>
            current_year <= goal.target_year
                ? sum + (goal.required_monthly_sip * 12)
                : sum
            , 0);

        const total_expenses_exclude = computed_metrics.total_annual_expenses;
        const total_expenses_include = total_expenses_exclude + current_year_emi;

        const fire_number_exclude = (total_expenses_exclude + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;
        const fire_number_include = (total_expenses_include + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;

        const fire_percentage_exclude = fire_number_exclude > 0
            ? (computed_metrics.net_worth * 100) / fire_number_exclude
            : 0;
        const fire_percentage_include = fire_number_include > 0
            ? (computed_metrics.net_worth * 100) / fire_number_include
            : 0;

        return {
            year: current_year,
            net_worth: Math.round(computed_metrics.net_worth),
            goal_commitment_annual: Math.round(goal_commitment_annual),
            total_expenses: {
                emi_include: Math.round(total_expenses_include),
                emi_exclude: Math.round(total_expenses_exclude),
            },
            fire_number: {
                emi_include: Math.round(fire_number_include),
                emi_exclude: Math.round(fire_number_exclude),
            },
            fire_percentage: {
                emi_include: parseFloat(fire_percentage_include.toFixed(2)),
                emi_exclude: parseFloat(fire_percentage_exclude.toFixed(2)),
            }
        };
    }

    async get_fire_report(user_id: string, projection_years: number = FIRE_CONSTANTS.default_projection_years): Promise<FireReportCoreResponse> {
        const data = await user_service.get_user_fire_report_data(user_id);

        if (!data) {
            logger.error(`No user data found for user_id: ${user_id}`);
            throw new AppError("User data not found", 404, "USER_DATA_NOT_FOUND");
        }

        const computed_metrics = this.compute_metrics(data);

        const monthly_expenses_total = computed_metrics.total_annual_expenses / 12;

        const goals = this.normalize_goals_with_sip(
            data.user_goals ?? [],
            data.dob,
            monthly_expenses_total,
        );

        const projection = this.compute_projection(data, computed_metrics, goals, projection_years);

        return {
            user_profile: {
                name: data.full_name,
                age: this.extract_age(data.dob),
                city: data.city,
            },
            computed_metrics,
            goals,
            projection,
            assets_breakdown: this.extract_assets_breakdown(data),
            liabilities: this.extract_liabilities(data),
            expense_breakdown: this.extract_expense_breakdown(data),
            insurance_summary: this.compute_insurance_summary(data, computed_metrics),
            quarterly_simulation: this.generate_quarterly_simulation(computed_metrics, projection),
            yearly_goal_requirements: this.generate_yearly_goal_table(projection),
        };
    }

    // Compute Metrics 
    private compute_metrics(data: UserFireReportData): ComputedMetrics {
        const finance = data.user_finance;
        const assets = data.user_assets;
        const loans = data.user_loan ?? [];

        // User assets
        const mutual_funds = this.to_num(assets?.mutual_funds);
        const stocks = this.to_num(assets?.stocks);
        const fd = this.to_num(assets?.fd);
        const gold = this.to_num(assets?.gold);
        const cash_saving = this.to_num(assets?.cash_saving);

        // User finance
        const annual_income = this.to_num(finance?.annual_income);
        const expense_house = this.to_num(finance?.expense_house);
        const expense_food = this.to_num(finance?.expense_food);
        const expense_transportation = this.to_num(finance?.expense_transportation);
        const expense_others = this.to_num(finance?.expense_others);

        const total_assets = mutual_funds + stocks + fd + gold + cash_saving;
        const liquid_assets = mutual_funds + stocks + fd + cash_saving;
        const illiquid_assets = gold;

        const total_liabilities = loans.reduce((sum, l) => sum + this.to_num(l.outstanding_amount), 0);
        const total_monthly_emi = loans.reduce((sum, l) => sum + this.to_num(l.monthly_emi), 0);

        console.log("Total assest ==> ", total_assets)
        const net_worth = total_assets - total_liabilities;
        const monthly_income = annual_income / 12;
        const total_annual_expenses = expense_house + expense_food + expense_transportation + expense_others;
        const annual_savings = annual_income - total_annual_expenses - (total_monthly_emi * 12);
        const savings_rate = annual_income === 0 ? 0 : (annual_savings / annual_income) * 100;
        const monthly_available_surplus = monthly_income - (total_annual_expenses / 12) - total_monthly_emi;
        const debt_to_income_ratio = monthly_income === 0 ? 0 : (total_monthly_emi / monthly_income) * 100;

        return {
            total_assets,
            total_liabilities,
            net_worth,
            monthly_income,
            total_annual_expenses,
            annual_savings,
            savings_rate,
            monthly_available_surplus,
            liquid_assets,
            illiquid_assets,
            total_monthly_emi,
            debt_to_income_ratio,
        };
    }

    //  Projection ( per-asset growth, SIP goals, partial EMI — dual-track: emi_include / emi_exclude)
    private compute_projection(data: UserFireReportData, metrics: ComputedMetrics, goals: NormalizedGoalWithSIP[], projection_years: number): ProjectionRow[] {
        const current_year = new Date().getFullYear();
        const loans = this.normalize_loans(data.user_loan ?? []);
        const g = FIRE_CONSTANTS.asset_growth;

        const initial_assets: ProjectionAssets = {
            mutual_funds: this.to_num(data.user_assets?.mutual_funds),
            stocks: this.to_num(data.user_assets?.stocks),
            fd: this.to_num(data.user_assets?.fd),
            gold: this.to_num(data.user_assets?.gold),
            cash_saving: this.to_num(data.user_assets?.cash_saving),
            nps: 0,
            ppf_epf: 0,
        };

        // Two independent asset tracks — only cash_saving diverges via different reinvestment each year
        let ya_inc: ProjectionAssets = { ...initial_assets };
        let ya_exc: ProjectionAssets = { ...initial_assets };

        const annual_income_base = this.to_num(data.user_finance?.annual_income);
        const annual_expenses_base = metrics.total_annual_expenses;
        const proj: ProjectionRow[] = [];

        for (let i = 0; i < projection_years; i++) {
            // 1. Apply per-asset growth to both tracks
            //    Non-cash assets grow identically; cash_saving diverges from prior reinvestment
            ya_inc = {
                mutual_funds: ya_inc.mutual_funds * (1 + g.mutual_funds),
                stocks: ya_inc.stocks * (1 + g.stocks),
                fd: ya_inc.fd * (1 + g.fd),
                gold: ya_inc.gold * (1 + g.gold),
                cash_saving: ya_inc.cash_saving * (1 + g.cash_saving),
                nps: ya_inc.nps * (1 + g.nps),
                ppf_epf: ya_inc.ppf_epf * (1 + g.ppf_epf),
            };
            ya_exc = {
                mutual_funds: ya_exc.mutual_funds * (1 + g.mutual_funds),
                stocks: ya_exc.stocks * (1 + g.stocks),
                fd: ya_exc.fd * (1 + g.fd),
                gold: ya_exc.gold * (1 + g.gold),
                cash_saving: ya_exc.cash_saving * (1 + g.cash_saving),
                nps: ya_exc.nps * (1 + g.nps),
                ppf_epf: ya_exc.ppf_epf * (1 + g.ppf_epf),
            };

            // 2. Portfolio totals after growth
            const sum_assets = (ya: ProjectionAssets) =>
                ya.mutual_funds + ya.stocks + ya.fd + ya.gold +
                ya.cash_saving + ya.nps + ya.ppf_epf;
            const portfolio_inc = sum_assets(ya_inc);
            const portfolio_exc = sum_assets(ya_exc);

            // 3. Income and base expenses (same for both tracks)
            const income = annual_income_base * Math.pow(1 + FIRE_CONSTANTS.income_growth, i);
            const expenses_raw = annual_expenses_base * Math.pow(1 + FIRE_CONSTANTS.expense_growth, i);

            // 4. EMI — partial-year aware
            let yearly_emi = 0;
            const months_elapsed = i * 12;
            for (const loan of loans) {
                const months_remaining = loan.tenure_months - months_elapsed;
                const months_paid = Math.max(0, Math.min(12, months_remaining));
                if (months_paid > 0) yearly_emi += loan.monthly_emi * months_paid;
            }

            // 5. Total expenses — the only hard branch between the two tracks
            const total_expenses_inc = expenses_raw + yearly_emi;
            const total_expenses_exc = expenses_raw;

            // 6. Goal SIP commitment (same for both tracks — not EMI-dependent)
            const goal_commitment_annual = goals.reduce((sum, goal) =>
                (current_year + i) <= goal.target_year
                    ? sum + goal.required_monthly_sip * 12
                    : sum
                , 0);

            // 7. Goal payouts (same for both tracks)
            const goal_hits: { label: string; amount: number }[] = [];
            const goals_payout = goals.reduce((sum, goal) => {
                const fv = this.calculate_goal_future_value(goal, current_year, current_year + i);
                if (fv && fv > 0) {
                    goal_hits.push({ label: `${goal.name} (${goal.target_year})`, amount: Math.round(fv) });
                    return sum + fv;
                }
                return sum;
            }, 0);

            // 8. Savings per track
            const savings_inc = income - total_expenses_inc - goal_commitment_annual;
            const savings_exc = income - total_expenses_exc - goal_commitment_annual;

            // 9. Portfolio value per track
            const portfolio_value_inc = portfolio_inc + savings_inc - goals_payout;
            const portfolio_value_exc = portfolio_exc + savings_exc - goals_payout;

            // 10. Reinvest into each track's cash_saving independently
            ya_inc.cash_saving += Math.max(0, savings_inc - goals_payout);
            ya_exc.cash_saving += Math.max(0, savings_exc - goals_payout);

            // 11. FIRE number and percentage per track
            const fire_number_inc = (total_expenses_inc + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;
            const fire_number_exc = (total_expenses_exc + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;
            const fire_percentage_inc = fire_number_inc > 0 ? (portfolio_value_inc * 100) / fire_number_inc : 0;
            const fire_percentage_exc = fire_number_exc > 0 ? (portfolio_value_exc * 100) / fire_number_exc : 0;

            proj.push({
                year: current_year + i,
                income: Math.round(income),
                goal_commitment_annual: Math.round(goal_commitment_annual),
                goals_payout: Math.round(goals_payout),
                goal_hits,
                total_expenses: { emi_include: Math.round(total_expenses_inc), emi_exclude: Math.round(total_expenses_exc) },
                savings: { emi_include: Math.round(savings_inc), emi_exclude: Math.round(savings_exc) },
                portfolio_value: { emi_include: Math.round(portfolio_value_inc), emi_exclude: Math.round(portfolio_value_exc) },
                fire_number: { emi_include: Math.round(fire_number_inc), emi_exclude: Math.round(fire_number_exc) },
                fire_percentage: { emi_include: parseFloat(fire_percentage_inc.toFixed(2)), emi_exclude: parseFloat(fire_percentage_exc.toFixed(2)) },
            });
        }

        return proj;
    }

    //  Goal SIP Calculator 
    private calculate_goal_sip(
        goal: NormalizedGoalWithSIP,
        dob: Date | null,
        monthly_expenses_total: number,
    ): { sip: number; corpus: number } {
        const current_year = new Date().getFullYear();

        // ── Retirement (goal_type_id === 3) ──────────────────────────────────
        if (goal.goal_type_id === 3) {
            if (!dob) return { sip: 0, corpus: 0 };

            const birth_year = new Date(dob).getFullYear();
            const present_age = current_year - birth_year;
            // target_year is already birth_year + retirement_age (set in normalize)
            const retirement_age = goal.target_year - birth_year;
            const years_to_retirement = retirement_age - present_age;
            if (years_to_retirement <= 0) return { sip: 0, corpus: 0 };

            const life_expectancy = goal.life_expectancy ?? 80;
            const years_post_retirement = life_expectancy - retirement_age;
            if (years_post_retirement <= 0) return { sip: 0, corpus: 0 };

            const monthly_exp = goal.current_monthly_exp ?? monthly_expenses_total;
            if (monthly_exp <= 0) return { sip: 0, corpus: 0 };

            const r = FIRE_CONSTANTS.retirement_return;    // 0.10
            const inflation = FIRE_CONSTANTS.retirement_inflation; // 0.06

            const current_annual_expense = monthly_exp * 12;
            const annual_expense_at_retirement =
                current_annual_expense * Math.pow(1 + inflation, years_to_retirement);

            // Growing annuity PV for corpus needed at retirement
            let retirement_corpus = 0;
            if (Math.abs(r - inflation) < 1e-9) {
                const pv_annuity = annual_expense_at_retirement * (years_post_retirement / (1 + r));
                retirement_corpus = pv_annuity * (1 + r);
            } else {
                const growth_factor = (1 + inflation) / (1 + r);
                const pv_growing_annuity =
                    annual_expense_at_retirement *
                    (1 - Math.pow(growth_factor, years_post_retirement)) /
                    (r - inflation);
                retirement_corpus = pv_growing_annuity * (1 + r);
            }

            const months_to_retirement = years_to_retirement * 12;
            if (months_to_retirement <= 0) return { sip: 0, corpus: 0 };

            // Monthly SIP PMT (annuity-due) to accumulate retirement_corpus
            const rm = Math.pow(1 + r, 1 / 12) - 1;
            const fv_factor = Math.pow(1 + rm, months_to_retirement) - 1;
            if (fv_factor <= 0 || rm <= 0) return { sip: 0, corpus: 0 };

            const monthly_sip = (retirement_corpus * rm) / (fv_factor * (1 + rm));
            const sip = Math.round(monthly_sip);
            return { sip: isFinite(sip) ? sip : 0, corpus: Math.round(retirement_corpus) };
        }

        // ── Non-retirement (types 1, 2, 4) ───────────────────────────────────
        // Formula: numerator / (11 × 12 × denominator) from FireReport.tsx
        const years_to_goal = goal.target_year - current_year;
        const denominator = Math.pow(1 + FIRE_CONSTANTS.goal_sip_return, years_to_goal) - 1; // (1.1^n - 1)
        if (denominator === 0) return { sip: 0, corpus: 0 };
        const numerator = goal.target_amount * Math.pow(1 + FIRE_CONSTANTS.goal_fv_growth, years_to_goal); // target × 1.08^n
        const value = numerator / (11 * 12 * denominator);
        const sip = isFinite(value) ? Math.round(value) : 0;
        return { sip, corpus: Math.round(numerator) };
    }

    //  Goal Future Value 
    // Exact port of calculateGoalFutureValue() from FireReport.tsx
    private calculate_goal_future_value(
        goal: NormalizedGoalWithSIP,
        current_year: number,
        year: number,
    ): number | null {
        // Retirement goals have no lump-sum payout — covered by SIP
        if (goal.goal_type_id === 3) return null;
        if (year !== goal.target_year) return null;

        const years_to_goal = goal.target_year - current_year;
        if (years_to_goal <= 0) return goal.target_amount;
        return goal.target_amount * Math.pow(1 + FIRE_CONSTANTS.goal_fv_growth, years_to_goal);
    }

    // Helpers 

    private to_num(val: Prisma.Decimal | null | undefined): number {
        return val?.toNumber() ?? 0;
    }

    private extract_age(dob: Date | null): number {
        if (!dob) return FIRE_CONSTANTS.default_age;
        const age = Math.floor((Date.now() - new Date(dob).getTime()) / 31_557_600_000);
        return Math.max(0, age);
    }

    /** Map DB loan rows → TrackedLoan; tenure_months kept as original (not mutated in loop) */
    private normalize_loans(loans: NonNullable<UserWithAllData["user_loan"]>): TrackedLoan[] {
        return loans.map(l => ({
            loan_type: l.loan_type,
            monthly_emi: this.to_num(l.monthly_emi),
            tenure_months: l.tenure_months ?? 0,
        }));
    }

    // ── 6 Enrichment helpers ──────────────────────────────────────────────────

    private extract_assets_breakdown(data: UserFireReportData): AssetsBreakdown {
        const mf = this.to_num(data.user_assets?.mutual_funds);
        const stocks = this.to_num(data.user_assets?.stocks);
        const fd = this.to_num(data.user_assets?.fd);
        const gold = this.to_num(data.user_assets?.gold);
        const cash_saving = this.to_num(data.user_assets?.cash_saving);
        const total_liquid = mf + stocks + fd + cash_saving;
        const total_illiquid = gold;
        return { mutual_funds: mf, stocks, fd, gold, cash_saving, total_liquid, total_illiquid, total: total_liquid + total_illiquid };
    }

    private extract_liabilities(data: UserFireReportData): LiabilityItem[] {
        return (data.user_loan ?? []).map(l => ({
            loan_type: l.loan_type,
            outstanding: this.to_num(l.outstanding_amount),
            monthly_emi: this.to_num(l.monthly_emi),
            tenure_months: l.tenure_months ?? 0,
        }));
    }

    private extract_expense_breakdown(data: UserFireReportData): ExpenseBreakdown {
        const house = this.to_num(data.user_finance?.expense_house);
        const food = this.to_num(data.user_finance?.expense_food);
        const transportation = this.to_num(data.user_finance?.expense_transportation);
        const others = this.to_num(data.user_finance?.expense_others);
        const total_annual = house + food + transportation + others;
        return { house, food, transportation, others, total_monthly: Math.round(total_annual / 12), total_annual };
    }

    private compute_insurance_summary(data: UserFireReportData, metrics: ComputedMetrics): InsuranceSummary {
        const term_life_have = this.to_num(data.user_insurance?.life_insurance);
        const health_have = this.to_num(data.user_insurance?.health_insurance);

        // Edge case: if no valid DOB, skip recommendations
        if (!data.dob) {
            return {
                term_life_have,
                term_life_recommended: 0,
                term_life_gap: 0,
                health_have,
                health_recommended: 0,
                health_gap: 0,
            };
        }

        // Extract current age
        const current_age = this.extract_age(data.dob);
        const annual_income = metrics.monthly_income * 12;

        // ── Term Life Insurance: Age-based multiplier × annual_income ───────────
        let term_multiplier = 10;
        if (current_age >= 20 && current_age <= 30) {
            term_multiplier = 30;
        } else if (current_age > 30 && current_age <= 40) {
            term_multiplier = 20;
        } else if (current_age > 40 && current_age <= 50) {
            term_multiplier = 15;
        } else if (current_age > 50) {
            term_multiplier = 10;
        }
        const term_life_recommended = Math.round(term_multiplier * annual_income);

        // ── Health Insurance: Age-based fixed lakhs (convert to rupees) ────────
        let health_lakhs = 10;
        if (current_age >= 20 && current_age <= 30) {
            health_lakhs = 10;
        } else if (current_age > 30 && current_age <= 40) {
            health_lakhs = 15;
        } else if (current_age > 40 && current_age <= 50) {
            health_lakhs = 25;
        } else if (current_age > 50) {
            health_lakhs = 40;
        }
        const health_recommended = Math.round(health_lakhs * 100_000);

        return {
            term_life_have,
            term_life_recommended,
            term_life_gap: Math.max(0, term_life_recommended - term_life_have),
            health_have,
            health_recommended,
            health_gap: Math.max(0, health_recommended - health_have),
        };
    }

    /** Deterministic backward simulation of 6 quarterly data points for trend charts.
     *  Uses: nw(i) = net_worth × 0.98^i   fire_number(i) = fn_now × 0.985^i
     *  where i=5 is 5 quarters ago and i=0 is the current quarter. */
    private generate_quarterly_simulation(metrics: ComputedMetrics, projection: ProjectionRow[]): QuarterlyPoint[] {
        const net_worth = metrics.net_worth;
        const fire_number_now = projection[0]?.fire_number.emi_include ?? 0;
        const now = new Date();
        const current_q = Math.floor(now.getMonth() / 3); // 0-3
        const current_year = now.getFullYear();

        const quarter_label = (q_offset: number): string => {
            let q = current_q - q_offset;
            let y = current_year;
            while (q < 0) { q += 4; y--; }
            return `Q${q + 1} ${y}`;
        };

        const points: QuarterlyPoint[] = [];
        for (let i = 5; i >= 0; i--) {
            const nw = net_worth * Math.pow(0.98, i);
            const fn = fire_number_now * Math.pow(0.985, i);
            const fp = fn > 0 ? (nw / fn) * 100 : 0;
            points.push({
                quarter: quarter_label(i),
                net_worth: parseFloat((nw / 100_000).toFixed(2)),
                fire_number: parseFloat((fn / 100_000).toFixed(2)),
                fire_percentage: parseFloat(fp.toFixed(2)),
            });
        }
        return points;
    }

    private generate_yearly_goal_table(projection: ProjectionRow[]): YearlyGoalRequirement[] {
        return projection.map(row => ({
            year: row.year,
            monthly_required: Math.round(row.goal_commitment_annual / 12),
            yearly_required: row.goal_commitment_annual,
        }));
    }

    /** Map DB goal rows → NormalizedGoalWithSIP with pre-computed required_monthly_sip */
    private normalize_goals_with_sip(
        goals: NonNullable<UserWithAllData["user_goals"]>,
        dob: Date | null,
        monthly_expenses_total: number,
    ): NormalizedGoalWithSIP[] {
        const current_year = new Date().getFullYear();
        const birth_year = dob ? new Date(dob).getFullYear() : null;

        const label_map: Record<number, string> = {
            1: "Child Education",
            2: "Child Marriage",
            3: "Retirement",
            4: "Wealth Goal",
        };

        const normalized: NormalizedGoalWithSIP[] = [];

        for (const g of goals) {
            // ── Type 3: Retirement ─────
            if (g.goal_type_id === 3) {
                // Need dob + retirement_age to derive target_year
                if (birth_year === null || g.retirement_age == null) continue;
                const target_year = birth_year + g.retirement_age;
                if (target_year <= current_year) continue;

                const entry: NormalizedGoalWithSIP = {
                    id: g.id,
                    name: "Retirement Fund",
                    category: "Retirement",
                    target_year,
                    target_amount: 0,
                    life_expectancy: g.life_expectancy ?? null,
                    current_monthly_exp: g.current_monthly_expense
                        ? this.to_num(g.current_monthly_expense)
                        : null,
                    required_monthly_sip: 0,
                    future_value: 0,
                    goal_type_id: 3,
                };
                const { sip: ret_sip, corpus: ret_corpus } = this.calculate_goal_sip(entry, dob, monthly_expenses_total);
                entry.required_monthly_sip = ret_sip;
                entry.future_value = ret_corpus;
                normalized.push(entry);
                continue;
            }

            // ── Types 1, 2, 4: Standard goals ────────────────────────────────
            if (g.years_left == null || g.years_left <= 0) continue;
            if (g.current_goal_cost == null) continue;

            const target_year = current_year + g.years_left;
            const name =
                g.goal_type_id === 4
                    ? (g.goal_item_name ?? g.goal_name ?? label_map[4])
                    : label_map[g.goal_type_id] ?? "Financial Goal";

            const entry: NormalizedGoalWithSIP = {
                id: g.id,
                name,
                category: label_map[g.goal_type_id] ?? "Goal",
                target_year,
                target_amount: this.to_num(g.current_goal_cost),
                life_expectancy: null,
                current_monthly_exp: null,
                required_monthly_sip: 0,
                future_value: 0,
                goal_type_id: g.goal_type_id,
            };
            const { sip, corpus } = this.calculate_goal_sip(entry, dob, monthly_expenses_total);
            entry.required_monthly_sip = sip;
            entry.future_value = corpus;
            normalized.push(entry);
        }

        return normalized;
    }
}

export const fire_report_service = new FireReportServiceClass();