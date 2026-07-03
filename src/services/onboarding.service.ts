import { db } from "../server.js";
import { CompleteOnboardingInput } from "../lib/zod-schemas/onboarding.schema.js";
import { user_finance_service } from "./onboarding/user.finance.service.js";
import { user_assets_service } from "./onboarding/user.assets.service.js";
import { user_insurance_service } from "./onboarding/user.insurance.service.js";
import { user_loan_service } from "./onboarding/user.loan.service.js";
import { user_goal_service } from "./onboarding/user.goal.service.js";
import logger from "../middleware/logger.js";

class OnboardingServiceClass {

    complete_onboarding = async (user: any, data: CompleteOnboardingInput) => {
        let synced_db_goals: Array<{ id: string; goal_type_id: number; }> = [];

        // Phase 1: All DB writes in a single transaction.
        // If anything fails here the whole thing rolls back cleanly.
        await db.$transaction(async (tx) => {
            const profileData: any = { ...(data.profile ?? {}) };
            if (profileData.dob) {
                profileData.dob = profileData.dob instanceof Date ? profileData.dob.toISOString() : String(profileData.dob);
            }

            await tx.user.update({
                where: { id: user.id },
                data: {
                    ...profileData,
                    meta_data: {
                        onboarding_stage: 6,
                        is_onboarding_completed: true,
                    },
                },
            });

            if (data.finance) {
                await user_finance_service.create(user.id, data.finance, tx as any);
            }
            if (data.assets) {
                await user_assets_service.create(user.id, data.assets, tx as any);
            }
            if (data.insurance) {
                await user_insurance_service.create(user.id, data.insurance, tx as any);
            }

            if (data.loans && data.loans.length > 0) {
                await user_loan_service.sync(user.id, data.loans, tx as any);
            }

            if (data.goals && data.goals.length > 0) {
                synced_db_goals = await user_goal_service.sync_db(user.id, data.goals, tx as any);
            }
        });

        logger.debug(`DB transaction committed for onboarding user: ${user.id}`);

        // Phase 2: FinSys API calls — outside the transaction, best-effort.
        // DB data is already committed so a FinSys failure does not affect stored user data.
        // goal_id will be populated if FinSys responds; otherwise it stays null and can be retried.
        if (data.goals && data.goals.length > 0) {
            logger.debug(`Starting FinSys goal sync for user: ${user.id} (${data.goals.length} goals)`);
            await user_goal_service.sync_finsys(user, data.goals, synced_db_goals);
        }

        return {
            onboarding_stage: 6,
            is_onboarding_completed: true,
            loans_count: data.loans?.length ?? 0,
            goals_count: data.goals?.length ?? 0,
        };
    }
}

export const onboarding_service = new OnboardingServiceClass();
