import { db } from "../../server.js";
import logger from "../../middleware/logger.js";
import { user_service } from "../user.service.js";
import { kyc_profile_service } from "./kyc-profile.service.js";
import { user_onboarding_service } from "./user.onboarding.service.js";
import { cybrilla_pan_verification_service } from "../cybrilla/pan_verification.service.js";
import { fintech_primitive_investor_profile_service } from "../fintech-primitive/investor_profile.service.js";
import { fintech_primitive_address_service } from "../fintech-primitive/address.service.js";
import { fintech_primitive_phone_number_service } from "../fintech-primitive/phone_number.service.js";
import { fintech_primitive_email_address_service } from "../fintech-primitive/email_address.service.js";
import { map_pep_details_for_investor_profile } from "./onboarding-field-mapper.js";
import { notification_producer_service } from "../notification.producer.service.js";
import { notification_type } from "../../lib/types.js";

// Re-check throttle: don't create a new pre_verification if the last check was within 15 minutes
const RECHECK_THROTTLE_MS = 45 * 60 * 1000;

class KycApprovalServiceClass {

    /**
     * Executes the post-approval lifecycle:
     * 1. Creates FP Investor Profile (if not already created)
     * 2. Creates FP Address, Phone, Email
     * 3. Advances UserOnboarding to PENNY_DROP_VERIFICATION
     * 4. Recomputes completion
     * 5. Sends KYC Completed push notification
     * 6. Marks kyc_poll_status: "VERIFIED"
     */
    complete_kyc_approval = async (user_id: string) => {
        logger.info("Executing KYC approval lifecycle", { user_id });

        const kyc_profile = await db.kycProfile.findUnique({
            where: { user_id },
            include: { user: true },
        });

        if (!kyc_profile || !kyc_profile.user) {
            logger.warn("Cannot complete KYC approval: user or kyc_profile not found", { user_id });
            return false;
        }

        // 1. Create FP Investor Profile if not already created
        let investor_profile_id = kyc_profile.user.investor_profile;

        if (!investor_profile_id) {
            const investor_profile = await fintech_primitive_investor_profile_service.create_investor_profile({
                name: kyc_profile.full_name!,
                date_of_birth: kyc_profile.dob!,
                gender: kyc_profile.gender!,
                occupation: kyc_profile.occupation!,
                pan: kyc_profile.pan!,
                place_of_birth: kyc_profile.place_of_birth,
                use_default_tax_residences: kyc_profile.use_default_tax_residences,
                first_tax_residency: kyc_profile.first_tax_residency,
                source_of_wealth: kyc_profile.source_of_fund!,
                income_slab: kyc_profile.income_slab!,
                pep_details: map_pep_details_for_investor_profile(kyc_profile.is_pep_declaration_confirmed),
            });

            if (!investor_profile?.id) {
                logger.error("Failed to create FP investor profile during KYC approval", { user_id, investor_profile });
                return false;
            }

            investor_profile_id = investor_profile.id;
            await user_service.update_user(user_id, { investor_profile: investor_profile_id });

            // Create FP Address, Phone, Email
            const address = await fintech_primitive_address_service.create_address(investor_profile_id, {
                line1: kyc_profile.address!,
                postal_code: kyc_profile.pincode!,
                city: kyc_profile.city!,
                country: "IN",
                nature: "residential",
            });

            const phone = await fintech_primitive_phone_number_service.create_phone_number(
                investor_profile_id, "91", kyc_profile.user.phone_no!, "self"
            );

            const email = await fintech_primitive_email_address_service.create_email_address(
                investor_profile_id, kyc_profile.user.email!, "self"
            );

            await kyc_profile_service.upsert(user_id, {
                fp_address_id: address?.id ?? null,
                fp_phone_id: phone?.id ?? null,
                fp_email_id: email?.id ?? null,
            });
        }

        // 2. Advance stage cursor to PENNY_DROP_VERIFICATION
        const onboarding_before = await user_onboarding_service.get_or_create(user_id);
        await user_onboarding_service.update_stage(user_id, {
            readiness_status: "VERIFIED",
            kyc_status: "VERIFIED",
            profile_status: "VERIFIED",
            ...(onboarding_before.current_stage === "INVESTOR_PROFILE" ||
                onboarding_before.current_stage === "KYC_VERIFICATION" ||
                onboarding_before.current_stage === "PAN_VERIFICATION"
                ? { current_stage: "PENNY_DROP_VERIFICATION" }
                : {}),
        });

        await user_onboarding_service.recompute_completion(user_id);

        // 3. Mark poll status as VERIFIED
        await kyc_profile_service.upsert(user_id, {
            kyc_poll_status: "VERIFIED",
        });

        logger.info("User stage successfully advanced to PENNY_DROP_VERIFICATION via KYC approval service", { user_id });

        // 4. Send notification
        try {
            await notification_producer_service.publish_notification_event(
                kyc_profile.user.id,
                "TRANSACTION",
                "KYC Verification Completed",
                `Your KYC verification is successfully completed, ${kyc_profile.user.full_name}`,
                {
                    txn: "kyc",
                    sub_type: notification_type.NOTIFICATION,
                }
            );
        } catch (notif_err) {
            logger.error("Failed to send KYC approval notification", { user_id, error: notif_err });
        }

        return true;
    };

    /**
     * Checks and synchronizes the post-submission KYC status for a user.
     * Called whenever a submitted KYC status is fetched (e.g. app open or webhook).
     */
    sync_submitted_kyc_status = async (user_id: string) => {
        try {
            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.pan || !kyc_profile?.full_name || !kyc_profile?.dob) {
                logger.warn("Cannot sync submitted KYC status: incomplete profile", { user_id });
                return null;
            }

            // If already verified, nothing to do
            if (kyc_profile.kyc_poll_status === "VERIFIED") {
                return { status: "VERIFIED" };
            }

            const now = Date.now();

            // Case A: No post-submission pre-verification has been created yet
            if (!kyc_profile.kyc_poll_pre_verification_id) {
                logger.info("Submitting post-eSign pre-verification check to Cybrilla", { user_id });

                const pre_verification = await cybrilla_pan_verification_service.create_pre_verification({
                    pan: kyc_profile.pan,
                    name: kyc_profile.full_name,
                    date_of_birth: kyc_profile.dob,
                });

                if (pre_verification?.id) {
                    await kyc_profile_service.upsert(user_id, {
                        kyc_poll_pre_verification_id: pre_verification.id,
                        kyc_poll_status: "PENDING",
                        kyc_poll_submitted_at: new Date(),
                        kyc_poll_response: pre_verification,
                    });
                }

                return { status: "PENDING", pre_verification_id: pre_verification?.id };
            }

            // Case B: We already have a pre-verification ID - check its current status
            const pre_verification = await cybrilla_pan_verification_service.get_pre_verification(
                kyc_profile.kyc_poll_pre_verification_id
            );

            const is_processing_complete = !!pre_verification?.completed_at;
            const readiness = pre_verification?.readiness;

            if (is_processing_complete) {
                if (readiness?.status === "verified") {
                    logger.info("Cybrilla post-submission check verified! Completing approval", { user_id });
                    await kyc_profile_service.upsert(user_id, {
                        kyc_poll_response: pre_verification,
                    });
                    await this.complete_kyc_approval(user_id);
                    return { status: "VERIFIED", pre_verification };
                }

                // If readiness is failed with kyc_underprocess at KRA, check if throttle elapsed to retry
                if (readiness?.status === "failed") {
                    const code = readiness?.code;
                    const last_submitted = kyc_profile.kyc_poll_submitted_at?.getTime() || 0;
                    const time_since_last_check = now - last_submitted;

                    if (code === "kyc_underprocess") {
                        logger.info("KRA KYC is still under process", { user_id, time_since_last_check });

                        // If > 15 minutes have passed since last submit, submit a fresh pre_verification check to re-query KRA
                        if (time_since_last_check > RECHECK_THROTTLE_MS) {
                            logger.info("Throttle elapsed, creating fresh pre-verification to re-query KRA", { user_id });
                            const new_pre_verification = await cybrilla_pan_verification_service.create_pre_verification({
                                pan: kyc_profile.pan,
                                name: kyc_profile.full_name,
                                date_of_birth: kyc_profile.dob,
                            });

                            if (new_pre_verification?.id) {
                                await kyc_profile_service.upsert(user_id, {
                                    kyc_poll_pre_verification_id: new_pre_verification.id,
                                    kyc_poll_status: "PENDING",
                                    kyc_poll_submitted_at: new Date(),
                                    kyc_poll_response: new_pre_verification,
                                });
                            }
                        }
                        return { status: "PENDING", code: "kyc_underprocess" };
                    }

                    // Terminal failures (kyc_rejected, kyc_deactivated)
                    if (code === "kyc_rejected" || code === "kyc_deactivated") {
                        logger.warn("Post-submission KYC rejected or deactivated at KRA", { user_id, code });
                        await kyc_profile_service.upsert(user_id, {
                            kyc_poll_status: "FAILED",
                            kyc_poll_response: pre_verification,
                        });
                        await user_onboarding_service.update_stage(user_id, { kyc_status: "FAILED" });
                        await user_onboarding_service.recompute_completion(user_id);
                        return { status: "FAILED", code };
                    }
                }
            }

            // Pre-verification still in progress
            await kyc_profile_service.upsert(user_id, {
                kyc_poll_response: pre_verification,
            });

            return { status: "PENDING" };
        } catch (error) {
            logger.error("Error in sync_submitted_kyc_status:", error);
            return null;
        }
    };
}

export const kyc_approval_service = new KycApprovalServiceClass();

