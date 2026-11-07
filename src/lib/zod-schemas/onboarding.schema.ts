import { z } from "zod";
import { user_loan_zod_schema } from "./loan.schema.js";
import { user_goal_zod_schema } from "./goal.schema.js";

export const onboarding_finance_schema = z.union([
    z.object({
        skip: z.literal(true),
    }),
    z.object({
        annual_income: z.number().min(0),
        expense_house: z.number().min(0),
        expense_food: z.number().min(0),
        expense_transportation: z.number().min(0),
        expense_others: z.number().min(0),
    }),
]);

export const onboarding_assets_schema = z.union([
    z.object({
        skip: z.literal(true),
    }),
    z.object({
        mutual_funds: z.number().min(0),
        stocks: z.number().min(0),
        fd: z.number().min(0),
        real_estate: z.number().min(0),
        gold: z.number().min(0),
        cash_saving: z.number().min(0),
    }),
]);

export const onboarding_insurance_schema = z.union([
    z.object({
        skip: z.literal(true),
    }),
    z.object({
        life_insurance: z.number().min(0),
        health_insurance: z.number().min(0),
    }),
]);

const loan_array_schema = z.array(user_loan_zod_schema).superRefine((loans, ctx) => {
    const loan_types = new Set<string>();

    for (let i = 0; i < loans.length; i++) {
        const loan_type = loans[i].loan_type;
        if (loan_types.has(loan_type)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate loan_type found: ${loan_type}`,
                path: [i, "loan_type"],
            });
        }
        loan_types.add(loan_type);
    }
});

export const onboarding_loans_schema = z.union([
    z.object({
        skip: z.literal(true),
    }),
    z.object({
        loans: loan_array_schema,
    }),
    loan_array_schema,
]);

export const onboarding_goals_schema = z.union([
    z.object({
        skip: z.literal(true),
    }),
    z.object({
        skip: z.literal(false).optional(),
        goals: z.array(user_goal_zod_schema).min(1),
    }),
    z.object({
        skip: z.literal(false).optional(),
        goal: user_goal_zod_schema,
    }),
    user_goal_zod_schema,
    z.array(user_goal_zod_schema).min(1),
]);
