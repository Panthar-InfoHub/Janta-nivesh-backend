import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { pan_verification_schema } from "../../lib/zod-schemas/kyc-onboarding.schema.js";
import { cybrilla_pan_verification_service } from "../../services/cybrilla/pan_verification.service.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_bank_details_service } from "../../services/user-bank-details.service.js";

class PanVerificationControllerClass {

    /**
     * PAN readiness check, and the one place the user can defer the rest of onboarding.
     *
     * skip: true  -> readiness_status: SKIPPED, current_stage left at PAN_VERIFICATION so the
     *                client can resume here later. No "resume" endpoint exists - the user coming
     *                back and submitting this same endpoint with skip:false is what un-skips them,
     *                same shape as the nominee skip. Nothing is sent to Cybrilla.
     * skip: false -> the real readiness check. name/dob come from the basic-details stage that
     *                runs first, never from this request body.
     */
    verify_pan = async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.info("PAN readiness verification requested");

            const user_id = req.user?.id!;
            const input = pan_verification_schema.parse(req.body);

            if (input.skip === true) {
                logger.info("User skipped the PAN stage (deferring onboarding)", { user_id });
                await user_onboarding_service.update_stage(user_id, { readiness_status: "SKIPPED" });

                res.status(200).json({
                    success: true,
                    message: "Onboarding skipped",
                    data: { onboarding: await user_onboarding_service.get_status_summary(user_id) }
                });
                return;
            }

            const { pan } = input;

            // name/dob now come from the basic-details stage that runs first, not this request body.
            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.full_name || !kyc_profile?.dob) {
                throw new AppError("Complete basic details first", 400, "BASIC_DETAILS_REQUIRED");
            }
            const name = kyc_profile.full_name;
            const date_of_birth = kyc_profile.dob;

            await user_onboarding_service.update_stage(user_id, { readiness_status: "IN_PROGRESS" });

            const pre_verification = await cybrilla_pan_verification_service.create_pre_verification({
                pan,
                name,
                date_of_birth
            });

            if (!pre_verification?.id) {
                logger.error("Cybrilla pre-verification response missing id ==> ", pre_verification);
                throw new AppError("PAN readiness check failed to initiate", 502, "PAN_READINESS_CHECK_FAILED");
            }

            logger.info(`Per verification request submitted to cybrilla...`)

            await kyc_profile_service.upsert_pre_verification(user_id, {
                pan,
                full_name: name,
                dob: date_of_birth,
                pre_verification_response: pre_verification
            });

            // Cybrilla processes this async - "accepted" now, readiness.status fills in later
            // (poll/webhook - not wired up yet). Stage stays IN_PROGRESS until that lands.
            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(202).json({
                success: true,
                message: "PAN readiness check submitted",
                data: {
                    pre_verification_id: pre_verification.id,
                    status: pre_verification.status,
                    onboarding
                }
            });
            return;
        } catch (error) {
            logger.error("Error in verify_pan controller:", error);
            next(error);
            return;
        }
    }

    check_pan_verification_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;

            logger.info("Polling PAN readiness verification status", { user_id });

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.cybrilla_pre_verification_id) {
                logger.warn(`No PAN readiness check found for user ${user_id} - submit one first`)
                throw new AppError("No PAN readiness check found - submit one first", 404, "PRE_VERIFICATION_NOT_FOUND");
            }

            const pre_verification = await cybrilla_pan_verification_service.get_pre_verification(
                kyc_profile.cybrilla_pre_verification_id
            );

            await kyc_profile_service.update_pre_verification_status(user_id, pre_verification);

            const is_processing_complete = !!pre_verification?.completed_at;

            if (is_processing_complete) {
                const readiness = pre_verification?.readiness;
                const pan_obj = pre_verification?.pan;
                const name_obj = pre_verification?.name;
                const dob_obj = pre_verification?.date_of_birth;

                // 1. Check Readiness Status
                if (readiness?.status === "failed") {
                    const code = readiness?.code;
                    logger.error("Readiness check failed", { code, reason: readiness?.reason });

                    switch (code) {
                        case "kyc_unavailable":
                        case "kyc_rejected":
                            throw new AppError("KYC unavailable or rejected. Submit a new KYC form via KYC Forms API.", 400, "READINESS_KYC_NEW_REQUIRED");
                        case "kyc_incomplete":
                        case "kyc_onhold":
                        case "kyc_legacy":
                            throw new AppError("KYC incomplete, on hold, or legacy. Modify KYC record via KYC Forms API.", 400, "READINESS_KYC_MODIFY_REQUIRED");
                        case "kyc_underprocess":
                            throw new AppError("KYC is under process at KRA. Please wait for status update.", 400, "READINESS_KYC_UNDER_PROCESS");
                        case "kyc_deactivated":
                            throw new AppError("KYC deactivated. Investments cannot be accepted for this investor.", 400, "READINESS_KYC_DEACTIVATED");
                        case "upstream_error":
                            throw new AppError("Upstream error during readiness check. Please retry after some time.", 502, "READINESS_UPSTREAM_ERROR");
                        default:
                            throw new AppError(`Readiness check failed: ${readiness?.reason || code || "Unknown error"}`, 400, "READINESS_FAILED");
                    }
                }

                // 2. Check PAN Hash Status
                if (pan_obj?.status === "failed") {
                    const code = pan_obj?.code;
                    logger.error("PAN verification failed", { code, reason: pan_obj?.reason });

                    switch (code) {
                        case "invalid":
                            throw new AppError("PAN number is invalid or non-existent", 400, "PAN_INVALID");
                        case "aadhaar_not_linked":
                            throw new AppError("Aadhaar is not linked with PAN record. Please seed Aadhaar with PAN.", 400, "PAN_AADHAAR_NOT_LINKED");
                        case "upstream_error":
                            throw new AppError("Upstream error contacting IT department for PAN verification.", 502, "PAN_UPSTREAM_ERROR");
                        default:
                            throw new AppError(`PAN verification failed: ${pan_obj?.reason || code || "Unknown error"}`, 400, "PAN_VERIFICATION_FAILED");
                    }
                }

                // 3. Check Name Hash Status
                if (name_obj?.status === "failed") {
                    const code = name_obj?.code;
                    logger.error("Name verification failed", { code, reason: name_obj?.reason });

                    switch (code) {
                        case "mismatch":
                            throw new AppError("Name does not match with the PAN records at IT department", 400, "NAME_MISMATCH");
                        case "upstream_error":
                            throw new AppError("Upstream error contacting IT department for Name verification", 502, "NAME_UPSTREAM_ERROR");
                        default:
                            throw new AppError(`Name verification failed: ${name_obj?.reason || code || "Unknown error"}`, 400, "NAME_VERIFICATION_FAILED");
                    }
                }

                // 4. Check Date of Birth Hash Status
                if (dob_obj?.status === "failed") {
                    const code = dob_obj?.code;
                    logger.error("Date of birth verification failed", { code, reason: dob_obj?.reason });

                    switch (code) {
                        case "mismatch":
                            throw new AppError("Date of birth does not match with the PAN records at IT department", 400, "DOB_MISMATCH");
                        case "upstream_error":
                            throw new AppError("Upstream error contacting IT department for Date of Birth verification", 502, "DOB_UPSTREAM_ERROR");
                        default:
                            throw new AppError(`Date of Birth verification failed: ${dob_obj?.reason || code || "Unknown error"}`, 400, "DOB_VERIFICATION_FAILED");
                    }
                }

                // All checks passed! Advance readiness_status and current_stage in UserOnboarding.
                // Only move current_stage forward the FIRST time - this same endpoint gets
                // polled again after penny drop (now with bank_accounts attached), and by then
                // the user is already past this stage - don't regress the cursor on that poll.
                if (readiness?.status === "verified" && pan_obj?.status === "verified" && name_obj?.status === "verified" && dob_obj?.status === "verified") {
                    logger.info("PAN readiness and hashes verified successfully", { user_id });

                    const onboarding_before = await user_onboarding_service.get_or_create(user_id);
                    await user_onboarding_service.update_stage(user_id, {
                        readiness_status: "VERIFIED",
                        kyc_status: "VERIFIED",
                        ...(onboarding_before.current_stage === "PAN_VERIFICATION" ? { current_stage: "PENNY_DROP_VERIFICATION" } : {}),
                    });
                }

                // Bank account verification (only present once penny drop has fired a second
                // pre_verification with bank_accounts attached) - sync UserBankDetails, no
                // thrown errors on failure per-code here, just surface the raw result.
                const bank_accounts = pre_verification?.bank_accounts;
                if (Array.isArray(bank_accounts) && bank_accounts.length > 0) {
                    const primary_bank = await user_bank_details_service.get_primary(user_id);
                    if (primary_bank) {
                        await user_bank_details_service.sync_verification_from_pre_verification(primary_bank.id, bank_accounts[0]);

                        if (bank_accounts[0]?.status === "verified") {
                            await user_onboarding_service.update_stage(user_id, { penny_drop_status: "VERIFIED" });
                        } else if (bank_accounts[0]?.status === "failed") {
                            await user_onboarding_service.update_stage(user_id, { penny_drop_status: "FAILED" });
                        }
                    }
                }
            }

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "PAN readiness status fetched",
                data: {
                    pre_verification_id: pre_verification?.id,
                    status: pre_verification?.status,
                    is_processing_complete,
                    readiness: pre_verification?.readiness,
                    bank_accounts: pre_verification?.bank_accounts ?? null,
                    onboarding
                }
            });
            return;
        } catch (error) {
            logger.error("Error in check_pan_verification_status controller:", error);
            next(error);
            return;
        }
    }
}

export const pan_verification_controller = new PanVerificationControllerClass();
