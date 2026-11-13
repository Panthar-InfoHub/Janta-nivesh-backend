import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { penny_drop_schema } from "../../lib/zod-schemas/penny-drop.schema.js";
import { user_bank_details_service } from "../../services/user-bank-details.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { cybrilla_pan_verification_service } from "../../services/cybrilla/pan_verification.service.js";
import { reverse_penny_service } from "../../services/kyc/reverse_penny.service.js";
import { fintech_primitive_bank_account_service } from "../../services/fintech-primitive/bank_account.service.js";
import { user_service } from "../../services/user.service.js";
import { sync_investment_account } from "../../services/kyc/investment-account-sync.service.js";
import { db } from "../../server.js";

class PennyDropControllerClass {

    /**
     * Evaluates the bank_accounts[0] verification result from a Cybrilla pre_verification response.
     * Updates UserBankDetails and UserOnboarding.
     * If failed, throws the appropriate AppError:
     * - "uncertain" / "bank_account_proof_required" -> AppError(..., 422, "BANK_MANUAL_VERIFICATION_REQUIRED")
     * - "low_confidence" -> AppError(..., 400, "BANK_NAME_MISMATCH")
     * - other failure -> AppError(..., 400, "BANK_VERIFICATION_FAILED")
     */
    handle_bank_verification_result = async (
        user_id: string,
        bank_details_id: string,
        bank_account_result: any,
        kyc_profile: any
    ) => {
        if (!bank_account_result) return null;

        await user_bank_details_service.sync_verification_from_pre_verification(bank_details_id, bank_account_result);

        const status = bank_account_result.status;
        const code = bank_account_result.code;
        const reason = bank_account_result.reason;

        logger.info("Evaluating bank account verification outcome", { user_id, status, code, reason });

        if (status === "verified") {
            const onboarding_before = await user_onboarding_service.get_or_create(user_id);
            await user_onboarding_service.update_stage(user_id, {
                penny_drop_status: "VERIFIED",
                ...(onboarding_before.current_stage === "PENNY_DROP_VERIFICATION" ? { current_stage: "NOMINEE_ADDITION" } : {}),
            });

            const user = await user_service.get_user_by_id(user_id);
            const current_bank = await db.userBankDetails.findUnique({ where: { id: bank_details_id } });

            if (user?.investor_profile && current_bank && !current_bank.fp_bank_account_id) {
                const fp_bank = await fintech_primitive_bank_account_service.create_bank_account(user.investor_profile, {
                    primary_account_holder_name: current_bank.account_holder_name ?? kyc_profile?.full_name!,
                    account_number: current_bank.account_no,
                    type: (current_bank.account_type as "savings" | "current" | "nre" | "nro") ?? "savings",
                    ifsc_code: current_bank.ifsc_code,
                });
                if (fp_bank?.id) {
                    await user_bank_details_service.set_fp_bank_account_ids(current_bank.id, fp_bank.id, fp_bank.old_id);
                }
            }

            await sync_investment_account(user_id);
            await user_onboarding_service.recompute_completion(user_id);
            return { status: "verified" };
        }

        if (status === "failed") {
            await user_onboarding_service.update_stage(user_id, { penny_drop_status: "FAILED" });
            await user_onboarding_service.recompute_completion(user_id);

            if (code === "uncertain" || code === "bank_account_proof_required") {
                logger.warn("Bank verification uncertain - manual verification required with proof", { user_id, code, reason });
                throw new AppError(
                    reason || "Bank account verification is uncertain. Please upload bank proof for manual verification.",
                    422,
                    "BANK_MANUAL_VERIFICATION_REQUIRED",
                    {
                        code,
                        reason,
                        bank_details_id,
                    }
                );
            }

            if (code === "low_confidence") {
                logger.warn("Bank verification name mismatch", { user_id, code, reason });
                throw new AppError(
                    reason || "The name on this bank account does not match your KYC/PAN details. Please use your own account.",
                    400,
                    "BANK_NAME_MISMATCH",
                    { code, reason, bank_details_id }
                );
            }

            logger.warn("Bank verification failed", { user_id, code, reason });
            throw new AppError(
                reason || "Bank account verification failed. Please check the account number and IFSC code or try another account.",
                400,
                "BANK_VERIFICATION_FAILED",
                { code, reason, bank_details_id }
            );
        }

        return { status: status || "in_progress" };
    };

    submit_bank_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = penny_drop_schema.parse(req.body);

            logger.info("Saving penny drop bank details", { user_id });

            const onboarding_before = await user_onboarding_service.get_or_create(user_id);
            if (onboarding_before.profile_status !== "VERIFIED") {
                throw new AppError("Complete investor profile stage first", 400, "INVESTOR_PROFILE_REQUIRED");
            }

            const bank_details = await user_bank_details_service.save_from_penny_drop(user_id, input);

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.pan || !kyc_profile?.full_name || !kyc_profile?.dob) {
                throw new AppError("Complete PAN verification first", 400, "PAN_VERIFICATION_REQUIRED");
            }

            // Re-run pre_verification, now with bank_accounts - same resource/poll endpoint
            // as stage 1 (GET .../pan-verification/status), just an extended response this time.
            const pre_verification = await cybrilla_pan_verification_service.create_pre_verification({
                pan: kyc_profile.pan,
                name: kyc_profile.full_name,
                date_of_birth: kyc_profile.dob,
                bank_accounts: [{
                    account_number: input.account_number,
                    ifsc_code: input.ifsc_code,
                    account_type: input.account_type,
                }],
            });

            if (pre_verification?.id) {
                await kyc_profile_service.upsert_pre_verification(user_id, {
                    pan: kyc_profile.pan,
                    full_name: kyc_profile.full_name,
                    dob: kyc_profile.dob,
                    pre_verification_response: pre_verification
                });
            }

            await user_onboarding_service.update_stage(user_id, {
                penny_drop_status: "IN_PROGRESS",
                current_stage: "PENNY_DROP_VERIFICATION",
            });
            await user_onboarding_service.recompute_completion(user_id);

            // One best-effort immediate poll - Cybrilla is sometimes fast enough that this
            // already has the answer. If it's not done yet (or this call itself fails for any
            // reason), we still return 200 for the actual save - frontend polls status from here.
            let bank_accounts: any = null;
            let is_processing_complete = false;

            if (pre_verification?.id) {
                try {
                    const fetched = await cybrilla_pan_verification_service.get_pre_verification(pre_verification.id);
                    await kyc_profile_service.update_pre_verification_status(user_id, fetched);

                    is_processing_complete = !!fetched?.completed_at;
                    bank_accounts = fetched?.bank_accounts ?? null;

                    if (Array.isArray(bank_accounts) && bank_accounts.length > 0) {
                        await this.handle_bank_verification_result(user_id, bank_details.id, bank_accounts[0], kyc_profile);
                    }
                } catch (poll_error: any) {
                    if (poll_error instanceof AppError) {
                        throw poll_error;
                    }
                    logger.warn("Immediate one-shot pre-verification poll failed, leaving it to frontend polling", { user_id, error: poll_error });
                }
            }

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "Bank details saved",
                data: {
                    bank_account_id: bank_details.id,
                    pre_verification_id: pre_verification?.id ?? null,
                    is_processing_complete,
                    bank_accounts,
                    onboarding,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in submit_bank_details controller:", error);
            next(error);
            return;
        }
    };

    /**
     * GET /api/v2/onboarding/penny-drop/status
     * Dedicated poll endpoint for checking bank account verification status.
     */
    check_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Polling penny drop verification status", { user_id });

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.cybrilla_pre_verification_id) {
                throw new AppError("No bank verification request found - submit bank details first", 404, "PRE_VERIFICATION_NOT_FOUND");
            }

            const primary_bank = await user_bank_details_service.get_primary(user_id);
            if (!primary_bank) {
                throw new AppError("No bank details found for user", 404, "BANK_DETAILS_NOT_FOUND");
            }

            const pre_verification = await cybrilla_pan_verification_service.get_pre_verification(
                kyc_profile.cybrilla_pre_verification_id
            );
            await kyc_profile_service.update_pre_verification_status(user_id, pre_verification);

            const is_processing_complete = !!pre_verification?.completed_at;
            const bank_accounts = pre_verification?.bank_accounts ?? null;

            if (is_processing_complete && Array.isArray(bank_accounts) && bank_accounts.length > 0) {
                await this.handle_bank_verification_result(user_id, primary_bank.id, bank_accounts[0], kyc_profile);
            }

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "Bank verification status fetched",
                data: {
                    pre_verification_id: pre_verification?.id,
                    status: pre_verification?.status,
                    is_processing_complete,
                    bank_accounts,
                    onboarding,
                },
            });
            return;
        } catch (error) {
            logger.error("Error in penny drop check_status controller:", error);
            next(error);
            return;
        }
    };

    /**
     * POST /api/v2/onboarding/penny-drop/manual-verify
     * Handles manual bank verification when digital verification returns uncertain.
     * Uploads proof to Cybrilla /poa/files and triggers pre_verification with:
     * - bank_account_proof: file_id
     * - verify_manually_if_required: true
     */
    manual_verify = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Submitting manual bank verification with proof", { user_id });

            const file = (req as any).file;
            if (!file) {
                throw new AppError("Bank account proof file is required", 400, "BANK_PROOF_FILE_REQUIRED");
            }

            const primary_bank = await user_bank_details_service.get_primary(user_id);
            if (!primary_bank) {
                throw new AppError("No bank details found - submit bank details first", 400, "BANK_DETAILS_NOT_FOUND");
            }

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.pan || !kyc_profile?.full_name || !kyc_profile?.dob) {
                throw new AppError("Complete PAN verification first", 400, "PAN_VERIFICATION_REQUIRED");
            }

            // 1. Upload proof file to Cybrilla
            const uploaded_file = await cybrilla_pan_verification_service.upload_file(
                file.buffer,
                file.originalname,
                file.mimetype,
                "bank account proof"
            );

            if (!uploaded_file?.id) {
                throw new AppError("Failed to upload bank account proof to provider", 502, "BANK_PROOF_UPLOAD_FAILED");
            }

            logger.info("Bank account proof uploaded to Cybrilla", { user_id, file_id: uploaded_file.id });

            // 2. Trigger pre-verification with proof file & verify_manually_if_required: true
            const pre_verification = await cybrilla_pan_verification_service.create_pre_verification({
                pan: kyc_profile.pan,
                name: kyc_profile.full_name,
                date_of_birth: kyc_profile.dob,
                bank_accounts: [{
                    account_number: primary_bank.account_no,
                    ifsc_code: primary_bank.ifsc_code,
                    account_type: primary_bank.account_type || "savings",
                    bank_account_proof: uploaded_file.id,
                    verify_manually_if_required: true,
                }],
            });

            if (pre_verification?.id) {
                await kyc_profile_service.upsert_pre_verification(user_id, {
                    pan: kyc_profile.pan,
                    full_name: kyc_profile.full_name,
                    dob: kyc_profile.dob,
                    pre_verification_response: pre_verification,
                });
            }

            await db.userBankDetails.update({
                where: { id: primary_bank.id },
                data: {
                    verification_status: "IN_PROGRESS",
                    verification_method: "CYBRILLA_MANUAL_VERIFICATION",
                },
            });

            await user_onboarding_service.update_stage(user_id, {
                penny_drop_status: "IN_PROGRESS",
                current_stage: "PENNY_DROP_VERIFICATION",
            });
            await user_onboarding_service.recompute_completion(user_id);

            // One best-effort immediate poll
            let is_processing_complete = false;
            let bank_accounts: any = null;

            if (pre_verification?.id) {
                try {
                    const fetched = await cybrilla_pan_verification_service.get_pre_verification(pre_verification.id);
                    await kyc_profile_service.update_pre_verification_status(user_id, fetched);

                    is_processing_complete = !!fetched?.completed_at;
                    bank_accounts = fetched?.bank_accounts ?? null;

                    if (is_processing_complete && Array.isArray(bank_accounts) && bank_accounts.length > 0) {
                        await this.handle_bank_verification_result(user_id, primary_bank.id, bank_accounts[0], kyc_profile);
                    }
                } catch (poll_err: any) {
                    if (poll_err instanceof AppError) {
                        throw poll_err;
                    }
                    logger.warn("Immediate poll on manual verify failed, leaving to polling", { user_id, error: poll_err });
                }
            }

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(202).json({
                success: true,
                message: "Bank account proof submitted for manual verification",
                data: {
                    bank_account_id: primary_bank.id,
                    pre_verification_id: pre_verification?.id ?? null,
                    proof_file_id: uploaded_file.id,
                    is_processing_complete,
                    bank_accounts,
                    onboarding,
                },
            });
            return;
        } catch (error) {
            logger.error("Error in manual_verify controller:", error);
            next(error);
            return;
        }
    };

    /**
     * GET /api/v2/onboarding/penny-drop/prefill
     * Returns verified bank details captured during Reverse Penny (Decentro UPI ₹1).
     * Used by the frontend Penny Drop screen to automatically populate bank details.
     */
    get_prefill = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const prefill = await reverse_penny_service.get_prefill(user_id);

            res.status(200).json({
                success: true,
                message: prefill.has_prefilled
                    ? "Prefilled bank details fetched"
                    : "No prefilled bank details found",
                data: prefill,
            });
            return;
        } catch (error) {
            logger.error("Error in penny_drop get_prefill controller:", error);
            next(error);
            return;
        }
    };
}

export const penny_drop_controller = new PennyDropControllerClass();
