import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { OnboardingStage } from "../../prisma/generated/prisma/enums.js";
import logger from "../../middleware/logger.js";

// Not to be confused with `onboarding_service` (src/services/onboarding.service.ts) -
// that one tracks the financial/goals onboarding flow via User.meta_data.
// This one tracks the KYC/investor onboarding flow (basic details -> readiness -> kyc -> email -> profile -> penny drop -> nominee).
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
     * Deterministically computes the true pending stage based on the pipeline sequence.
     * Prevents desynchronization or corrupted stage cursors from migrations or testing skips.
     */
    determine_pending_stage = (onboarding: {
        basic_details_status: string;
        readiness_status: string;
        kyc_status: string;
        email_status: string;
        profile_status: string;
        penny_drop_status: string;
        nominee_status: string;
    }): OnboardingStage => {
        if (onboarding.basic_details_status !== "VERIFIED") return "BASIC_DETAILS";
        if (onboarding.readiness_status !== "VERIFIED" && onboarding.kyc_status === "PENDING") return "PAN_VERIFICATION";
        if (onboarding.kyc_status === "IN_PROGRESS" && onboarding.profile_status === "PENDING") return "KYC_VERIFICATION";
        if (onboarding.email_status !== "VERIFIED") return "EMAIL_VERIFICATION";
        if (onboarding.profile_status !== "VERIFIED") return "INVESTOR_PROFILE";
        if (onboarding.penny_drop_status !== "VERIFIED") return "PENNY_DROP_VERIFICATION";
        if (onboarding.nominee_status === "PENDING") return "NOMINEE_ADDITION";
        return "COMPLETED";
    };

    /**
     * Checks all stage columns and flips is_completed/current_stage/completed_at once
     * every stage is in an acceptable terminal state (VERIFIED, or SKIPPED where that's valid).
     * If corrupted (current_stage === COMPLETED but not all stages verified), automatically
     * corrects current_stage back to the true pending stage.
     */
    recompute_completion = async (user_id: string) => {
        const onboarding = await this.get_or_create(user_id);

        // Backward-compatible reverse penny check:
        // If reverse penny is VERIFIED/SKIPPED, or if bank account is already verified via penny drop
        // (even if reverse penny was PENDING, IN_PROGRESS, or FAILED), onboarding is not blocked.
        const is_reverse_penny_satisfied =
            ["VERIFIED", "SKIPPED", "IN_PROGRESS"].includes(onboarding.reverse_penny_status) ||
            (onboarding.penny_drop_status === "VERIFIED" &&
                ["PENDING", "IN_PROGRESS", "SKIPPED", "FAILED"].includes(onboarding.reverse_penny_status));

        // Readiness is satisfied if readiness_status is VERIFIED, or if KYC is VERIFIED
        // (Case 2 fresh KYC users failed initial readiness at KRA, but their verified Aadhaar KYC satisfies compliance)
        const is_readiness_satisfied =
            onboarding.readiness_status === "VERIFIED" || onboarding.kyc_status === "VERIFIED";

        const is_done =
            onboarding.basic_details_status === "VERIFIED" && // strict - mandatory stage, no skip path exists
            is_readiness_satisfied &&
            ["VERIFIED", "SKIPPED"].includes(onboarding.kyc_status) &&
            is_reverse_penny_satisfied &&
            onboarding.penny_drop_status === "VERIFIED" &&
            onboarding.email_status === "VERIFIED" && // strict - email OTP is never skippable
            onboarding.profile_status === "VERIFIED" &&
            ["VERIFIED", "SKIPPED"].includes(onboarding.nominee_status);

        if (is_done && !onboarding.is_completed) {
            logger.info("All onboarding stages resolved, marking onboarding complete", { user_id });
            return await db.userOnboarding.update({
                where: { user_id },
                data: {
                    is_completed: true,
                    current_stage: "COMPLETED",
                    has_navigated_home: true,
                    completed_at: new Date()
                }
            });
        }

        // If corrupted: current_stage is COMPLETED but is_done is false, repair current_stage to the actual pending stage
        if (!is_done && onboarding.current_stage === "COMPLETED") {
            const actual_stage = this.determine_pending_stage(onboarding);
            logger.warn("Correcting premature COMPLETED stage in onboarding", { user_id, actual_stage });
            return await db.userOnboarding.update({
                where: { user_id },
                data: { current_stage: actual_stage, is_completed: false }
            });
        }

        return onboarding;
    }

    /**
     * Centralized computation of user navigation and KYC progress flags.
     * Prevents desynchronization across auth.controller, user.controller, and status summary.
     */
    compute_navigation_flags = (onboarding?: {
        is_completed?: boolean | null;
        has_navigated_home?: boolean | null;
        kyc_status?: string | null;
        profile_status?: string | null;
    } | null) => {
        if (!onboarding) {
            return {
                is_kyc_completed: false,
                kyc_under_review: false,
                can_navigate_home: false,
                is_skip: false,
            };
        }

        const is_kyc_completed =
            onboarding.kyc_status === "VERIFIED" ||
            (onboarding.kyc_status === "IN_PROGRESS" && onboarding.profile_status === "IN_PROGRESS");

        const kyc_under_review =
            onboarding.kyc_status === "IN_PROGRESS" && onboarding.profile_status === "IN_PROGRESS";

        const can_navigate_home =
            Boolean(onboarding.is_completed) ||
            Boolean(onboarding.has_navigated_home) ||
            kyc_under_review;

        const is_skip = Boolean(onboarding.has_navigated_home) && !onboarding.is_completed;

        return {
            is_kyc_completed,
            kyc_under_review,
            can_navigate_home,
            is_skip,
        };
    };

    /**
     * Onboarding status summary shaped for the client - used in the auth response so the
     * app knows which screen to resume on without a separate status call.
     */
    get_status_summary = async (user_id: string) => {
        // Run recompute to self-heal any corrupted stage cursor (e.g. current_stage is COMPLETED while is_completed is false)
        const onboarding = await this.recompute_completion(user_id);

        const flags = this.compute_navigation_flags(onboarding);

        return {
            current_stage: onboarding.current_stage,
            is_completed: onboarding.is_completed,
            has_navigated_home: onboarding.has_navigated_home,
            is_kyc_completed: flags.is_kyc_completed,
            kyc_under_review: flags.kyc_under_review,
            can_navigate_home: flags.can_navigate_home,
            is_skip: flags.is_skip,
            stages: {
                basic_details: onboarding.basic_details_status,
                readiness: onboarding.readiness_status,
                kyc: onboarding.kyc_status,
                email: onboarding.email_status,
                profile: onboarding.profile_status,
                reverse_penny: onboarding.reverse_penny_status,
                penny_drop: onboarding.penny_drop_status,
                nominee: onboarding.nominee_status
            },
        };
    }
}

export const user_onboarding_service = new UserOnboardingServiceClass();
