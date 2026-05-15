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
import { user_finnsys_service } from "./user.finnsys.service.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { FireReportFinalResponse } from "../lib/fire-report.types.js";
import { db } from "../server.js";

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

        // Extract initial assets
        const initial_assets: ProjectionAssets = {
            mutual_funds: this.to_num(data.user_assets?.mutual_funds),
            stocks: this.to_num(data.user_assets?.stocks),
            fd: this.to_num(data.user_assets?.fd),
            gold: this.to_num(data.user_assets?.gold),
            cash_saving: this.to_num(data.user_assets?.cash_saving),
            nps: 0,
            ppf_epf: 0,
        };

        // Get year-0 portfolio values with asset growth and partial-year aware EMI
        const { portfolio_value_inc, portfolio_value_exc, yearly_emi } =
            this.compute_year_zero_portfolio(initial_assets, computed_metrics, goals, loans);

        const goal_commitment_annual = goals.reduce((sum, goal) =>
            current_year <= goal.target_year
                ? sum + (goal.required_monthly_sip * 12)
                : sum
            , 0);

        const total_expenses_exclude = computed_metrics.total_annual_expenses;
        const total_expenses_include = total_expenses_exclude + yearly_emi;

        const fire_number_exclude = (total_expenses_exclude + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;
        const fire_number_include = (total_expenses_include + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;

        const fire_percentage_exclude = fire_number_exclude > 0
            ? (portfolio_value_exc * 100) / fire_number_exclude
            : 0;
        const fire_percentage_include = fire_number_include > 0
            ? (portfolio_value_inc * 100) / fire_number_include
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

    async get_fire_report(user_id: string, projection_years: number = FIRE_CONSTANTS.default_projection_years): Promise<FireReportFinalResponse> {
        const data = await user_service.get_user_fire_report_data(user_id);

        if (!data) {
            logger.error(`No user data found for user_id: ${user_id}`);
            throw new AppError("User data not found", 404, "USER_DATA_NOT_FOUND");
        }

        // 1. Fetch Real Data for "Actual" track
        let actual_mf = 0;
        let actual_fd = 0;

        try {
            // Fetch Mutual Funds from Finnsys if credentials exist
            if (data.usr && data.pwd) {
                const finnsys_res = await user_finnsys_service.get_user_portfolio_finnsys(data.usr, data.pwd);
                if (finnsys_res && finnsys_res.code === 1 && finnsys_res.results) {
                    actual_mf = finnsys_res.results.reduce((sum: number, item: any) => sum + (parseFloat(String(item.currval).replace(/,/g, "")) || 0), 0);
                }
            }
        } catch (error) {
            logger.warn(`Failed to fetch Finnsys portfolio for user ${user_id}: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
            // Fetch Fixed Deposits with FD_CREATED and MATURED status
            const fd_res = await user_service.get_user_fd_data({
                user_id,
                query: { status: { in: ["FD_CREATED", "MATURED"] } }
            });
            actual_fd = fd_res.fd_transactions.reduce((sum, tx) => sum + (parseFloat(String(tx.amount)) || 0), 0);
        } catch (error) {
            logger.warn(`Failed to fetch FD transactions for user ${user_id}: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 2. Generate Projected Report (Onboarding data)
        const projected = await this.generate_report_with_assets(data, projection_years);

        // 3. Generate Actual Report (Real transaction data for MF & FD)
        const actual_assets: ProjectionAssets = {
            mutual_funds: this.to_num(data.user_assets?.mutual_funds) + actual_mf,
            fd: this.to_num(data.user_assets?.fd) + actual_fd,
            stocks: this.to_num(data.user_assets?.stocks),
            gold: this.to_num(data.user_assets?.gold),
            cash_saving: this.to_num(data.user_assets?.cash_saving),
            nps: 0,
            ppf_epf: 0,
        };

        const actual = await this.generate_report_with_assets(data, projection_years, actual_assets);

        return {
            actual,
            projected,
        };
    }

    private async generate_report_with_assets(data: UserFireReportData, projection_years: number, override_assets?: ProjectionAssets): Promise<FireReportCoreResponse> {
        const computed_metrics = this.compute_metrics(data, override_assets);

        const monthly_expenses_total = computed_metrics.total_annual_expenses / 12;

        const goals = this.normalize_goals_with_sip(
            data.user_goals ?? [],
            data.dob,
            monthly_expenses_total,
        );

        const projection = this.compute_projection(data, computed_metrics, goals, projection_years, override_assets);
        const quarterly_simulation = await this.generate_quarterly_simulation(data.id, computed_metrics, projection);

        return {
            user_profile: {
                name: data.full_name,
                age: this.extract_age(data.dob),
                city: data.city,
            },
            computed_metrics,
            goals,
            projection,
            assets_breakdown: this.extract_assets_breakdown(data, override_assets),
            liabilities: this.extract_liabilities(data),
            expense_breakdown: this.extract_expense_breakdown(data),
            insurance_summary: this.compute_insurance_summary(data, computed_metrics),
            quarterly_simulation,
            yearly_goal_requirements: this.generate_yearly_goal_table(projection),
        };
    }

    // Compute Metrics 
    private compute_metrics(data: UserFireReportData, override_assets?: ProjectionAssets): ComputedMetrics {
        const finance = data.user_finance;
        const assets = data.user_assets;
        const loans = data.user_loan ?? [];

        // User assets
        const mutual_funds = override_assets ? override_assets.mutual_funds : this.to_num(assets?.mutual_funds);
        const stocks = override_assets ? override_assets.stocks : this.to_num(assets?.stocks);
        const fd = override_assets ? override_assets.fd : this.to_num(assets?.fd);
        const gold = override_assets ? override_assets.gold : this.to_num(assets?.gold);
        const cash_saving = override_assets ? override_assets.cash_saving : this.to_num(assets?.cash_saving);

        // User finance
        const annual_income = this.to_num(finance?.annual_income);
        const expense_house = this.to_num(finance?.expense_house);
        const expense_food = this.to_num(finance?.expense_food);
        const expense_transportation = this.to_num(finance?.expense_transportation);
        const expense_others = this.to_num(finance?.expense_others);

        const total_assets = mutual_funds + stocks + fd + gold + cash_saving;
        const liquid_assets = mutual_funds + stocks + fd + cash_saving + gold;
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

    // Year-0 Portfolio Calculation (with asset growth + partial-year aware EMI)
    private compute_year_zero_portfolio(
        initial_assets: ProjectionAssets,
        metrics: ComputedMetrics,
        goals: NormalizedGoalWithSIP[],
        loans: TrackedLoan[]
    ): { portfolio_value_inc: number; portfolio_value_exc: number; yearly_emi: number } {
        const current_year = new Date().getFullYear();
        const g = FIRE_CONSTANTS.asset_growth;

        // 1. Apply per-asset growth
        let ya_inc: ProjectionAssets = {
            mutual_funds: initial_assets.mutual_funds * (1 + g.mutual_funds),
            stocks: initial_assets.stocks * (1 + g.stocks),
            fd: initial_assets.fd * (1 + g.fd),
            gold: initial_assets.gold * (1 + g.gold),
            cash_saving: initial_assets.cash_saving * (1 + g.cash_saving),
            nps: initial_assets.nps * (1 + g.nps),
            ppf_epf: initial_assets.ppf_epf * (1 + g.ppf_epf),
        };
        let ya_exc: ProjectionAssets = {
            mutual_funds: initial_assets.mutual_funds * (1 + g.mutual_funds),
            stocks: initial_assets.stocks * (1 + g.stocks),
            fd: initial_assets.fd * (1 + g.fd),
            gold: initial_assets.gold * (1 + g.gold),
            cash_saving: initial_assets.cash_saving * (1 + g.cash_saving),
            nps: initial_assets.nps * (1 + g.nps),
            ppf_epf: initial_assets.ppf_epf * (1 + g.ppf_epf),
        };

        // 2. Portfolio totals after growth
        const sum_assets = (ya: ProjectionAssets) =>
            ya.mutual_funds + ya.stocks + ya.fd + ya.gold +
            ya.cash_saving + ya.nps + ya.ppf_epf;
        const portfolio_inc = sum_assets(ya_inc);
        const portfolio_exc = sum_assets(ya_exc);

        // 3. Income and base expenses (no growth for year 0)
        const annual_income_base = metrics.monthly_income * 12;
        const annual_expenses_base = metrics.total_annual_expenses;

        // 4. EMI — partial-year aware (for year 0, months_elapsed = 0)
        let yearly_emi = 0;
        for (const loan of loans) {
            const months_remaining = loan.tenure_months;
            const months_paid = Math.max(0, Math.min(12, months_remaining));
            if (months_paid > 0) yearly_emi += loan.monthly_emi * months_paid;
        }

        // 5. Total expenses — the only hard branch between the two tracks
        const total_expenses_inc = annual_expenses_base + yearly_emi;
        const total_expenses_exc = annual_expenses_base;

        // 6. Goal SIP commitment (same for both tracks)
        const goal_commitment_annual = goals.reduce((sum, goal) =>
            current_year <= goal.target_year
                ? sum + goal.required_monthly_sip * 12
                : sum
            , 0);

        // 7. Goal payouts (same for both tracks)
        const goals_payout = goals.reduce((sum, goal) => {
            const fv = this.calculate_goal_future_value(goal, current_year, current_year);
            if (fv && fv > 0) {
                return sum + fv;
            }
            return sum;
        }, 0);

        // 8. Savings per track
        const savings_inc = annual_income_base - total_expenses_inc - goal_commitment_annual;
        const savings_exc = annual_income_base - total_expenses_exc - goal_commitment_annual;

        // 9. Portfolio value per track
        const portfolio_value_inc = portfolio_inc + savings_inc - goals_payout;
        const portfolio_value_exc = portfolio_exc + savings_exc - goals_payout;

        return {
            portfolio_value_inc,
            portfolio_value_exc,
            yearly_emi
        };
    }

    //  Projection ( per-asset growth, SIP goals, partial EMI — dual-track: emi_include / emi_exclude)
    private compute_projection(data: UserFireReportData, metrics: ComputedMetrics, goals: NormalizedGoalWithSIP[], projection_years: number, override_assets?: ProjectionAssets): ProjectionRow[] {
        const current_year = new Date().getFullYear();
        const loans = this.normalize_loans(data.user_loan ?? []);
        const g = FIRE_CONSTANTS.asset_growth;

        const initial_assets: ProjectionAssets = override_assets ?? {
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

    private extract_assets_breakdown(data: UserFireReportData, override_assets?: ProjectionAssets): AssetsBreakdown {
        const mf = override_assets ? override_assets.mutual_funds : this.to_num(data.user_assets?.mutual_funds);
        const stocks = override_assets ? override_assets.stocks : this.to_num(data.user_assets?.stocks);
        const fd = override_assets ? override_assets.fd : this.to_num(data.user_assets?.fd);
        const gold = override_assets ? override_assets.gold : this.to_num(data.user_assets?.gold);
        const cash_saving = override_assets ? override_assets.cash_saving : this.to_num(data.user_assets?.cash_saving);
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

    /** Deterministic historical simulation combined with real Snapshots. 
     *  Uses UserNetWorthSnapshot table for actual past data. 
     *  Falls back to 0 for periods before account creation. */
    private async generate_quarterly_simulation(user_id: string, metrics: ComputedMetrics, projection: ProjectionRow[]): Promise<QuarterlyPoint[]> {
        const current_net_worth = metrics.net_worth;
        const fire_number_now = projection[0]?.fire_number.emi_include ?? 0;
        const now = new Date();
        const current_year = now.getFullYear();

        // 1. Fetch real historical snapshots
        const snapshots = await db.userNetWorthSnapshot.findMany({
            where: { userId: user_id },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 24 // Last 2 years of possible months
        });

        // 2. Fetch User to get createdAt (baseline)
        const user = await db.user.findUnique({ where: { id: user_id }, select: { createdAt: true } });
        const joined_date = user?.createdAt ?? new Date();

        const quarter_label = (y: number, q: number): string => `Q${q + 1} ${y}`;

        const points: QuarterlyPoint[] = [];

        // Generate last 6 quarters
        for (let i = 5; i >= 0; i--) {
            // Calculate target Quarter/Year
            let target_q = Math.floor(now.getMonth() / 3) - i;
            let target_y = current_year;
            while (target_q < 0) { target_q += 4; target_y--; }

            // NEW: Skip quarters that end before the user joined
            const quarter_end_date = new Date(target_y, target_q * 3 + 3, 0); // Last day of quarter
            if (quarter_end_date < joined_date && i !== 0) {
                // If this is the quarter immediately before onboarding, we keep it as a baseline
                // to avoid -100% QoQ change for new users.
                const next_q_date = new Date(target_y, target_q * 3 + 6, 0);
                if (next_q_date < joined_date) {
                    continue;
                }
            }

            let nw = 0;
            const is_current_quarter = i === 0;

            if (is_current_quarter) {
                nw = current_net_worth;
            } else {
                // Look for a snapshot in this quarter
                const q_months = [target_q * 3 + 1, target_q * 3 + 2, target_q * 3 + 3];
                const snapshot = snapshots.find(s => s.year === target_y && q_months.includes(s.month));

                if (snapshot) {
                    nw = snapshot.netWorth;
                } else {
                    // Fallback logic for missing snapshots
                    const quarter_start_date = new Date(target_y, target_q * 3, 1);
                    if (quarter_start_date < joined_date) {
                        // If it's the "baseline" quarter (just before onboarding), we match current NW
                        // to ensure a 0% change instead of -100%.
                        nw = current_net_worth;
                    } else {
                        nw = current_net_worth; // Post-onboarding but missing snapshot
                    }
                }
            }

            // Fire number simulation (we don't snapshot this, so we simulate progress)
            const fn_growth = Math.pow(0.985, i);
            const fn = fire_number_now * fn_growth;
            const fp = fn > 0 ? (nw / fn) * 100 : 0;

            points.push({
                quarter: quarter_label(target_y, target_q),
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