import { z } from "zod";

/**
 * Common base fields for goals
 */
const baseRateAndSavingsSchema = z.object({
    current_savings: z.coerce.number().min(0, "Current savings must be >= 0").optional().default(0),
    inflation_rate: z.coerce.number().min(0, "Inflation rate must be >= 0").optional(),
    expected_return_rate: z.coerce.number().min(0, "Expected return rate must be >= 0").optional(),
});

// 1. Child's Education (goal_type_id: 1)
export const childEducationSchema = baseRateAndSavingsSchema.extend({
    goal_type_id: z.literal(1),
    goal_name: z.string().min(2).max(60).optional(),
    child_name: z.string().min(2, "Child name must be at least 2 characters").max(50, "Child name cannot exceed 50 characters"),
    child_age: z.coerce.number().int().min(0, "Child age must be >= 0").max(25, "Child age cannot exceed 25 years"),
    years_remaining: z.coerce.number().int().min(1, "Years remaining must be at least 1").max(30, "Years remaining cannot exceed 30"),
    current_cost: z.coerce.number().min(1000, "Current cost must be at least ₹1,000").max(100000000, "Current cost cannot exceed ₹10 crore"),
});

// 2. Child's Marriage (goal_type_id: 2)
export const childMarriageSchema = baseRateAndSavingsSchema.extend({
    goal_type_id: z.literal(2),
    goal_name: z.string().min(2).max(60).optional(),
    child_name: z.string().min(2, "Child name must be at least 2 characters").max(50, "Child name cannot exceed 50 characters"),
    child_age: z.coerce.number().int().min(0, "Child age must be >= 0").max(30, "Child age cannot exceed 30 years"),
    years_remaining: z.coerce.number().int().min(1, "Years remaining must be at least 1").max(30, "Years remaining cannot exceed 30"),
    current_cost: z.coerce.number().min(1000, "Current cost must be at least ₹1,000").max(100000000, "Current cost cannot exceed ₹10 crore"),
});

// 3. Buy a Home (goal_type_id: 3)
export const buyHomeSchema = baseRateAndSavingsSchema.extend({
    goal_type_id: z.literal(3),
    goal_name: z.string().min(2, "Goal name must be at least 2 characters").max(60).default("My Home"),
    years_remaining: z.coerce.number().int().min(1, "Years remaining must be at least 1").max(30, "Years remaining cannot exceed 30"),
    current_cost: z.coerce.number().min(1000, "Current cost must be at least ₹1,000").max(200000000, "Current cost cannot exceed ₹20 crore"),
});

// 4. Buy a Vehicle (goal_type_id: 4)
export const buyVehicleSchema = baseRateAndSavingsSchema.extend({
    goal_type_id: z.literal(4),
    goal_name: z.string().min(2, "Goal name must be at least 2 characters").max(60).default("My Vehicle"),
    asset_subtype: z.enum(["BIKE", "SCOOTER", "CAR"]),
    years_remaining: z.coerce.number().int().min(1, "Years remaining must be at least 1").max(15, "Years remaining cannot exceed 15 for vehicle"),
    current_cost: z.coerce.number().min(10000, "Current cost must be at least ₹10,000").max(50000000, "Current cost cannot exceed ₹5 crore"),
});

// 5. Build My Savings (goal_type_id: 5)
export const buildSavingsSchema = baseRateAndSavingsSchema.extend({
    goal_type_id: z.literal(5),
    goal_name: z.string().min(2, "Goal name must be at least 2 characters").max(60).default("My Savings"),
    years_remaining: z.coerce.number().int().min(1, "Years remaining must be at least 1").max(30, "Years remaining cannot exceed 30"),
    target_amount: z.coerce.number().min(1000, "Target amount must be at least ₹1,000").max(200000000, "Target amount cannot exceed ₹20 crore"),
});

// 6. Other Goal (goal_type_id: 6)
export const otherGoalSchema = baseRateAndSavingsSchema.extend({
    goal_type_id: z.literal(6),
    goal_name: z.string().min(2, "Goal name must be at least 2 characters").max(60, "Goal name cannot exceed 60 characters"),
    years_remaining: z.coerce.number().int().min(1, "Years remaining must be at least 1").max(30, "Years remaining cannot exceed 30"),
    current_cost: z.coerce.number().min(1000, "Current cost must be at least ₹1,000").max(200000000, "Current cost cannot exceed ₹20 crore"),
});

/**
 * Discriminated union for creating a goal (v2)
 */
export const user_goal_zod_schema = z.discriminatedUnion("goal_type_id", [
    childEducationSchema,
    childMarriageSchema,
    buyHomeSchema,
    buyVehicleSchema,
    buildSavingsSchema,
    otherGoalSchema,
]);

/**
 * Schema for updating a goal
 */
export const user_goal_update_zod_schema = z.object({
    goal_name: z.string().min(2).max(60).optional(),
    child_name: z.string().min(2).max(50).optional(),
    child_age: z.coerce.number().int().min(0).max(30).optional(),
    asset_subtype: z.enum(["BIKE", "SCOOTER", "CAR"]).optional(),
    years_remaining: z.coerce.number().int().min(1).max(30).optional(),
    current_cost: z.coerce.number().min(1000).optional(),
    target_amount: z.coerce.number().min(1000).optional(),
    current_savings: z.coerce.number().min(0).optional(),
    inflation_rate: z.coerce.number().min(0).optional(),
    expected_return_rate: z.coerce.number().min(0).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "DELETED"]).optional(),
});

/**
 * Schema for the interactive preview calculation endpoint
 */
export const goal_calculate_schema = z.object({
    goal_type_id: z.coerce.number().int().min(1).max(6),
    years_remaining: z.coerce.number().int().min(1).max(30),
    current_cost: z.coerce.number().min(0).optional(),
    target_amount: z.coerce.number().min(0).optional(),
    current_savings: z.coerce.number().min(0).optional().default(0),
    inflation_rate: z.coerce.number().min(0).optional(),
    expected_return_rate: z.coerce.number().min(0).optional(),
});

/**
 * Mapping mutual fund holdings to goals
 */
const holdingIdOrList = z.union([
    z.array(z.string().min(1)).min(1, "At least one holding id is required"),
    z.string().min(1).transform(id => [id]),
]);

export const map_goal_holding_schema = z.object({
    goal_id: z.string().min(1, "goal_id is required"),
    holding_ids: holdingIdOrList.optional(),
    holding_id: holdingIdOrList.optional(),
}).refine(data => (data.holding_ids && data.holding_ids.length > 0) || (data.holding_id && data.holding_id.length > 0), {
    message: "At least one holding_id or holding_ids is required",
    path: ["holding_ids"],
}).transform(data => {
    const ids = new Set<string>();
    if (data.holding_ids) data.holding_ids.forEach(id => ids.add(id));
    if (data.holding_id) data.holding_id.forEach(id => ids.add(id));
    return {
        goal_id: data.goal_id,
        holding_ids: Array.from(ids),
    };
});

/**
 * Unmapping mutual fund holdings from goals
 */
export const unmap_goal_holding_schema = z.object({
    goal_id: z.string().optional(),
    holding_ids: holdingIdOrList.optional(),
    holding_id: holdingIdOrList.optional(),
}).refine(data => (data.holding_ids && data.holding_ids.length > 0) || (data.holding_id && data.holding_id.length > 0), {
    message: "At least one holding_id or holding_ids is required",
    path: ["holding_ids"],
}).transform(data => {
    const ids = new Set<string>();
    if (data.holding_ids) data.holding_ids.forEach(id => ids.add(id));
    if (data.holding_id) data.holding_id.forEach(id => ids.add(id));
    return {
        goal_id: data.goal_id,
        holding_ids: Array.from(ids),
    };
});

export type MapGoalHoldingInput = z.infer<typeof map_goal_holding_schema>;
export type UnmapGoalHoldingInput = z.infer<typeof unmap_goal_holding_schema>;

/**
 * Legacy schema (kept for backwards compatibility)
 */
export const goal_map_zod_schema = z.object({
    goal_id: z.string(),
    map_data: z.array(z.object({
        folio: z.string(),
        scheme_id: z.string()
    })).min(1)
});

export type goal_map_res = {
    folio: string;
    scheme_id: string;
    code: number;
    message: string;
};

export type GoalMapInput = z.infer<typeof goal_map_zod_schema>;
export type UserGoalInput = z.infer<typeof user_goal_zod_schema>;
export type UserGoalUpdateInput = z.infer<typeof user_goal_update_zod_schema>;
export type GoalCalculateInput = z.infer<typeof goal_calculate_schema>;