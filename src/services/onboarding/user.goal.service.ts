import { Prisma } from "../../prisma/generated/prisma/client.js";
import { db } from "../../server.js";
import { calculateGoalProjections, normalizeRate } from "../../lib/goal-calculator.js";
import { GoalCalculateInput, UserGoalInput, UserGoalUpdateInput } from "../../lib/zod-schemas/goal.schema.js";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";

type TxClient = Prisma.TransactionClient;

export const GOAL_TYPE_METADATA: Record<number, {
    name: string;
    purpose: string;
    calculation_mode: string;
    tenure_suggestions: number[];
    min_years: number;
    max_years: number;
    default_cost_chips?: number[];
    asset_subtypes?: string[];
}> = {
    1: {
        name: "Child's Education",
        purpose: "Save for school, college or higher education",
        calculation_mode: "Inflation-adjusted future cost",
        tenure_suggestions: [5, 10, 15],
        min_years: 1,
        max_years: 30,
        default_cost_chips: [500000, 1000000, 1500000, 2500000],
    },
    2: {
        name: "Child's Marriage",
        purpose: "Save for future marriage expenses",
        calculation_mode: "Inflation-adjusted future cost",
        tenure_suggestions: [5, 10, 15],
        min_years: 1,
        max_years: 30,
        default_cost_chips: [500000, 1000000, 1500000, 2500000],
    },
    3: {
        name: "Buy a Home",
        purpose: "Build money for house purchase or down payment",
        calculation_mode: "Inflation-adjusted target",
        tenure_suggestions: [3, 5, 10],
        min_years: 1,
        max_years: 30,
        default_cost_chips: [500000, 1000000, 2000000, 3000000],
    },
    4: {
        name: "Buy a Vehicle",
        purpose: "Save for bike, scooter or car",
        calculation_mode: "Inflation-adjusted target",
        tenure_suggestions: [1, 3, 5],
        min_years: 1,
        max_years: 15,
        asset_subtypes: ["BIKE", "SCOOTER", "CAR"],
    },
    5: {
        name: "Build My Savings",
        purpose: "Accumulate a chosen corpus without a purchase goal",
        calculation_mode: "Fixed target corpus",
        tenure_suggestions: [1, 3, 5, 10],
        min_years: 1,
        max_years: 30,
        default_cost_chips: [100000, 200000, 500000, 1000000],
    },
    6: {
        name: "Other Goal",
        purpose: "Any goal not covered above",
        calculation_mode: "Inflation-adjusted target",
        tenure_suggestions: [1, 3, 5, 10],
        min_years: 1,
        max_years: 30,
    },
};

class UserGoalServiceClass {
    /**
     * Get system goal calculation configs enriched with frontend presentation metadata.
     */
    getConfig = async () => {
        const configs = await db.goalCalculationConfig.findMany({
            where: { active: true },
            orderBy: { goal_type_id: "asc" },
        });

        return configs.map((cfg) => {
            const meta = GOAL_TYPE_METADATA[cfg.goal_type_id];
            return {
                id: cfg.id,
                goal_type_id: cfg.goal_type_id,
                name: meta?.name || `Goal Type ${cfg.goal_type_id}`,
                purpose: meta?.purpose || "",
                calculation_mode: meta?.calculation_mode || "",
                inflation_rate: cfg.inflation_rate ? Number(cfg.inflation_rate) : null,
                expected_return_rate: Number(cfg.expected_return_rate),
                min_years: cfg.min_years,
                max_years: cfg.max_years,
                tenure_suggestions: meta?.tenure_suggestions || [3, 5, 10],
                cost_chips: meta?.default_cost_chips || [],
                asset_subtypes: meta?.asset_subtypes || null,
                config_version: cfg.config_version,
            };
        });
    };

    /**
     * Helper to fetch active config for a specific goal type.
     */
    getConfigForType = async (goal_type_id: number) => {
        const cfg = await db.goalCalculationConfig.findUnique({
            where: { goal_type_id },
        });

        if (!cfg) {
            // Fallback hardcoded defaults if config table was somehow unseeded
            const meta = GOAL_TYPE_METADATA[goal_type_id];
            const defaultInflation = goal_type_id === 3 || goal_type_id === 4 ? 0.05 : goal_type_id === 5 ? null : 0.06;
            return {
                inflation_rate: defaultInflation !== null ? new Prisma.Decimal(defaultInflation) : null,
                expected_return_rate: new Prisma.Decimal(0.10),
                min_years: meta?.min_years ?? 1,
                max_years: meta?.max_years ?? 30,
                config_version: "v2.0",
            };
        }

        return cfg;
    };

    /**
     * Stateless calculation preview for interactive sliders / simulators without persisting.
     */
    calculate = async (input: GoalCalculateInput) => {
        const cfg = await this.getConfigForType(input.goal_type_id);

        const cost = input.goal_type_id === 5 ? (input.target_amount ?? 0) : (input.current_cost ?? 0);
        const isInflationAdjusted = input.goal_type_id !== 5;

        // Use custom rate if passed, otherwise fall back to system config
        const inflationRate = input.inflation_rate !== undefined && input.inflation_rate !== null
            ? normalizeRate(input.inflation_rate)
            : Number(cfg.inflation_rate);

        const expectedReturnRate = input.expected_return_rate !== undefined && input.expected_return_rate !== null
            ? normalizeRate(input.expected_return_rate)
            : Number(cfg.expected_return_rate);

        const projections = calculateGoalProjections({
            current_cost: cost,
            years_remaining: input.years_remaining,
            current_savings: input.current_savings ?? 0,
            inflation_rate: inflationRate,
            expected_return_rate: expectedReturnRate,
            is_inflation_adjusted: isInflationAdjusted,
        });

        return {
            goal_type_id: input.goal_type_id,
            years_remaining: input.years_remaining,
            current_cost: cost,
            current_savings: input.current_savings ?? 0,
            inflation_rate_used: inflationRate,
            expected_return_rate_used: expectedReturnRate,
            ...projections,
        };
    };

    /**
     * Create a user goal: validates tenure bounds, runs calculations, and persists to DB.
     */
    createGoal = async (user_id: string, data: UserGoalInput) => {
        const cfg = await this.getConfigForType(data.goal_type_id);

        if (data.years_remaining < cfg.min_years || data.years_remaining > cfg.max_years) {
            throw new AppError(
                `Years remaining must be between ${cfg.min_years} and ${cfg.max_years} for this goal type`,
                400,
                "INVALID_YEARS_REMAINING"
            );
        }

        // Determine goal name
        let goal_name = (data as any).goal_name?.trim();
        if (!goal_name) {
            if (data.goal_type_id === 1) goal_name = `${data.child_name}'s Education`;
            else if (data.goal_type_id === 2) goal_name = `${data.child_name}'s Marriage`;
            else if (data.goal_type_id === 3) goal_name = "My Home";
            else if (data.goal_type_id === 4) goal_name = "My Vehicle";
            else if (data.goal_type_id === 5) goal_name = "My Savings";
            else goal_name = "My Goal";
        }

        // Determine primary financial amount
        const isType5 = data.goal_type_id === 5;
        const current_cost = !isType5 ? (data as any).current_cost : null;
        const target_amount = isType5 ? (data as any).target_amount : null;
        const calculationAmount = isType5 ? Number(target_amount) : Number(current_cost);

        // Determine rates to apply
        const inflation_rate_num = data.inflation_rate !== undefined && data.inflation_rate !== null
            ? normalizeRate(data.inflation_rate)
            : (cfg.inflation_rate ? Number(cfg.inflation_rate) : null);

        const expected_return_rate_num = data.expected_return_rate !== undefined && data.expected_return_rate !== null
            ? normalizeRate(data.expected_return_rate)
            : Number(cfg.expected_return_rate);

        // Run math engine
        const projections = calculateGoalProjections({
            current_cost: calculationAmount,
            years_remaining: data.years_remaining,
            current_savings: Number(data.current_savings || 0),
            inflation_rate: inflation_rate_num,
            expected_return_rate: expected_return_rate_num,
            is_inflation_adjusted: !isType5,
        });

        // Compute target date
        const target_date = new Date();
        target_date.setFullYear(target_date.getFullYear() + data.years_remaining);

        // Persist to DB
        const created = await db.userGoals.create({
            data: {
                user_id,
                goal_type_id: data.goal_type_id,
                goal_name,
                child_name: (data as any).child_name ?? null,
                child_age: (data as any).child_age ?? null,
                asset_subtype: (data as any).asset_subtype ?? null,
                years_remaining: data.years_remaining,
                target_date,
                current_cost: current_cost !== null ? new Prisma.Decimal(current_cost) : null,
                target_amount: target_amount !== null ? new Prisma.Decimal(target_amount) : null,
                current_savings: new Prisma.Decimal(data.current_savings || 0),
                inflation_rate: inflation_rate_num !== null ? new Prisma.Decimal(inflation_rate_num) : null,
                expected_return_rate: new Prisma.Decimal(expected_return_rate_num),
                future_target_amount: new Prisma.Decimal(projections.future_target_amount),
                fv_current_savings: new Prisma.Decimal(projections.fv_current_savings),
                net_required_corpus: new Prisma.Decimal(projections.net_required_corpus),
                required_monthly_sip: new Prisma.Decimal(projections.required_monthly_sip),
                required_lumpsum_today: new Prisma.Decimal(projections.required_lumpsum_today),
                calculation_version: cfg.config_version || "v2.0",
                status: "ACTIVE",
            },
        });

        logger.info(`Goal created successfully for user ${user_id}: ${created.id}`);
        return created;
    };

    private static HOLDINGS_INCLUDE = {
        include: {
            mf_product: {
                select: {
                    id: true,
                    name: true,
                    isin: true,
                    img_url: true,
                    latest_nav: true,
                    latest_nav_date: true,
                },
            },
        },
    } as const;

    private formatGoalWithHoldings = (goal: any) => {
        const holdings = (goal.holdings || []).map((h: any) => {
            const { raw_response, ...rest } = h;
            return rest;
        });
        const total_holdings_value = holdings.reduce(
            (sum: number, h: any) => sum + Number(h.current_value || 0),
            0
        );
        const total_invested_amount = holdings.reduce(
            (sum: number, h: any) => sum + Number(h.invested_amount || 0),
            0
        );
        const current_savings = Number(goal.current_savings || 0);
        const total_current_value = Number((current_savings + total_holdings_value).toFixed(2));
        const future_target = Number(goal.future_target_amount || 0);
        const progress_percent = future_target > 0
            ? Math.min(100, Math.round((total_current_value / future_target) * 100))
            : 0;

        return {
            ...goal,
            holdings,
            total_holdings_value: Number(total_holdings_value.toFixed(2)),
            total_invested_amount: Number(total_invested_amount.toFixed(2)),
            total_current_value,
            progress_percent,
        };
    };

    /**
     * Get all active goals for a user.
     */
    getUserGoals = async (user_id: string) => {
        const goals = await db.userGoals.findMany({
            where: {
                user_id,
                status: { not: "DELETED" },
            },
            include: {
                holdings: UserGoalServiceClass.HOLDINGS_INCLUDE,
            },
            orderBy: { createdAt: "desc" },
        });

        return goals.map(this.formatGoalWithHoldings);
    };

    /**
     * Get a specific goal by ID for a user.
     */
    getGoalById = async (user_id: string, goal_id: string) => {
        const goal = await db.userGoals.findFirst({
            where: {
                id: goal_id,
                user_id,
                status: { not: "DELETED" },
            },
            include: {
                holdings: UserGoalServiceClass.HOLDINGS_INCLUDE,
            },
        });

        if (!goal) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        return this.formatGoalWithHoldings(goal);
    };

    /**
     * Update a user goal: recalculates snapshot if any financial inputs changed.
     */
    updateGoal = async (user_id: string, goal_id: string, data: UserGoalUpdateInput) => {
        const existing = await db.userGoals.findFirst({
            where: {
                id: goal_id,
                user_id,
                status: { not: "DELETED" },
            },
        });

        if (!existing) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        const cfg = await this.getConfigForType(existing.goal_type_id);

        const newYears = data.years_remaining ?? existing.years_remaining;
        if (data.years_remaining !== undefined && (newYears < cfg.min_years || newYears > cfg.max_years)) {
            throw new AppError(
                `Years remaining must be between ${cfg.min_years} and ${cfg.max_years} for this goal type`,
                400,
                "INVALID_YEARS_REMAINING"
            );
        }

        const isType5 = existing.goal_type_id === 5;
        const newCost = data.current_cost !== undefined
            ? data.current_cost
            : existing.current_cost ? Number(existing.current_cost) : null;

        const newTargetAmount = data.target_amount !== undefined
            ? data.target_amount
            : existing.target_amount ? Number(existing.target_amount) : null;

        const calculationAmount = isType5 ? (newTargetAmount ?? 0) : (newCost ?? 0);
        const newSavings = data.current_savings !== undefined ? data.current_savings : Number(existing.current_savings);

        const newInflation = data.inflation_rate !== undefined
            ? normalizeRate(data.inflation_rate)
            : existing.inflation_rate ? Number(existing.inflation_rate) : null;

        const newReturn = data.expected_return_rate !== undefined
            ? normalizeRate(data.expected_return_rate)
            : Number(existing.expected_return_rate);

        // Recalculate projections
        const projections = calculateGoalProjections({
            current_cost: calculationAmount,
            years_remaining: newYears,
            current_savings: newSavings,
            inflation_rate: newInflation,
            expected_return_rate: newReturn,
            is_inflation_adjusted: !isType5,
        });

        let target_date = existing.target_date;
        if (data.years_remaining !== undefined) {
            target_date = new Date();
            target_date.setFullYear(target_date.getFullYear() + newYears);
        }

        const updated = await db.userGoals.update({
            where: { id: goal_id },
            data: {
                ...(data.goal_name && { goal_name: data.goal_name }),
                ...(data.child_name !== undefined && { child_name: data.child_name }),
                ...(data.child_age !== undefined && { child_age: data.child_age }),
                ...(data.asset_subtype !== undefined && { asset_subtype: data.asset_subtype }),
                ...(data.years_remaining !== undefined && { years_remaining: newYears, target_date }),
                ...(newCost !== null && !isType5 && { current_cost: new Prisma.Decimal(newCost) }),
                ...(newTargetAmount !== null && isType5 && { target_amount: new Prisma.Decimal(newTargetAmount) }),
                current_savings: new Prisma.Decimal(newSavings),
                inflation_rate: newInflation !== null ? new Prisma.Decimal(newInflation) : null,
                expected_return_rate: new Prisma.Decimal(newReturn),
                future_target_amount: new Prisma.Decimal(projections.future_target_amount),
                fv_current_savings: new Prisma.Decimal(projections.fv_current_savings),
                net_required_corpus: new Prisma.Decimal(projections.net_required_corpus),
                required_monthly_sip: new Prisma.Decimal(projections.required_monthly_sip),
                required_lumpsum_today: new Prisma.Decimal(projections.required_lumpsum_today),
                ...(data.status && { status: data.status }),
            },
        });

        logger.info(`Goal updated successfully: ${goal_id}`);
        return updated;
    };

    /**
     * Delete / archive a goal.
     */
    deleteGoal = async (user_id: string, goal_id: string) => {
        const existing = await db.userGoals.findFirst({
            where: {
                id: goal_id,
                user_id,
                status: { not: "DELETED" },
            },
        });

        if (!existing) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        // Unlink any holdings mapped to this goal so they are not tied to a deleted goal
        await db.mfHolding.updateMany({
            where: { user_goal_id: goal_id, user_id },
            data: { user_goal_id: null },
        });

        const deleted = await db.userGoals.update({
            where: { id: goal_id },
            data: { status: "DELETED" },
        });

        return deleted;
    };

    /**
     * Map mutual fund holdings to a goal.
     */
    mapHoldingsToGoal = async (user_id: string, goal_id: string, holding_ids: string[]) => {
        const goal = await db.userGoals.findFirst({
            where: {
                id: goal_id,
                user_id,
                status: { not: "DELETED" },
            },
        });

        logger.debug(`Goal found for user proceed to mapping...`)

        if (!goal) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        const holdings = await db.mfHolding.findMany({
            where: {
                id: { in: holding_ids },
                user_id,
            },
        });

        if (holdings.length === 0) {
            throw new AppError("No matching holdings found for this user", 404, "HOLDINGS_NOT_FOUND");
        }

        await db.mfHolding.updateMany({
            where: {
                id: { in: holding_ids },
                user_id,
            },
            data: {
                user_goal_id: goal_id,
            },
        });

        logger.info(`Mapped ${holdings.length} holding(s) to goal ${goal_id} for user ${user_id}`);
        return await this.getGoalById(user_id, goal_id);
    };

    /**
     * Unmap mutual fund holdings from a goal.
     */
    unmapHoldingsFromGoal = async (user_id: string, holding_ids: string[], goal_id?: string) => {
        if (goal_id) {
            const goal = await db.userGoals.findFirst({
                where: {
                    id: goal_id,
                    user_id,
                    status: { not: "DELETED" },
                },
            });

            if (!goal) {
                throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
            }
        }

        const whereClause: Prisma.MfHoldingWhereInput = {
            id: { in: holding_ids },
            user_id,
            ...(goal_id ? { user_goal_id: goal_id } : {}),
        };

        const updated = await db.mfHolding.updateMany({
            where: whereClause,
            data: {
                user_goal_id: null,
            },
        });

        logger.info(`Unmapped ${updated.count} holding(s) from goal ${goal_id || "any"} for user ${user_id}`);

        if (goal_id) {
            return await this.getGoalById(user_id, goal_id);
        }

        return {
            unmapped_count: updated.count,
        };
    };

    /**
     * Sync database goals for onboarding flow.
     */
    sync_db = async (user_id: string, goals: UserGoalInput[] | undefined, tx: TxClient | typeof db = db) => {
        const created_goals: Array<{ id: string; goal_type_id: number }> = [];

        await tx.userGoals.deleteMany({ where: { user_id } });

        if (goals && goals.length > 0) {
            for (const goal of goals) {
                const cfg = await this.getConfigForType(goal.goal_type_id);
                const isType5 = goal.goal_type_id === 5;
                const cost = isType5 ? Number((goal as any).target_amount) : Number((goal as any).current_cost);

                const inflation_rate = goal.inflation_rate !== undefined && goal.inflation_rate !== null
                    ? normalizeRate(goal.inflation_rate)
                    : (cfg.inflation_rate ? Number(cfg.inflation_rate) : null);

                const expected_return_rate = goal.expected_return_rate !== undefined && goal.expected_return_rate !== null
                    ? normalizeRate(goal.expected_return_rate)
                    : Number(cfg.expected_return_rate);

                const projections = calculateGoalProjections({
                    current_cost: cost,
                    years_remaining: goal.years_remaining,
                    current_savings: Number(goal.current_savings || 0),
                    inflation_rate,
                    expected_return_rate,
                    is_inflation_adjusted: !isType5,
                });

                let goal_name = (goal as any).goal_name?.trim();
                if (!goal_name) {
                    if (goal.goal_type_id === 1) goal_name = `${goal.child_name}'s Education`;
                    else if (goal.goal_type_id === 2) goal_name = `${goal.child_name}'s Marriage`;
                    else if (goal.goal_type_id === 3) goal_name = "My Home";
                    else if (goal.goal_type_id === 4) goal_name = "My Vehicle";
                    else if (goal.goal_type_id === 5) goal_name = "My Savings";
                    else goal_name = "My Goal";
                }

                const target_date = new Date();
                target_date.setFullYear(target_date.getFullYear() + goal.years_remaining);

                const created = await tx.userGoals.create({
                    data: {
                        user_id,
                        goal_type_id: goal.goal_type_id,
                        goal_name,
                        child_name: (goal as any).child_name ?? null,
                        child_age: (goal as any).child_age ?? null,
                        asset_subtype: (goal as any).asset_subtype ?? null,
                        years_remaining: goal.years_remaining,
                        target_date,
                        current_cost: !isType5 ? new Prisma.Decimal(cost) : null,
                        target_amount: isType5 ? new Prisma.Decimal(cost) : null,
                        current_savings: new Prisma.Decimal(goal.current_savings || 0),
                        inflation_rate: inflation_rate !== null ? new Prisma.Decimal(inflation_rate) : null,
                        expected_return_rate: new Prisma.Decimal(expected_return_rate),
                        future_target_amount: new Prisma.Decimal(projections.future_target_amount),
                        fv_current_savings: new Prisma.Decimal(projections.fv_current_savings),
                        net_required_corpus: new Prisma.Decimal(projections.net_required_corpus),
                        required_monthly_sip: new Prisma.Decimal(projections.required_monthly_sip),
                        required_lumpsum_today: new Prisma.Decimal(projections.required_lumpsum_today),
                        calculation_version: cfg.config_version || "v2.0",
                        status: "ACTIVE",
                    },
                    select: { id: true, goal_type_id: true },
                });

                created_goals.push(created);
            }
        }

        return created_goals;
    };

    /**
     * Kept for backwards compatibility with onboarding service (now a no-op since FinSys is removed).
     */
    sync_finsys = async (_user: any, _goals: any, _db_goals?: any) => {
        logger.debug("sync_finsys called: FinSys sync disabled for Goals v2");
        return;
    };

    /**
     * Delete all goals for a user.
     */
    delete_all_goals = async (user_id: string, tx: TxClient | typeof db = db) => {
        return await tx.userGoals.deleteMany({
            where: { user_id },
        });
    };
}

export const user_goal_service = new UserGoalServiceClass();