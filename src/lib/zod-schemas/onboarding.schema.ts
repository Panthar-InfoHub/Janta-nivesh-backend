import { z } from "zod";
import { user_goal_zod_schema } from "./goal.schema.js";
import { user_loan_zod_schema } from "./loan.schema.js";

const onboarding_profile_schema = z.object({
    full_name: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    dob: z.coerce.date().optional(),
    email: z.string().email().optional(),
    phone: z.string().min(10).max(15).optional(),
});

const onboarding_finance_schema = z.object({
    annual_income: z.number().min(0),
    expense_house: z.number().min(0),
    expense_food: z.number().min(0),
    expense_transportation: z.number().min(0),
    expense_others: z.number().min(0),
});

const onboarding_assets_schema = z.object({
    mutual_funds: z.number().min(0),
    stocks: z.number().min(0),
    fd: z.number().min(0),
    real_estate: z.number().min(0),
    gold: z.number().min(0),
    cash_saving: z.number().min(0),
});

const onboarding_insurance_schema = z.object({
    life_insurance: z.number().min(0),
    health_insurance: z.number().min(0),
});

const onboarding_loans_schema = z.array(user_loan_zod_schema).superRefine((loans, ctx) => {
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

const onboarding_goals_schema = z.array(user_goal_zod_schema).superRefine((goals, ctx) => {
    const goal_types = new Set<number>();

    for (let i = 0; i < goals.length; i++) {
        const goal_type = goals[i].goal_type_id;
        goal_types.add(goal_type);
    }
});

export const complete_onboarding_zod_schema = z.object({
    profile: onboarding_profile_schema,
    finance: onboarding_finance_schema,
    assets: onboarding_assets_schema,
    insurance: onboarding_insurance_schema,
    loans: onboarding_loans_schema,
    goals: onboarding_goals_schema,
});

export type CompleteOnboardingInput = z.infer<typeof complete_onboarding_zod_schema>;
