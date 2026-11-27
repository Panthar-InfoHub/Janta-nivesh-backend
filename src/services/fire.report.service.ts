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
    FireReportFinalResponse,
} from "../lib/fire-report.types.js";

import { UserFireReportData, UserWithAllData } from "../lib/types.js";
import { calculateGoalProjections } from "../lib/goal-calculator.js";
import { user_service } from "./user.service.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { db } from "../server.js";

class FireReportServiceClass {

    /**
     * Home-screen FIRE snapshot. Built from the SAME projection as the full report (row 0 = today),
     * so the home card, the report header and the PDF always show the same FIRE number / FIRE %.
     */
    async get_current_fire_number(user_id: string) {
        const [data, portfolio_summary] = await Promise.all([
            user_service.get_user_fire_report_data(user_id),
            user_service.get_user_portfolio_summary(user_id),
        ]);

        if (!data) {
            logger.error(`No user data found for user_id: ${user_id}`);
            throw new AppError("User data not found", 404, "USER_DATA_NOT_FOUND");
        }

        const actual_assets = this.build_actual_assets(data, portfolio_summary);
        const computed_metrics = this.compute_metrics(data, actual_assets);
        const goals = this.normalize_goals_with_sip(
            data.user_goals ?? [],
            data.dob,
            computed_metrics.total_annual_expenses / 12,
        );
        const [today] = this.compute_projection(data, computed_metrics, goals, 1, actual_assets);

        return {
            year: today.year,
            net_worth: Math.round(computed_metrics.net_worth),
            // All goal SIPs the user should be running this year (incl. retirement)
            goal_commitment_annual: Math.round(this.total_goal_sip_annual(goals, today.year)),
            total_expenses: today.total_expenses,
            fire_number: today.fire_number,
            fire_percentage: today.fire_percentage,
        };
    }

    async get_fire_report(
        user_id: string,
        projection_years: number = FIRE_CONSTANTS.default_projection_years,
    ): Promise<FireReportFinalResponse> {
        const [data, portfolio_summary] = await Promise.all([
            user_service.get_user_fire_report_data(user_id),
            user_service.get_user_portfolio_summary(user_id),
        ]);

        if (!data) {
            logger.error(`No user data found for user_id: ${user_id}`);
            throw new AppError("User data not found", 404, "USER_DATA_NOT_FOUND");
        }

        // Projected report: onboarding-declared assets only
        const projected = await this.generate_report_with_assets(data, projection_years);

        // Actual report: native MF holdings + FD transactions + external declared assets
        const actual = await this.generate_report_with_assets(
            data,
            projection_years,
            this.build_actual_assets(data, portfolio_summary),
        );

        return { actual, projected };
    }

    /** Native app holdings (MF current value, FD) + externally declared assets from onboarding. */
    private build_actual_assets(data: UserFireReportData, portfolio_summary: any): ProjectionAssets {
        const actual_mf = this.to_num(portfolio_summary?.mutual_funds);
        const actual_fd = this.to_num(portfolio_summary?.fixed_deposits);
        return {
            mutual_funds: actual_mf + this.to_num(data.user_assets?.mutual_funds),
            stocks: this.to_num(data.user_assets?.stocks),
            fd: actual_fd + this.to_num(data.user_assets?.fd),
            gold: this.to_num(data.user_assets?.gold),
            cash_saving: this.to_num(data.user_assets?.cash_saving),
            nps: 0,
            ppf_epf: 0,
        };
    }

    private async generate_report_with_assets(data: UserFireReportData, projection_years: number, override_assets?: ProjectionAssets): Promise<FireReportCoreResponse> {
        const computed_metrics = this.compute_metrics(data, override_assets);

        const goals = this.normalize_goals_with_sip(
            data.user_goals ?? [],
            data.dob,
            computed_metrics.total_annual_expenses / 12,
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
            yearly_goal_requirements: this.generate_yearly_goal_table(goals, projection),
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
            const liquid_assets = mutual_funds + stocks + fd + cash_saving; // gold is reported as illiquid, not both
            const illiquid_assets = gold;

            const total_liabilities = loans.reduce((sum, l) => sum + this.to_num(l.outstanding_amount), 0);
            const total_monthly_emi = loans.reduce((sum, l) => sum + this.to_num(l.monthly_emi), 0);

            const net_worth = total_assets - total_liabilities;
            const monthly_income = annual_income / 12;
            const total_annual_expenses = (expense_house + expense_food + expense_transportation + expense_others) * 12;
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

        /**
         * FIRE projection.
         *
         * Row 0 = TODAY: portfolio is the user's actual investable assets (no growth, no surplus added yet).
         * Row j (j >= 1) = start of year j:
         *   portfolio_j = portfolio_{j-1} × (1 + 9%)
         *               + invested surplus of year j-1   (see rules)
         *               − goal payouts due in year j     (full future value, withdrawn from the portfolio)
         *
         * Rules (client, 27 Nov 2026):
         *   - One flat portfolio return (FIRE_CONSTANTS.portfolio_return = 9%) for every asset type and every age.
         *   - Surplus = income − living expenses − EMI. EMI is real cash in both tracks, so the portfolio is the
         *     same for emi_include / emi_exclude; the toggle only changes total_expenses → FIRE number.
         *   - Age < 45: 50% of a positive surplus is added; a deficit is deducted 100%.
         *   - Age >= 45 (the year the user is 45 and every year after): surplus is neither added nor deducted.
         *     The last surplus added is the one earned in the age-44 year.
         *   - Goal SIPs are informational. They are not expenses, not part of the FIRE number and not deducted
         *     from surplus. Only the goal PAYOUT hits the portfolio (at every age). Retirement goals have no payout.
         *   - Payouts and deficits are withdrawn most-liquid first, never below 0.
         */
        private compute_projection(data: UserFireReportData, metrics: ComputedMetrics, goals: NormalizedGoalWithSIP[], projection_years: number, override_assets?: ProjectionAssets): ProjectionRow[] {
            const current_year = new Date().getFullYear();
            const current_age = this.extract_age(data.dob);
            const loans = this.normalize_loans(data.user_loan ?? []);

            const initial_assets: ProjectionAssets = override_assets ?? {
                mutual_funds: this.to_num(data.user_assets?.mutual_funds),
                stocks: this.to_num(data.user_assets?.stocks),
                fd: this.to_num(data.user_assets?.fd),
                gold: this.to_num(data.user_assets?.gold),
                cash_saving: this.to_num(data.user_assets?.cash_saving),
                nps: 0,
                ppf_epf: 0,
            };

            let ya: ProjectionAssets = { ...initial_assets, new_savings: 0 };

            const annual_income_base = metrics.monthly_income * 12;
            const annual_expenses_base = metrics.total_annual_expenses;
            const payout_goals = goals.filter(goal => goal.category !== "Retirement");

            let prev_invested_flow = 0;
            const proj: ProjectionRow[] = [];

            for (let j = 0; j < projection_years; j++) {
                const year = current_year + j;
                const goal_hits: { label: string; amount: number }[] = [];
                let goals_payout = 0;

                if (j > 0) {
                    // 1. One year of growth at the flat portfolio return
                    ya = this.grow_assets(ya);

                    // 2. Add last year's invested surplus (or take out last year's deficit), end-of-year
                    this.apply_cash_flow(ya, prev_invested_flow);

                    // 3. Goal payouts due now come straight out of the portfolio
                    for (const goal of payout_goals) {
                        const payout = this.calculate_goal_future_value(goal, current_year, year) ?? 0;
                        if (payout <= 0) continue;
                        goals_payout += payout;
                        goal_hits.push({ label: `${goal.name} (${goal.target_year})`, amount: Math.round(payout) });
                    }
                    this.apply_cash_flow(ya, -goals_payout);
                }

                const portfolio = this.sum_assets(ya);

                // 4. Cash flows for the 12 months starting at this row
                const income = annual_income_base * Math.pow(1 + FIRE_CONSTANTS.income_growth, j);
                const expenses_raw = annual_expenses_base * Math.pow(1 + FIRE_CONSTANTS.expense_growth, j);

                let yearly_emi = 0;
                for (const loan of loans) {
                    const months_paid = Math.max(0, Math.min(12, loan.tenure_months - j * 12));
                    yearly_emi += loan.monthly_emi * months_paid;
                }

                const total_expenses_inc = expenses_raw + yearly_emi;
                const total_expenses_exc = expenses_raw;

                const surplus = income - expenses_raw - yearly_emi;
                const age_this_year = current_age + j;
                if (age_this_year >= FIRE_CONSTANTS.surplus_stop_age) {
                    prev_invested_flow = 0;                                           // 45+: no addition, no deduction
                } else if (surplus >= 0) {
                    prev_invested_flow = surplus * FIRE_CONSTANTS.surplus_investment_ratio; // < 45: 50% added
                } else {
                    prev_invested_flow = surplus;                                     // < 45: deficit deducted 100%
                }

                // Informational only: SIPs the user should run across all goals this year
                const goal_commitment_annual = this.total_goal_sip_annual(goals, year);

                // 5. FIRE number and percentage per track (portfolio is the same in both)
                const fire_number_inc = total_expenses_inc * FIRE_CONSTANTS.fire_factor;
                const fire_number_exc = total_expenses_exc * FIRE_CONSTANTS.fire_factor;
                const fire_percentage_inc = fire_number_inc > 0 ? (portfolio * 100) / fire_number_inc : 0;
                const fire_percentage_exc = fire_number_exc > 0 ? (portfolio * 100) / fire_number_exc : 0;

                proj.push({
                    year,
                    income: Math.round(income),
                    goal_commitment_annual: Math.round(goal_commitment_annual),
                    goals_payout: Math.round(goals_payout),
                    goal_hits,
                    total_expenses: { emi_include: Math.round(total_expenses_inc), emi_exclude: Math.round(total_expenses_exc) },
                    savings: { emi_include: Math.round(surplus), emi_exclude: Math.round(surplus) },
                    portfolio_value: { emi_include: Math.round(portfolio), emi_exclude: Math.round(portfolio) },
                    fire_number: { emi_include: Math.round(fire_number_inc), emi_exclude: Math.round(fire_number_exc) },
                    fire_percentage: { emi_include: parseFloat(fire_percentage_inc.toFixed(2)), emi_exclude: parseFloat(fire_percentage_exc.toFixed(2)) },
                });
            }

            return proj;
        }

        /** One year of growth: every asset (and the invested surplus) at the same flat portfolio return. */
        private grow_assets(ya: ProjectionAssets): ProjectionAssets {
            const k = 1 + FIRE_CONSTANTS.portfolio_return;
            return {
                mutual_funds: ya.mutual_funds * k,
                stocks: ya.stocks * k,
                fd: ya.fd * k,
                gold: ya.gold * k,
                cash_saving: ya.cash_saving * k,
                nps: ya.nps * k,
                ppf_epf: ya.ppf_epf * k,
                new_savings: (ya.new_savings ?? 0) * k,
            };
        }

        private sum_assets(ya: ProjectionAssets): number {
            return ya.mutual_funds + ya.stocks + ya.fd + ya.gold +
                ya.cash_saving + ya.nps + ya.ppf_epf + (ya.new_savings ?? 0);
        }

        /** Positive amount is invested. Negative amount is withdrawn, most liquid first, never below 0. */
        private apply_cash_flow(ya: ProjectionAssets, amount: number): void {
            if (amount >= 0) {
                ya.new_savings = (ya.new_savings ?? 0) + amount;
                return;
            }
            let deficit = -amount;
            const order: (keyof ProjectionAssets)[] = ["cash_saving", "new_savings", "fd", "mutual_funds", "stocks", "gold", "nps", "ppf_epf"];
            for (const key of order) {
                if (deficit <= 0) break;
                const available = ya[key] ?? 0;
                const take = Math.min(available, deficit);
                ya[key] = available - take;
                deficit -= take;
            }
        }

        /** Sum of ALL goal SIPs (incl. retirement) that run in `year`. */
        private total_goal_sip_annual(goals: NormalizedGoalWithSIP[], year: number): number {
            return goals.reduce((sum, goal) => year < goal.target_year ? sum + goal.required_monthly_sip * 12 : sum, 0);
        }

        //  Retirement SIP fallback (only used when no SIP was stored on the goal)
        private calculate_retirement_sip(
            goal: NormalizedGoalWithSIP,
            dob: Date | null,
            monthly_expenses_total: number,
        ): { sip: number; corpus: number } {
            const current_year = new Date().getFullYear();
            if (!dob) return { sip: 0, corpus: 0 };

            const birth_year = new Date(dob).getFullYear();
            const present_age = current_year - birth_year;
            const retirement_age = goal.target_year - birth_year;
            const years_to_retirement = retirement_age - present_age;
            if (years_to_retirement <= 0) return { sip: 0, corpus: 0 };

            const life_expectancy = goal.life_expectancy ?? 80;
            const years_post_retirement = life_expectancy - retirement_age;
            if (years_post_retirement <= 0) return { sip: 0, corpus: 0 };

            const monthly_exp = goal.current_monthly_exp ?? monthly_expenses_total;
            if (monthly_exp <= 0) return { sip: 0, corpus: 0 };

            const r = FIRE_CONSTANTS.retirement_return;
            const inflation = FIRE_CONSTANTS.retirement_inflation;
            const annual_expense_at_retirement = monthly_exp * 12 * Math.pow(1 + inflation, years_to_retirement);

            // Growing annuity (annuity-due) PV of post-retirement expenses
            let retirement_corpus: number;
            if (Math.abs(r - inflation) < 1e-9) {
                retirement_corpus = annual_expense_at_retirement * years_post_retirement;
            } else {
                const growth_factor = (1 + inflation) / (1 + r);
                retirement_corpus = annual_expense_at_retirement *
                    (1 - Math.pow(growth_factor, years_post_retirement)) / (r - inflation) * (1 + r);
            }

            // Same SIP formula as goal-calculator.ts (ordinary annuity, monthly rate = r / 12)
            const { required_monthly_sip } = calculateGoalProjections({
                current_cost: retirement_corpus,
                years_remaining: years_to_retirement,
                expected_return_rate: r,
                is_inflation_adjusted: false,
            });
            return { sip: Math.round(required_monthly_sip), corpus: Math.round(retirement_corpus) };
        }

        //  Goal payout at target year (null for retirement or any other year)
        private calculate_goal_future_value(
            goal: NormalizedGoalWithSIP,
            current_year: number,
            year: number,
        ): number | null {
            if (goal.category === "Retirement") return null;
            if (year !== goal.target_year) return null;

            if (goal.future_value && goal.future_value > 0) {
                return goal.future_value;
            }

            const years_to_goal = goal.target_year - current_year;
            if (years_to_goal <= 0) return goal.target_amount;
            return goal.target_amount * Math.pow(1 + FIRE_CONSTANTS.goal_fv_growth, years_to_goal);
        }

        // Helpers

        private to_num(val: Prisma.Decimal | string | number | null | undefined): number {
            if (val == null) return 0;
            if (typeof val === "number") return isNaN(val) ? 0 : val;
            if (typeof (val as any).toNumber === "function") return (val as any).toNumber();
            const n = Number(val);
            return isNaN(n) ? 0 : n;
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
            const total_monthly = house + food + transportation + others; // onboarding expenses are monthly
            return { house, food, transportation, others, total_monthly: Math.round(total_monthly), total_annual: total_monthly * 12 };
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

        /** Quarterly trend: real UserNetWorthSnapshot rows where available, current values for this quarter.
         *  FIRE % uses the SAME basis as the headline: investable portfolio / FIRE number (not net worth). */
        private async generate_quarterly_simulation(user_id: string, metrics: ComputedMetrics, projection: ProjectionRow[]): Promise<QuarterlyPoint[]> {
            const current_net_worth = metrics.net_worth;
            const current_portfolio = projection[0]?.portfolio_value.emi_include ?? metrics.total_assets;
            const fire_number_now = projection[0]?.fire_number.emi_include ?? 0;
            const now = new Date();
            const current_year = now.getFullYear();

            const snapshots = await db.userNetWorthSnapshot.findMany({
                where: { userId: user_id },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
                take: 24,
            });

            const user = await db.user.findUnique({ where: { id: user_id }, select: { createdAt: true } });
            const joined_date = user?.createdAt ?? new Date();
            const months_since_join = (now.getTime() - joined_date.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
            const is_new_user = months_since_join < 3;

            const quarter_label = (y: number, q: number): string => `Q${q + 1} ${y}`;
            const points: QuarterlyPoint[] = [];

            for (let i = 5; i >= 0; i--) {
                if (is_new_user && i !== 0) continue;

                let target_q = Math.floor(now.getMonth() / 3) - i;
                let target_y = current_year;
                while (target_q < 0) { target_q += 4; target_y--; }

                // Skip quarters before the user joined (keep the one right before as a baseline)
                const quarter_end_date = new Date(target_y, target_q * 3 + 3, 0);
                if (quarter_end_date < joined_date && i !== 0) {
                    const next_q_date = new Date(target_y, target_q * 3 + 6, 0);
                    if (next_q_date < joined_date) continue;
                }

                let nw = current_net_worth;
                let investable = current_portfolio;
                if (i !== 0) {
                    const q_months = [target_q * 3 + 1, target_q * 3 + 2, target_q * 3 + 3];
                    const snapshot = snapshots.find(s => s.year === target_y && q_months.includes(s.month));
                    if (snapshot) {
                        nw = this.to_num(snapshot.netWorth);       // stored as (encrypted) string
                        investable = this.to_num(snapshot.assets);
                    }
                }

                // FIRE number i quarters ago = today's FIRE number deflated by expense inflation
                const fn = fire_number_now / Math.pow(1 + FIRE_CONSTANTS.expense_growth, i / 4);
                const fp = fn > 0 ? (investable / fn) * 100 : 0;

                points.push({
                    quarter: quarter_label(target_y, target_q),
                    net_worth: parseFloat((nw / 100_000).toFixed(2)),
                    fire_number: parseFloat((fn / 100_000).toFixed(2)),
                    fire_percentage: parseFloat(fp.toFixed(2)),
                });
            }
            return points;
        }

        /** Year-by-year SIP the user must run across ALL goals (incl. retirement). */
        private generate_yearly_goal_table(goals: NormalizedGoalWithSIP[], projection: ProjectionRow[]): YearlyGoalRequirement[] {
            return projection.map(row => {
                const yearly = Math.round(this.total_goal_sip_annual(goals, row.year));
                return {
                    year: row.year,
                    monthly_required: Math.round(yearly / 12),
                    yearly_required: yearly,
                };
            });
        }

        /** Map DB goal rows → NormalizedGoalWithSIP with pre-computed required_monthly_sip */
        private normalize_goals_with_sip(
            goals: NonNullable<UserWithAllData["user_goals"]>,
            dob: Date | null,
            monthly_expenses_total: number,
        ): NormalizedGoalWithSIP[] {
            const now = new Date();
            const current_year = now.getFullYear();

            const label_map: Record<number, string> = {
                1: "Child Education",
                2: "Child Marriage",
                3: "Buy a Home",
                4: "Buy a Vehicle",
                5: "Build My Savings",
                6: "Other Goal",
                7: "Retirement",
            };

            const normalized: NormalizedGoalWithSIP[] = [];

            for (const g of goals as any[]) {
                // Only goals that still need money: skip deleted, cancelled and already completed goals
                if (g.status && ["DELETED", "CANCELLED", "COMPLETED"].includes(g.status)) continue;

                // target_date is fixed at creation. years_remaining is a creation-time snapshot and
                // drifts by one every year, so it is only a fallback.
                let target_year: number;
                if (g.target_date) {
                    const target_date = new Date(g.target_date);
                    if (target_date.getTime() <= now.getTime()) continue;           // already due
                    target_year = Math.max(target_date.getFullYear(), current_year + 1); // due within this year → pay at row 1
                } else {
                    const years_left = g.years_remaining ?? g.years_left;
                    if (years_left == null || years_left <= 0) continue;
                    target_year = current_year + years_left;
                }

                const category = label_map[g.goal_type_id] ?? "Goal";
                const name = g.goal_name || g.goal_item_name || category;
                const cost = this.to_num(g.current_cost ?? g.target_amount ?? g.current_goal_cost);

                const entry: NormalizedGoalWithSIP = {
                    id: g.id,
                    name,
                    category,
                    target_year,
                    target_amount: category === "Retirement" ? 0 : cost,
                    life_expectancy: g.retirement_details?.plan_until_age ?? null,
                    current_monthly_exp: g.retirement_details?.monthly_lifestyle_expense != null
                        ? this.to_num(g.retirement_details.monthly_lifestyle_expense)
                        : null,
                    required_monthly_sip: Math.round(this.to_num(g.required_monthly_sip)),
                    future_value: Math.round(this.to_num(g.future_target_amount ?? g.net_required_corpus)),
                    goal_type_id: g.goal_type_id ?? 0,
                };

                // Fallback only when SIP / future value were not snapshotted on the goal
                if (entry.required_monthly_sip === 0 || entry.future_value === 0) {
                    let sip = 0;
                    let corpus = 0;
                    if (category === "Retirement") {
                        ({ sip, corpus } = this.calculate_retirement_sip(entry, dob, monthly_expenses_total));
                    } else {
                        // Same engine that creates goals (goal-calculator.ts)
                        const p = calculateGoalProjections({
                            current_cost: cost,
                            years_remaining: target_year - current_year,
                            current_savings: this.to_num(g.current_savings),
                            inflation_rate: g.inflation_rate != null ? this.to_num(g.inflation_rate) : FIRE_CONSTANTS.goal_fv_growth,
                            expected_return_rate: this.to_num(g.expected_return_rate) || FIRE_CONSTANTS.goal_sip_return,
                            is_inflation_adjusted: g.goal_type_id !== 5,
                        });
                        sip = Math.round(p.required_monthly_sip);
                        corpus = Math.round(p.future_target_amount);
                    }
                    if (entry.required_monthly_sip === 0) entry.required_monthly_sip = sip;
                    if (entry.future_value === 0) entry.future_value = corpus;
                }

                normalized.push(entry);
            }

            return normalized;
        }
}

export const fire_report_service = new FireReportServiceClass();
