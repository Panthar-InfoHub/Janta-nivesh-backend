import logger from "../middleware/logger.js";
import { db } from "../server.js";

interface PortfolioData {
    investment_data: {
        current_value: number;
        invested_amount: number;
        total_returns: number;
        return_percent: number | null;
    };
    mutual_funds: any[];
}

interface MonthlyMetric {
    month: string;
    savings: number;
    investments: number;
}

interface AverageSavingsPattern {
    current_savings_percent: number;
    month_over_month_delta: number;
    total_saved_vs_prev_month: number;
    previous_month_savings_percent: number;
}

interface SpendingCategory {
    amount: number;
    percent: number;
    breakdown?: Record<string, { amount: number; percent: number }>;
}

interface InvestmentRateResponse {
    average_savings_pattern: AverageSavingsPattern;
    investing_trend: MonthlyMetric[];
    spending_categories: {
        investments: SpendingCategory;
        essentials: SpendingCategory;
        savings: SpendingCategory;
    };
}

class UserSavingsServiceClass {
    private toNumber = (val: any) => parseFloat(String(val).replace(/,/g, "")) || 0;

    /**
     * Get last N months in descending order (current month first)
     */
    private getLastNMonths(months: number = 6): { start: Date; end: Date; label: string }[] {
        const result: { start: Date; end: Date; label: string }[] = [];
        const today = new Date();

        for (let i = 0; i < months; i++) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
            const monthLabel = date.toLocaleString("en-US", { month: "short", year: "2-digit" });

            result.push({
                start: date,
                end: new Date(nextMonth.getTime() - 1),
                label: `${monthLabel}`,
            });
        }

        return result;
    }

    /**
     * Parse date string from Finnsys (e.g., "05-Jan-2026") to Date object
     */
    private parseFinnsysDate(dateStr: string): Date | null {
        try {
            return new Date(dateStr);
        } catch {
            return null;
        }
    }

    /**
     * Get month key for grouping (YYYY-MM format)
     */
    private getMonthKey(date: Date): string {
        return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
    }

    /**
     * Aggregate FD investments by month
     */
    private async aggregateFdByMonth(
        user_id: string,
        months: { start: Date; end: Date; label: string }[]
    ): Promise<Map<string, number>> {
        const fd_by_month = new Map<string, number>();

        // Initialize all months with 0
        months.forEach((m) => {
            fd_by_month.set(this.getMonthKey(m.start), 0);
        });

        // Fetch FD transactions for the date range
        const fd_transactions = await db.fdTransaction.findMany({
            where: {
                user_id,
                fd_issued_at: {
                    gte: months[months.length - 1].start,
                    lte: months[0].end,
                },
                // status: "FD_CREATED",
                status: { in: ["FD_CREATED", "MATURED"] }
            },
            select: {
                amount: true,
                fd_issued_at: true,
            },
        });

        console.log("fd in service layer ==> ", fd_transactions)
        // Group by month
        fd_transactions.forEach((txn) => {
            console.log("Fd each transaction ==> ", txn)
            if (txn.fd_issued_at) {
                const monthKey = this.getMonthKey(txn.fd_issued_at);
                console.log("Month key ==> ", monthKey)
                const current = fd_by_month.get(monthKey) || 0;
                console.log("Current value key ==> ", current)
                fd_by_month.set(monthKey, current + this.toNumber(txn.amount));
            }
        });

        return fd_by_month;
    }

    /**
     * Aggregate MF investments by month from portfolio data
     */
    private aggregateMfByMonth(
        mutual_funds: any[],
        months: { start: Date; end: Date; label: string }[]
    ): Map<string, number> {
        const mf_by_month = new Map<string, number>();

        // Initialize all months with 0
        months.forEach((m) => {
            mf_by_month.set(this.getMonthKey(m.start), 0);
        });

        // Group MF by start_date month
        mutual_funds.forEach((mf) => {
            const startDate = this.parseFinnsysDate(mf.start_date);
            if (startDate) {
                const monthKey = this.getMonthKey(startDate);
                // Only count if within our month range
                if (mf_by_month.has(monthKey)) {
                    const current = mf_by_month.get(monthKey) || 0;
                    mf_by_month.set(monthKey, current + this.toNumber(mf.amount));
                }
            }
        });

        return mf_by_month;
    }

    /**
     * Main calculation method
     */
    async calculate_monthly_metrics(
        user_id: string,
        portfolio_data: PortfolioData,
        months: number = 6
    ): Promise<InvestmentRateResponse> {
        logger.info(`Calculating monthly metrics for user ${user_id} for ${months} months`);

        // Fetch user financial data
        const user_finance = await db.userFinance.findUnique({
            where: { user_id },
        });

        if (!user_finance) {
            logger.warn(`No financial data found for user ${user_id}`);
            throw new Error("User financial data not found");
        }

        // Convert decimals to numbers
        const annual_income = this.toNumber(user_finance.annual_income);
        const monthly_expenses =
            this.toNumber(user_finance.expense_house) +
            this.toNumber(user_finance.expense_food) +
            this.toNumber(user_finance.expense_transportation) +
            this.toNumber(user_finance.expense_others);

        const monthly_income = annual_income / 12;
        const annual_expenses = monthly_expenses * 12;

        logger.debug(`User ${user_id} - Monthly Income: ${monthly_income}, Monthly Expenses: ${monthly_expenses}`);

        // Get last N months
        const last_months = this.getLastNMonths(months);

        // Aggregate investments by month
        const fd_by_month = await this.aggregateFdByMonth(user_id, last_months);
        // logger.debug("FD investments by month:", Array.from(fd_by_month.entries()));

        const mf_by_month = this.aggregateMfByMonth(portfolio_data.mutual_funds, last_months);
        // logger.debug("MF investments by month:", Array.from(mf_by_month.entries()));

        // Build monthly trend data
        const monthly_trends: MonthlyMetric[] = [];
        const monthly_savings_percents: number[] = [];

        last_months.forEach((month) => {
            const monthKey = this.getMonthKey(month.start);
            const fd_investment = fd_by_month.get(monthKey) || 0;
            const mf_investment = mf_by_month.get(monthKey) || 0;
            const total_investments = fd_investment + mf_investment;
            const monthly_savings = monthly_income - monthly_expenses - total_investments;

            const savings_percent =
                monthly_income > 0 ? (monthly_savings / monthly_income) * 100 : 0;
            monthly_savings_percents.push(savings_percent);

            monthly_trends.push({
                month: month.label,
                savings: Math.round(monthly_savings),
                investments: Math.round(total_investments),
            });
        });

        // Calculate average savings pattern
        const current_savings_percent = Math.round(monthly_savings_percents[0] * 10) / 10;
        const previous_month_savings_percent =
            monthly_savings_percents.length > 1 ? Math.round(monthly_savings_percents[1] * 10) / 10 : 0;
        const month_over_month_delta = Math.round((current_savings_percent - previous_month_savings_percent) * 10) / 10;

        // Current vs previous month saved amount
        const current_month_savings = monthly_income - monthly_expenses - (fd_by_month.get(this.getMonthKey(last_months[0].start)) || 0) - (mf_by_month.get(this.getMonthKey(last_months[0].start)) || 0);
        const previous_month_savings =
            last_months.length > 1
                ? monthly_income -
                monthly_expenses -
                (fd_by_month.get(this.getMonthKey(last_months[1].start)) || 0) -
                (mf_by_month.get(this.getMonthKey(last_months[1].start)) || 0)
                : 0;
        const total_saved_vs_prev_month = Math.round(current_month_savings - previous_month_savings);

        // Fetch current active FD total for breakdown
        const active_fds = await db.fdTransaction.findMany({
            where: {
                user_id,
                status: { in: ["FD_CREATED", "MATURED"] }
            },
            select: { amount: true }
        });
        const current_fd_value = active_fds.reduce((sum, fd) => sum + this.toNumber(fd.amount), 0);
        const current_mf_value = this.toNumber(portfolio_data.investment_data.current_value);

        // Calculate spending categories
        const total_current_portfolio = current_mf_value + current_fd_value;
        logger.debug(`Total current portfolio value for user ${user_id}: ${total_current_portfolio}`);
        const total_expenses_annual = annual_expenses;

        const total_savings_annual =
            annual_income - annual_expenses - (total_current_portfolio || (portfolio_data.investment_data.invested_amount + current_fd_value));

        const total_allocation = total_current_portfolio + total_expenses_annual + total_savings_annual;
        logger.debug(`Total allocation for user ${user_id}: ${total_allocation} (Investments: ${total_current_portfolio}, Expenses: ${total_expenses_annual}, Savings: ${total_savings_annual})`);
        let spending_categories: InvestmentRateResponse["spending_categories"] = {
            investments: {
                amount: Math.round(total_current_portfolio),
                percent: 0,
                breakdown: {
                    mutual_funds: {
                        amount: Math.round(current_mf_value),
                        percent: total_current_portfolio > 0 ? Math.round((current_mf_value / total_current_portfolio) * 100) : 0
                    },
                    fixed_deposits: {
                        amount: Math.round(current_fd_value),
                        percent: total_current_portfolio > 0 ? Math.round((current_fd_value / total_current_portfolio) * 100) : 0
                    }
                }
            },
            essentials: {
                amount: Math.round(total_expenses_annual),
                percent: 0,
                breakdown: {
                    house: {
                        amount: Math.round(this.toNumber(user_finance.expense_house) * 12),
                        percent: annual_expenses > 0 ? Math.round((this.toNumber(user_finance.expense_house) * 12 / annual_expenses) * 100) : 0
                    },
                    food: {
                        amount: Math.round(this.toNumber(user_finance.expense_food) * 12),
                        percent: annual_expenses > 0 ? Math.round((this.toNumber(user_finance.expense_food) * 12 / annual_expenses) * 100) : 0
                    },
                    transportation: {
                        amount: Math.round(this.toNumber(user_finance.expense_transportation) * 12),
                        percent: annual_expenses > 0 ? Math.round((this.toNumber(user_finance.expense_transportation) * 12 / annual_expenses) * 100) : 0
                    },
                    others: {
                        amount: Math.round(this.toNumber(user_finance.expense_others) * 12),
                        percent: annual_expenses > 0 ? Math.round((this.toNumber(user_finance.expense_others) * 12 / annual_expenses) * 100) : 0
                    }
                }
            },
            savings: { amount: Math.round(total_savings_annual), percent: 0 },
        };

        if (total_allocation > 0) {
            spending_categories.investments.percent = Math.round((total_current_portfolio / total_allocation) * 1000) / 10;
            spending_categories.essentials.percent = Math.round((total_expenses_annual / total_allocation) * 1000) / 10;
            spending_categories.savings.percent = Math.round((total_savings_annual / total_allocation) * 1000) / 10;
        }

        return {
            average_savings_pattern: {
                current_savings_percent,
                month_over_month_delta,
                total_saved_vs_prev_month,
                previous_month_savings_percent,
            },
            investing_trend: monthly_trends,
            spending_categories,
        };
    }
}

export const user_savings_service = new UserSavingsServiceClass();
