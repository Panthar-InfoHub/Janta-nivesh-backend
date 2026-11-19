import { Prisma } from "../../prisma/generated/prisma/client.js";
import { db } from "../../server.js";
import { calculateGoalProjections, normalizeRate } from "../../lib/goal-calculator.js";
import {
    calculateRetirement,
    timelineFromDob,
    timelineFromAges,
} from "../../lib/retirement-calculator.js";
import {
    GoalCalculateInput,
    UserGoalInput,
    UserGoalUpdateInput,
    RetirementCalculateInput,
    RetirementGoalInput,
} from "../../lib/zod-schemas/goal.schema.js";
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
    7: {
        name: "Retirement",
        purpose: "Plan your retirement corpus, lifestyle costs, and pension gap",
        calculation_mode: "Retirement cash flow & shortfall projection",
        tenure_suggestions: [10, 20, 30],
        min_years: 0,
        max_years: 60,
        default_cost_chips: [25000, 50000, 100000, 200000],
    },
};

export class UserGoalServiceClass {
    /**
     * Get system goal calculation configs enriched with frontend presentation metadata.
     * Option 1:
     * - When is_velvet is true (Velvet): Returns ALL 7 goals (1 to 6 PLUS Retirement).
     * - When is_velvet is false (Janta): Returns only standard Janta goals (Types 1-6).
     * No duplicate DB rows needed.
     */
    getConfig = async (is_velvet: boolean = false) => {
        const whereClause = is_velvet
            ? { active: true } // Velvet sees all active goals (1 to 7)
            : { active: true, goal_type_id: { in: [1, 2, 3, 4, 5, 6] } }; // Janta sees standard goals 1 to 6

        const configs = await db.goalCalculationConfig.findMany({
            where: whereClause,
            orderBy: { goal_type_id: "asc" },
        });

        const mapped = configs.map((cfg) => {
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
                is_velvet: cfg.is_velvet,
            };
        });
        return mapped;
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
            if (goal_type_id === 7) {
                return {
                    id: "default-retirement-config",
                    goal_type_id: 7,
                    inflation_rate: new Prisma.Decimal(0.06),
                    expected_return_rate: new Prisma.Decimal(0.10),
                    min_years: 0,
                    max_years: 60,
                    is_velvet: true,
                    active: true,
                    config_version: "v2.0",
                    effective_from: new Date(),
                    updatedAt: new Date(),
                };
            }

            const defaultInflation = goal_type_id === 3 || goal_type_id === 4 ? 0.05 : goal_type_id === 5 ? null : 0.06;
            return {
                id: `default-config-${goal_type_id}`,
                goal_type_id,
                inflation_rate: defaultInflation !== null ? new Prisma.Decimal(defaultInflation) : null,
                expected_return_rate: new Prisma.Decimal(0.10),
                min_years: meta?.min_years ?? 1,
                max_years: meta?.max_years ?? 30,
                is_velvet: false,
                active: true,
                config_version: "v2.0",
                effective_from: new Date(),
                updatedAt: new Date(),
            };
        }

        return cfg;
    };

    /**
     * Stateless calculation preview for interactive sliders / simulators without persisting.
     */
    calculate = async (input: GoalCalculateInput) => {
        if (input.goal_type_id === 7) {
            const retInput = input as RetirementCalculateInput;
            const timeline = timelineFromAges(
                retInput.current_age,
                retInput.retirement_age,
                retInput.plan_until_age
            );
            const projections = calculateRetirement(retInput, timeline);
            return {
                goal_type_id: 7,
                ...timeline,
                ...projections,
            };
        }

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

        // ── Retirement Goal (goal_type_id: 7) ─────────────────────────────
        if (data.goal_type_id === 7) {
            const retData = data as RetirementGoalInput;

            // Derive current age and milestones from saved verified DOB
            const userRecord = await db.user.findUnique({
                where: { id: user_id },
                select: {
                    dob: true,
                    kyc_profile: { select: { dob: true } },
                },
            });

            const rawDob = userRecord?.dob || userRecord?.kyc_profile?.dob;
            if (!rawDob) {
                throw new AppError(
                    "Verified Date of Birth (DOB) is required to create a Retirement goal. Please complete your profile details.",
                    400,
                    "DOB_REQUIRED"
                );
            }

            const timeline = timelineFromDob(rawDob, retData.retirement_age, retData.plan_until_age);
            const projections = calculateRetirement(retData, timeline);
            const goal_name = retData.goal_name?.trim() || "Retirement";

            const created = await db.$transaction(async (tx) => {
                const goal = await tx.userGoals.create({
                    data: {
                        user_id,
                        goal_type_id: 7,
                        goal_name,
                        years_remaining: timeline.years_to_retirement,
                        target_date: timeline.retirement_date,
                        current_savings: new Prisma.Decimal(retData.existing_retirement_savings || 0),
                        inflation_rate: new Prisma.Decimal(projections.inflation_before_used),
                        expected_return_rate: new Prisma.Decimal(projections.pre_retirement_return_used),
                        future_target_amount: new Prisma.Decimal(projections.target_retirement_corpus),
                        fv_current_savings: new Prisma.Decimal(projections.fv_existing_savings),
                        net_required_corpus: new Prisma.Decimal(projections.remaining_corpus_to_build),
                        required_monthly_sip: new Prisma.Decimal(projections.total_monthly_sip),
                        required_lumpsum_today: new Prisma.Decimal(projections.additional_lumpsum_today),
                        is_velvet: true,
                        calculation_version: cfg.config_version || "v2.0",
                        status: "ACTIVE",
                    },
                });

                const details = await tx.userGoalRetirementDetails.create({
                    data: {
                        goal_id: goal.id,
                        current_age: timeline.current_age,
                        retirement_age: timeline.retirement_age,
                        plan_until_age: timeline.plan_until_age,
                        retirement_date: timeline.retirement_date,
                        planning_end_date: timeline.planning_end_date,
                        monthly_lifestyle_expense: new Prisma.Decimal(retData.monthly_lifestyle_cost),
                        existing_retirement_savings: new Prisma.Decimal(retData.existing_retirement_savings || 0),
                        current_monthly_sip: new Prisma.Decimal(retData.current_monthly_sip || 0),
                        pension_monthly_amount: new Prisma.Decimal(retData.pension_or_regular_income || 0),
                        annual_pension_increase: new Prisma.Decimal(projections.pension_increase_used),
                        pre_retirement_return: new Prisma.Decimal(projections.pre_retirement_return_used),
                        post_retirement_return: new Prisma.Decimal(projections.post_retirement_return_used),
                        inflation_before_retirement: new Prisma.Decimal(projections.inflation_before_used),
                        inflation_during_retirement: new Prisma.Decimal(projections.inflation_during_used),
                        additional_corpus_buffer: new Prisma.Decimal(projections.buffer_used),
                        base_retirement_corpus: new Prisma.Decimal(projections.base_retirement_corpus),
                        target_retirement_corpus: new Prisma.Decimal(projections.target_retirement_corpus),
                        fv_existing_savings: new Prisma.Decimal(projections.fv_existing_savings),
                        remaining_corpus_to_build: new Prisma.Decimal(projections.remaining_corpus_to_build),
                        total_monthly_sip: new Prisma.Decimal(projections.total_monthly_sip),
                        extra_monthly_sip: new Prisma.Decimal(projections.extra_monthly_sip),
                        additional_lumpsum_today: new Prisma.Decimal(projections.additional_lumpsum_today),
                        monthly_cost_at_retirement: new Prisma.Decimal(projections.monthly_cost_at_retirement),
                        calculation_snapshot: projections as any,
                    },
                });

                return {
                    ...goal,
                    retirement_details: details,
                };
            });

            logger.info(`Retirement Goal created successfully for user ${user_id}: ${created.id}`);
            return created;
        }

        // ── Standard Goals (Types 1 - 6) ──────────────────────────────────
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
                is_velvet: false,
                calculation_version: cfg.config_version || "v2.0",
                status: "ACTIVE",
            },
        });

        logger.info(`Goal created successfully for user ${user_id}: ${created.id}`);
        return created;
    };

    static HOLDINGS_INCLUDE = {
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

    formatGoalWithHoldings = (goal: any) => {
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

        let retirement_details = goal.retirement_details ? {
            ...goal.retirement_details,
            monthly_lifestyle_expense: Number(goal.retirement_details.monthly_lifestyle_expense),
            existing_retirement_savings: Number(goal.retirement_details.existing_retirement_savings),
            current_monthly_sip: Number(goal.retirement_details.current_monthly_sip),
            pension_monthly_amount: Number(goal.retirement_details.pension_monthly_amount),
            annual_pension_increase: Number(goal.retirement_details.annual_pension_increase),
            pre_retirement_return: Number(goal.retirement_details.pre_retirement_return),
            post_retirement_return: Number(goal.retirement_details.post_retirement_return),
            inflation_before_retirement: Number(goal.retirement_details.inflation_before_retirement),
            inflation_during_retirement: Number(goal.retirement_details.inflation_during_retirement),
            additional_corpus_buffer: Number(goal.retirement_details.additional_corpus_buffer),
            base_retirement_corpus: Number(goal.retirement_details.base_retirement_corpus),
            target_retirement_corpus: Number(goal.retirement_details.target_retirement_corpus),
            fv_existing_savings: Number(goal.retirement_details.fv_existing_savings),
            remaining_corpus_to_build: Number(goal.retirement_details.remaining_corpus_to_build),
            total_monthly_sip: Number(goal.retirement_details.total_monthly_sip),
            extra_monthly_sip: Number(goal.retirement_details.extra_monthly_sip),
            additional_lumpsum_today: Number(goal.retirement_details.additional_lumpsum_today),
            monthly_cost_at_retirement: Number(goal.retirement_details.monthly_cost_at_retirement),
        } : null;

        return {
            ...goal,
            holdings,
            total_holdings_value: Number(total_holdings_value.toFixed(2)),
            total_invested_amount: Number(total_invested_amount.toFixed(2)),
            total_current_value,
            progress_percent,
            ...(retirement_details ? { retirement_details } : {}),
        };
    };

    /**
     * Get all active goals for a user.
     * When is_velvet is true (Velvet): returns all active goals (1 to 7).
     * When is_velvet is false (Janta): returns only standard Janta goals (1 to 6).
     */
    getUserGoals = async (user_id: string, is_velvet: boolean = false) => {
        const whereClause = is_velvet
            ? { user_id, status: { not: "DELETED" as const } }
            : { user_id, status: { not: "DELETED" as const }, goal_type_id: { in: [1, 2, 3, 4, 5, 6] } };

        const goals = await db.userGoals.findMany({
            where: whereClause,
            include: {
                holdings: UserGoalServiceClass.HOLDINGS_INCLUDE,
                retirement_details: true,
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
                retirement_details: true,
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
            include: {
                retirement_details: true,
            },
        });

        if (!existing) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        // ── Retirement Goal Update (goal_type_id: 7) ──────────────────────
        if (existing.goal_type_id === 7) {
            const userRecord = await db.user.findUnique({
                where: { id: user_id },
                select: {
                    dob: true,
                    kyc_profile: { select: { dob: true } },
                },
            });
            const rawDob = userRecord?.dob || userRecord?.kyc_profile?.dob;
            if (!rawDob) {
                throw new AppError("Verified Date of Birth (DOB) is required for Retirement recalculation", 400, "DOB_REQUIRED");
            }

            const currentDetails = existing.retirement_details;
            const retAge = data.retirement_age ?? currentDetails?.retirement_age ?? 60;
            const planAge = data.plan_until_age ?? currentDetails?.plan_until_age ?? 90;
            const monthlyCost = data.monthly_lifestyle_cost ?? (currentDetails ? Number(currentDetails.monthly_lifestyle_expense) : 0);
            const savings = data.existing_retirement_savings ?? (data.current_savings !== undefined ? data.current_savings : (currentDetails ? Number(currentDetails.existing_retirement_savings) : 0));
            const sip = data.current_monthly_sip ?? (currentDetails ? Number(currentDetails.current_monthly_sip) : 0);
            const pension = data.pension_or_regular_income ?? (currentDetails ? Number(currentDetails.pension_monthly_amount) : 0);
            const pensionIncrease = data.annual_pension_increase ?? (currentDetails ? Number(currentDetails.annual_pension_increase) : 0);
            const preRetReturn = data.pre_retirement_return ?? (data.expected_return_rate !== undefined ? data.expected_return_rate : (currentDetails ? Number(currentDetails.pre_retirement_return) : 0.10));
            const postRetReturn = data.post_retirement_return ?? (currentDetails ? Number(currentDetails.post_retirement_return) : 0.06);
            const infPre = data.inflation_before_retirement ?? (data.inflation_rate !== undefined ? data.inflation_rate : (currentDetails ? Number(currentDetails.inflation_before_retirement) : 0.06));
            const infPost = data.inflation_during_retirement ?? (currentDetails ? Number(currentDetails.inflation_during_retirement) : 0.06);
            const buffer = data.additional_corpus_buffer ?? (currentDetails ? Number(currentDetails.additional_corpus_buffer) : 0.10);

            const timeline = timelineFromDob(rawDob, retAge, planAge);
            const projections = calculateRetirement({
                monthly_lifestyle_cost: monthlyCost,
                existing_retirement_savings: savings,
                current_monthly_sip: sip,
                pension_or_regular_income: pension,
                annual_pension_increase: pensionIncrease,
                pre_retirement_return: preRetReturn,
                post_retirement_return: postRetReturn,
                inflation_before_retirement: infPre,
                inflation_during_retirement: infPost,
                additional_corpus_buffer: buffer,
            }, timeline);

            const updated = await db.$transaction(async (tx) => {
                const goal = await tx.userGoals.update({
                    where: { id: goal_id },
                    data: {
                        ...(data.goal_name && { goal_name: data.goal_name }),
                        years_remaining: timeline.years_to_retirement,
                        target_date: timeline.retirement_date,
                        current_savings: new Prisma.Decimal(savings),
                        inflation_rate: new Prisma.Decimal(projections.inflation_before_used),
                        expected_return_rate: new Prisma.Decimal(projections.pre_retirement_return_used),
                        future_target_amount: new Prisma.Decimal(projections.target_retirement_corpus),
                        fv_current_savings: new Prisma.Decimal(projections.fv_existing_savings),
                        net_required_corpus: new Prisma.Decimal(projections.remaining_corpus_to_build),
                        required_monthly_sip: new Prisma.Decimal(projections.total_monthly_sip),
                        required_lumpsum_today: new Prisma.Decimal(projections.additional_lumpsum_today),
                        ...(data.status && { status: data.status }),
                    },
                });

                const details = await tx.userGoalRetirementDetails.upsert({
                    where: { goal_id },
                    create: {
                        goal_id,
                        current_age: timeline.current_age,
                        retirement_age: timeline.retirement_age,
                        plan_until_age: timeline.plan_until_age,
                        retirement_date: timeline.retirement_date,
                        planning_end_date: timeline.planning_end_date,
                        monthly_lifestyle_expense: new Prisma.Decimal(monthlyCost),
                        existing_retirement_savings: new Prisma.Decimal(savings),
                        current_monthly_sip: new Prisma.Decimal(sip),
                        pension_monthly_amount: new Prisma.Decimal(pension),
                        annual_pension_increase: new Prisma.Decimal(projections.pension_increase_used),
                        pre_retirement_return: new Prisma.Decimal(projections.pre_retirement_return_used),
                        post_retirement_return: new Prisma.Decimal(projections.post_retirement_return_used),
                        inflation_before_retirement: new Prisma.Decimal(projections.inflation_before_used),
                        inflation_during_retirement: new Prisma.Decimal(projections.inflation_during_used),
                        additional_corpus_buffer: new Prisma.Decimal(projections.buffer_used),
                        base_retirement_corpus: new Prisma.Decimal(projections.base_retirement_corpus),
                        target_retirement_corpus: new Prisma.Decimal(projections.target_retirement_corpus),
                        fv_existing_savings: new Prisma.Decimal(projections.fv_existing_savings),
                        remaining_corpus_to_build: new Prisma.Decimal(projections.remaining_corpus_to_build),
                        total_monthly_sip: new Prisma.Decimal(projections.total_monthly_sip),
                        extra_monthly_sip: new Prisma.Decimal(projections.extra_monthly_sip),
                        additional_lumpsum_today: new Prisma.Decimal(projections.additional_lumpsum_today),
                        monthly_cost_at_retirement: new Prisma.Decimal(projections.monthly_cost_at_retirement),
                        calculation_snapshot: projections as any,
                    },
                    update: {
                        current_age: timeline.current_age,
                        retirement_age: timeline.retirement_age,
                        plan_until_age: timeline.plan_until_age,
                        retirement_date: timeline.retirement_date,
                        planning_end_date: timeline.planning_end_date,
                        monthly_lifestyle_expense: new Prisma.Decimal(monthlyCost),
                        existing_retirement_savings: new Prisma.Decimal(savings),
                        current_monthly_sip: new Prisma.Decimal(sip),
                        pension_monthly_amount: new Prisma.Decimal(pension),
                        annual_pension_increase: new Prisma.Decimal(projections.pension_increase_used),
                        pre_retirement_return: new Prisma.Decimal(projections.pre_retirement_return_used),
                        post_retirement_return: new Prisma.Decimal(projections.post_retirement_return_used),
                        inflation_before_retirement: new Prisma.Decimal(projections.inflation_before_used),
                        inflation_during_retirement: new Prisma.Decimal(projections.inflation_during_used),
                        additional_corpus_buffer: new Prisma.Decimal(projections.buffer_used),
                        base_retirement_corpus: new Prisma.Decimal(projections.base_retirement_corpus),
                        target_retirement_corpus: new Prisma.Decimal(projections.target_retirement_corpus),
                        fv_existing_savings: new Prisma.Decimal(projections.fv_existing_savings),
                        remaining_corpus_to_build: new Prisma.Decimal(projections.remaining_corpus_to_build),
                        total_monthly_sip: new Prisma.Decimal(projections.total_monthly_sip),
                        extra_monthly_sip: new Prisma.Decimal(projections.extra_monthly_sip),
                        additional_lumpsum_today: new Prisma.Decimal(projections.additional_lumpsum_today),
                        monthly_cost_at_retirement: new Prisma.Decimal(projections.monthly_cost_at_retirement),
                        calculation_snapshot: projections as any,
                    },
                });

                return {
                    ...goal,
                    retirement_details: details,
                };
            });

            logger.info(`Retirement Goal updated successfully: ${goal_id}`);
            return updated;
        }

        // ── Standard Goals Update (Types 1 - 6) ───────────────────────────
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
     * Delete all goals for a user.
     */
    delete_all_goals = async (user_id: string, tx: TxClient | typeof db = db) => {
        return await tx.userGoals.deleteMany({
            where: { user_id },
        });
    };
}

export const user_goal_service = new UserGoalServiceClass();