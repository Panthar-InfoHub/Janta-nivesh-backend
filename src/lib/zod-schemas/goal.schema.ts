import { z } from "zod";

// This is a zod schema to verify user goal input data in controller/service layers

const baseSchema = z.object({
    inflation_rate: z.number().min(0),
    return_rate: z.number().min(0),
    current_saved_amount: z.number().min(0),
});

const childGoalSchema = baseSchema.extend({
    goal_type_id: z.union([z.literal(1), z.literal(2)]),
    child_name: z.string().min(1),
    child_age: z.number().min(0),
    years_left: z.number().min(1),
    current_goal_cost: z.number().min(1),
});

const retirementGoalSchema = baseSchema.extend({
    goal_type_id: z.literal(3),
    current_age: z.number().min(18),
    retirement_age: z.number().min(18),
    life_expectancy: z.number().min(18),
    current_monthly_expense: z.number().min(1),
    post_retirement_return: z.number().min(0),
});

const itemGoalSchema = baseSchema.extend({
    goal_type_id: z.literal(4), // Can be expanded for type 5 etc
    goal_name: z.string().min(1),
    goal_item_id: z.number().int(),
    goal_item_name: z.string().optional(),
    years_left: z.number().min(1),
    current_goal_cost: z.number().min(1),
});

export const user_goal_zod_schema = z.discriminatedUnion("goal_type_id", [
    childGoalSchema.extend({ goal_type_id: z.literal(1) }),
    childGoalSchema.extend({ goal_type_id: z.literal(2) }),
    retirementGoalSchema,
    itemGoalSchema
]);


export const goal_map_zod_schema = z.object({
    goal_id: z.number(),
    map_data: z.array(z.object({
        folio: z.string(),
        scheme_id: z.string()
    })).min(1)
})

export type goal_map_res = {
    folio: string,
    scheme_id: string,
    code: number,
    message: string
}

export type GoalMapInput = z.infer<typeof goal_map_zod_schema>;

export type UserGoalInput = z.infer<typeof user_goal_zod_schema>;