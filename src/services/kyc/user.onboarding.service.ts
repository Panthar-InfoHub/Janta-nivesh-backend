import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";
import logger from "../../middleware/logger.js";

// Not to be confused with `onboarding_service` (src/services/onboarding.service.ts) -
// that one tracks the financial/goals onboarding flow via User.meta_data.
// This one tracks the KYC/investor onboarding flow (readiness -> kyc -> penny drop -> profile).
class UserOnboardingServiceClass {

    /**
     * Ensures a UserOnboarding row exists for the user (lazy-create on first touch),
     * so every downstream read can assume a non-null row instead of null-checking everywhere.
     */
    get_or_create = async (user_id: string) => {
        const existing = await db.userOnboarding.findUnique({ where: { user_id } });
        if (existing) return existing;

        logger.debug("No UserOnboarding row found, creating default one", { user_id });
        return await db.userOnboarding.create({ data: { user_id } });
    }

    /**
     * Typed patch - accepts any valid UserOnboarding fields.
     * Usage:
     *   update_stage(user_id, { readiness_status: "IN_PROGRESS" })
     *   update_stage(user_id, { current_stage: "PENNY_DROP_VERIFICATION", readiness_status: "VERIFIED" })
     */
    update_stage = async (user_id: string, data: Prisma.UserOnboardingUpdateInput) => {
        await this.get_or_create(user_id); // ensure the row exists before patching it
        return await db.userOnboarding.update({ where: { user_id }, data });
    }

    /**
     * Checks all five stage columns and flips is_completed/current_stage/completed_at once
     * every stage is in an acceptable terminal state (VERIFIED, or SKIPPED where that's valid -
     * kyc and nominee only). current_stage can already be ahead of an unfinished stage (e.g.
     * NOMINEE_ADDITION while kyc is still IN_PROGRESS) since the cursor doesn't hard-block
     * progression - this is what actually gates completion.
     */
    recompute_completion = async (user_id: string) => {
        const onboarding = await this.get_or_create(user_id);

        const is_done =
            ["VERIFIED", "SKIPPED"].includes(onboarding.readiness_status) &&
            ["VERIFIED", "SKIPPED"].includes(onboarding.kyc_status) &&
            onboarding.penny_drop_status === "VERIFIED" &&
            onboarding.profile_status === "VERIFIED" &&
            ["VERIFIED", "SKIPPED"].includes(onboarding.nominee_status);

        if (is_done && !onboarding.is_completed) {
            logger.info("All onboarding stages resolved, marking onboarding complete", { user_id });
            return await db.userOnboarding.update({
                where: { user_id },
                data: { is_completed: true, current_stage: "COMPLETED", completed_at: new Date() }
            });
        }

        return onboarding;
    }

    /**
     * Onboarding status summary shaped for the client - used in the auth response so the
     * app knows which screen to resume on without a separate status call.
     */
    get_status_summary = async (user_id: string) => {
        const onboarding = await this.get_or_create(user_id);

        return {
            current_stage: onboarding.current_stage,
            is_completed: onboarding.is_completed,
            stages: {
                readiness: onboarding.readiness_status,
                kyc: onboarding.kyc_status,
                penny_drop: onboarding.penny_drop_status,
                profile: onboarding.profile_status,
                nominee: onboarding.nominee_status
            },
        };
    }
}

export const user_onboarding_service = new UserOnboardingServiceClass();
