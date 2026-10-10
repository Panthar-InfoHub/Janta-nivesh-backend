import { Request, Response, NextFunction } from "express";
import logger from "../../middleware/logger.js";
import { redis } from "../../lib/redis.js";
import { db } from "../../server.js";
import { cybrilla_kyc_form_service } from "../../services/cybrilla/kyc_form.service.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";
import { fintech_primitive_investor_profile_service } from "../../services/fintech-primitive/investor_profile.service.js";
import { fintech_primitive_address_service } from "../../services/fintech-primitive/address.service.js";
import { fintech_primitive_phone_number_service } from "../../services/fintech-primitive/phone_number.service.js";
import { fintech_primitive_email_address_service } from "../../services/fintech-primitive/email_address.service.js";
import { map_pep_details_for_investor_profile } from "../../services/kyc/onboarding-field-mapper.js";

const DEDUP_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const dedup_key = (event_id: string) => `kyc_webhook_evt:${event_id}`;

/**
 * Single entry point for KYC approval and status notification webhooks.
 *
 * Patterned identically after fp.webhook.controller.ts:
 *   1. parse  - extracts routing fields (kyc_form_id, event_id)
 *   2. claim  - Redis dedup against retries
 *   3. fetch  - re-reads authoritative KYC state directly from Cybrilla API
 *   4. apply  - if KYC verified/submitted: creates FP investor_profile + FP address/phone/email
 *               and advances user's onboarding stage to PENNY_DROP_VERIFICATION.
 */
export const handleKycWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    let event_id: string | undefined;

    try {
        const body = req.body;

        logger.debug(`Kyc webhook body:${body}`)
        const kyc_form_id =
            body?.data?.object?.id ||
            body?.kyc_form_id ||
            body?.data?.id ||
            body?.id;
        event_id =
            body?.id ||
            body?.event_id ||
            `kyc_evt_${kyc_form_id}_${body?.type || "update"}`;

        logger.info("Received KYC webhook", {
            event_id,
            kyc_form_id,
            event_type: body?.type,
        });

        if (!kyc_form_id) {
            logger.warn("KYC webhook missing kyc_form_id in payload", { body });
            res.status(200).json({ success: true, processed: false, reason: "Missing kyc_form_id" });
            return;
        }

        // 1. Dedup using Redis SET NX
        const claimed = await redis.set(dedup_key(event_id), "1", {
            NX: true,
            EX: DEDUP_TTL_SECONDS,
        });

        if (!claimed) {
            logger.info("Duplicate KYC webhook ignored", { event_id, kyc_form_id });
            res.status(200).json({ success: true, duplicate: true });
            return;
        }

        // 2. Authoritative re-fetch from Cybrilla
        const kyc_form = await cybrilla_kyc_form_service.get_kyc_form(kyc_form_id);

        if (!kyc_form?.id) {
            logger.warn("Could not fetch authoritative Cybrilla kyc_form for webhook", { kyc_form_id });
            res.status(200).json({ success: true, processed: false });
            return;
        }

        logger.info("Authoritative Cybrilla kyc_form state fetched", {
            kyc_form_id: kyc_form.id,
            status: kyc_form.status,
        });

        // 3. Find user in KycProfile
        const kyc_profile = await db.kycProfile.findUnique({
            where: { cybrilla_kyc_form_id: kyc_form.id },
            include: { user: true },
        });

        if (!kyc_profile || !kyc_profile.user) {
            logger.warn("No user found associated with Cybrilla kyc_form_id", { kyc_form_id: kyc_form.id });
            res.status(200).json({ success: true, processed: false, reason: "User not found" });
            return;
        }

        const user_id = kyc_profile.user_id;
        await kyc_profile_service.upsert_kyc_form(user_id, kyc_form);

        // 4. Handle Lifecycle:
        const event_type = (body?.type || "").toLowerCase();

        // A. KYC Approved / Verified (kyc_request.successful)
        const is_successful =
            kyc_form.status === "successful" ||
            kyc_form.status === "approved" ||
            kyc_form.status === "verified" ||
            event_type === "kyc_request.successful";

        // B. eSign Submitted / Waiting for verification (kyc_request.submitted)
        const is_submitted =
            kyc_form.status === "submitted" ||
            event_type === "kyc_request.submitted";

        // C. Failed / Rejected / Expired (kyc_request.rejected, expired)
        const is_failed =
            kyc_form.status === "failed" ||
            kyc_form.status === "expired" ||
            kyc_form.status === "rejected" ||
            event_type === "kyc_request.rejected" ||
            event_type === "kyc_request.expired";

        if (is_successful) {
            logger.info("KYC approved via webhook. Creating Fintech Primitives investor profile.", { user_id });

            // Create FP Investor Profile if not already created
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
                    logger.error("Failed to create FP investor profile in KYC webhook", { user_id, investor_profile });
                    res.status(500).json({ error: "Failed to create investor profile" });
                    return;
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

            // Advance stage cursor to PENNY_DROP_VERIFICATION
            const onboarding_before = await user_onboarding_service.get_or_create(user_id);
            await user_onboarding_service.update_stage(user_id, {
                kyc_status: "VERIFIED",
                profile_status: "VERIFIED",
                ...(onboarding_before.current_stage === "INVESTOR_PROFILE" || onboarding_before.current_stage === "KYC_VERIFICATION"
                    ? { current_stage: "PENNY_DROP_VERIFICATION" }
                    : {}),
            });

            logger.info("User stage successfully advanced to PENNY_DROP_VERIFICATION via KYC webhook", { user_id });
        } else if (is_submitted) {
            logger.info("KYC eSign submitted via webhook, waiting for Cybrilla success webhook", { user_id });
            await user_onboarding_service.update_stage(user_id, {
                kyc_status: "IN_PROGRESS",
                profile_status: "IN_PROGRESS",
            });
        } else if (is_failed) {
            logger.warn("KYC marked as failed/rejected via webhook", { user_id, reason: kyc_form.reason });
            await user_onboarding_service.update_stage(user_id, {
                kyc_status: "FAILED",
                profile_status: "FAILED",
            });
        } else {
            logger.info("KYC state updated via webhook (e.g. esign_required)", { user_id, status: kyc_form.status, event_type });
        }

        res.status(200).json({ success: true, processed: true });
        return;
    } catch (error) {
        logger.error("Error in KYC webhook controller:", error);
        if (event_id) {
            try {
                await redis.del(dedup_key(event_id));
            } catch (delError) {
                logger.error("Failed to release KYC webhook dedup key", { event_id, delError });
            }
        }
        res.status(500).json({ error: "KYC webhook processing failed" });
        return;
    }
};
