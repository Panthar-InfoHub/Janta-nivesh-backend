import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { penny_drop_schema } from "../../lib/zod-schemas/penny-drop.schema.js";
import { user_bank_details_service } from "../../services/user-bank-details.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { cybrilla_pan_verification_service } from "../../services/cybrilla/pan_verification.service.js";
import { reverse_penny_service } from "../../services/kyc/reverse_penny.service.js";
import { fintech_primitive_bank_account_service } from "../../services/fintech-primitive/bank_account.service.js";
import { user_service } from "../../services/user.service.js";
import { sync_investment_account } from "../../services/kyc/investment-account-sync.service.js";
import { db } from "../../server.js";

class PennyDropControllerClass {

    /**
     * Submits primary bank account for manual verification with Cybrilla (TAT 24 hrs).
     * Used by submit_bank_details fallback and manual_verify endpoint.
     */
    trigger_manual_verification = async (
        user_id: string,
        bank_details: { id: string; account_no: string; ifsc_code: string; account_type?: string | null },
        kyc_profile: { pan: string; full_name: string; dob: string }
    ) => {
        logger.info("Submitting bank account for manual verification (verify_manually_if_required: true)", {
            user_id,
            bank_details_id: bank_details.id,
        });

        const manual_pre_verification = await cybrilla_pan_verification_service.create_pre_verification({
            pan: kyc_profile.pan,
            name: kyc_profile.full_name,
            date_of_birth: kyc_profile.dob,
            bank_accounts: [{
                account_number: bank_details.account_no,
                ifsc_code: bank_details.ifsc_code,
                account_type: bank_details.account_type || "savings",
                verify_manually_if_required: true,
            }],
        });

        const pre_verif_id = manual_pre_verification?.id;

        // Perform state updates in parallel
        await Promise.all([
            db.userBankDetails.update({
                where: { id: bank_details.id },
                data: {
                    verification_status: "IN_PROGRESS",
                    verification_method: "CYBRILLA_MANUAL_VERIFICATION",
                    provider_reference_id: pre_verif_id ?? null,
                },
            }),
            db.userOnboarding.update({
                where: { user_id },
                data: {
                    penny_drop_status: "IN_PROGRESS",
                    current_stage: "PENNY_DROP_VERIFICATION",
                },
            }),
            pre_verif_id
                ? db.kycProfile.update({
                    where: { user_id },
                    data: { cybrilla_pre_verification_id: pre_verif_id },
                })
                : Promise.resolve(),
        ]);

        return {
            pre_verification_id: pre_verif_id ?? null,
            verification_status: "IN_PROGRESS",
            is_manual_verification: true,
            tat: "24 hours",
            bank_accounts: manual_pre_verification?.bank_accounts ?? null,
        };
    };

    /**
     * Completes bank account verification lifecycle when Cybrilla confirms status === "verified":
     * 1. Creates FP bank account if investor_profile exists
     * 2. Sets userBankDetails to VERIFIED
     * 3. Sets userOnboarding penny_drop_status to VERIFIED & current_stage to NOMINEE_ADDITION
     * 4. Syncs investment account & recomputes completion
     */
    finalize_verified_bank = async (
        user_id: string,
        bank_details: { id: string; account_no: string; ifsc_code: string; account_type?: string | null; account_holder_name?: string | null; fp_bank_account_id?: string | null },
        kyc_profile: { full_name: string }
    ) => {
        logger.info("Finalizing verified bank account", { user_id, bank_details_id: bank_details.id });

        const user = await user_service.get_user_by_id(user_id);
        let fp_id = bank_details.fp_bank_account_id;
        let fp_old_id: number | undefined;

        if (user?.investor_profile && !fp_id) {
            const fp_bank = await fintech_primitive_bank_account_service.create_bank_account(user.investor_profile, {
                primary_account_holder_name: bank_details.account_holder_name ?? kyc_profile.full_name,
                account_number: bank_details.account_no,
                type: (bank_details.account_type as "savings" | "current" | "nre" | "nro") ?? "savings",
                ifsc_code: bank_details.ifsc_code,
            });
            if (fp_bank?.id) {
                fp_id = fp_bank.id;
                fp_old_id = fp_bank.old_id;
            }
        }

        // Single batch update for verified state
        await Promise.all([
            db.userBankDetails.update({
                where: { id: bank_details.id },
                data: {
                    verification_status: "VERIFIED",
                    verified_at: new Date(),
                    ...(fp_id ? { fp_bank_account_id: fp_id } : {}),
                    ...(fp_old_id !== undefined ? { fp_bank_account_old_id: fp_old_id } : {}),
                },
            }),
            db.userOnboarding.update({
                where: { user_id },
                data: {
                    penny_drop_status: "VERIFIED",
                    current_stage: "NOMINEE_ADDITION",
                },
            }),
        ]);

        await sync_investment_account(user_id);
        await user_onboarding_service.recompute_completion(user_id);

        return { status: "verified" };
    };

    /**
     * Public handler called by pan_verification.controller.ts and status polling
     */
    handle_bank_verification_result = async (
        user_id: string,
        bank_details_id: string,
        bank_account_result: any,
        kyc_profile: any
    ) => {
        if (!bank_account_result) return null;

        const status = bank_account_result.status;
        const code = bank_account_result.code;
        const reason = bank_account_result.reason;

        logger.info("Evaluating bank account verification outcome", { user_id, status, code, reason });

        const current_bank = await db.userBankDetails.findUnique({ where: { id: bank_details_id } });
        if (!current_bank) return null;

        if (status === "verified") {
            return await this.finalize_verified_bank(user_id, current_bank, kyc_profile);
        }

        if (status === "failed") {
            if (code === "uncertain" || code === "bank_account_proof_required") {
                if (current_bank.verification_method === "CYBRILLA_MANUAL_VERIFICATION") {
                    // Already in manual verification and Cybrilla finally failed it
                    logger.warn("Bank verification failed after manual review", { user_id, code, reason });
                    await Promise.all([
                        db.userBankDetails.update({ where: { id: bank_details_id }, data: { verification_status: "FAILED" } }),
                        db.userOnboarding.update({ where: { user_id }, data: { penny_drop_status: "FAILED" } }),
                    ]);
                    throw new AppError(
                        reason || "Manual bank verification could not verify your account. Please submit a different bank account.",
                        400,
                        "BANK_VERIFICATION_FAILED",
                        { code, reason, bank_details_id }
                    );
                }

                // First time uncertain: auto-submit manual verification
                return await this.trigger_manual_verification(user_id, current_bank, kyc_profile);
            }

            // Low confidence (name mismatch) or general failure
            await Promise.all([
                db.userBankDetails.update({ where: { id: bank_details_id }, data: { verification_status: "FAILED" } }),
                db.userOnboarding.update({ where: { user_id }, data: { penny_drop_status: "FAILED" } }),
            ]);

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

    /**
     * POST /api/v2/onboarding/penny-drop
     */
    submit_bank_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = penny_drop_schema.parse(req.body);

            logger.info("Saving penny drop bank details", { user_id });

            // 1. Single parallel read for preconditions
            const [onboarding, kyc_profile] = await Promise.all([
                db.userOnboarding.findUnique({ where: { user_id } }),
                db.kycProfile.findUnique({ where: { user_id } }),
            ]);

            if (onboarding?.profile_status !== "VERIFIED") {
                throw new AppError("Complete investor profile stage first", 400, "INVESTOR_PROFILE_REQUIRED");
            }
            if (!kyc_profile?.pan || !kyc_profile?.full_name || !kyc_profile?.dob) {
                throw new AppError("Complete PAN verification first", 400, "PAN_VERIFICATION_REQUIRED");
            }

            // 2. Persist bank details
            const bank_details = await user_bank_details_service.save_from_penny_drop(user_id, input);

            // 3. Trigger digital pre-verification
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

            // 4. One-shot poll to check immediate result
            let bank_result: any = null;
            if (pre_verification?.id) {
                try {
                    const fetched = await cybrilla_pan_verification_service.get_pre_verification(pre_verification.id);
                    if (fetched?.completed_at && Array.isArray(fetched.bank_accounts) && fetched.bank_accounts.length > 0) {
                        bank_result = fetched.bank_accounts[0];
                    }
                } catch (poll_err) {
                    logger.warn("Immediate pre-verification poll failed, leaving to polling", { user_id });
                }
            }

            // 5. Evaluate outcome with minimal DB operations
            let final_pre_verif_id = pre_verification?.id ?? null;
            let is_manual = false;
            let is_verified = false;

            if (bank_result?.status === "verified") {
                is_verified = true;
                await this.finalize_verified_bank(user_id, bank_details, kyc_profile);
            } else if (
                bank_result?.status === "failed" &&
                (bank_result.code === "uncertain" || bank_result.code === "bank_account_proof_required")
            ) {
                // Auto-submit manual verification immediately (TAT 24 hrs)
                is_manual = true;
                const manual_outcome = await this.trigger_manual_verification(
                    user_id,
                    bank_details,
                    kyc_profile as { pan: string; full_name: string; dob: string }
                );
                final_pre_verif_id = manual_outcome.pre_verification_id;
            } else if (bank_result?.status === "failed") {
                // Hard failure (low_confidence or bank_verification_failed)
                await Promise.all([
                    db.userBankDetails.update({ where: { id: bank_details.id }, data: { verification_status: "FAILED" } }),
                    db.userOnboarding.update({ where: { user_id }, data: { penny_drop_status: "FAILED" } }),
                ]);

                if (bank_result.code === "low_confidence") {
                    throw new AppError(
                        bank_result.reason || "The name on this bank account does not match your KYC/PAN details.",
                        400,
                        "BANK_NAME_MISMATCH"
                    );
                }
                throw new AppError(
                    bank_result.reason || "Bank account verification failed. Please check the account number and IFSC code.",
                    400,
                    "BANK_VERIFICATION_FAILED"
                );
            } else {
                // Still processing at Cybrilla
                await Promise.all([
                    db.userOnboarding.update({
                        where: { user_id },
                        data: { penny_drop_status: "IN_PROGRESS", current_stage: "PENNY_DROP_VERIFICATION" },
                    }),
                    final_pre_verif_id
                        ? db.kycProfile.update({
                            where: { user_id },
                            data: { cybrilla_pre_verification_id: final_pre_verif_id },
                        })
                        : Promise.resolve(),
                ]);
            }

            const summary = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: is_verified
                    ? "Bank details verified successfully"
                    : is_manual
                        ? "Bank details submitted. Verification is under review (Turnaround time: 24 hours)."
                        : "Bank details saved",
                data: {
                    bank_account_id: bank_details.id,
                    pre_verification_id: final_pre_verif_id,
                    is_processing_complete: is_verified,
                    verification_status: is_verified ? "VERIFIED" : "IN_PROGRESS",
                    is_manual_verification: is_manual,
                    tat: is_manual ? "24 hours" : null,
                    onboarding: summary,
                },
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
     */
    check_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Polling penny drop verification status", { user_id });

            // 1. Single parallel read for primary bank and kyc_profile
            const [primary_bank, kyc_profile] = await Promise.all([
                user_bank_details_service.get_primary(user_id),
                db.kycProfile.findUnique({
                    where: { user_id },
                    select: { cybrilla_pre_verification_id: true, pan: true, full_name: true, dob: true },
                }),
            ]);

            if (!primary_bank) {
                throw new AppError("No bank details found for user", 404, "BANK_DETAILS_NOT_FOUND");
            }
            if (!kyc_profile?.cybrilla_pre_verification_id) {
                throw new AppError("No bank verification request found - submit bank details first", 404, "PRE_VERIFICATION_NOT_FOUND");
            }

            // 2. Fetch Cybrilla pre-verification status
            const pre_verification = await cybrilla_pan_verification_service.get_pre_verification(
                kyc_profile.cybrilla_pre_verification_id
            );

            const is_processing_complete = !!pre_verification?.completed_at;
            const bank_accounts = pre_verification?.bank_accounts ?? null;
            let is_verified = primary_bank.verification_status === "VERIFIED";
            let is_manual = primary_bank.verification_method === "CYBRILLA_MANUAL_VERIFICATION";
            let current_pre_verif_id: string | null = kyc_profile.cybrilla_pre_verification_id;

            if (is_processing_complete && Array.isArray(bank_accounts) && bank_accounts.length > 0) {
                const bank_result = bank_accounts[0];

                if (bank_result.status === "verified") {
                    is_verified = true;
                    is_manual = false;
                    await this.finalize_verified_bank(user_id, primary_bank, kyc_profile as any);
                } else if (
                    bank_result.status === "failed" &&
                    (bank_result.code === "uncertain" || bank_result.code === "bank_account_proof_required") &&
                    !is_manual
                ) {
                    // First time uncertain: auto-submit manual verification
                    is_manual = true;
                    const manual_outcome = await this.trigger_manual_verification(
                        user_id,
                        primary_bank,
                        kyc_profile as { pan: string; full_name: string; dob: string }
                    );
                    current_pre_verif_id = manual_outcome.pre_verification_id;
                } else if (bank_result.status === "failed") {
                    await Promise.all([
                        db.userBankDetails.update({ where: { id: primary_bank.id }, data: { verification_status: "FAILED" } }),
                        db.userOnboarding.update({ where: { user_id }, data: { penny_drop_status: "FAILED" } }),
                    ]);
                }
            }

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: is_verified
                    ? "Bank details verified successfully"
                    : is_manual
                        ? "Bank verification is under review (Turnaround time: 24 hours)"
                        : "Bank verification status fetched",
                data: {
                    pre_verification_id: current_pre_verif_id,
                    status: pre_verification?.status,
                    is_processing_complete: is_verified,
                    verification_status: is_verified ? "VERIFIED" : is_manual ? "IN_PROGRESS" : primary_bank.verification_status,
                    is_manual_verification: is_manual,
                    tat: is_manual ? "24 hours" : null,
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
     */
    manual_verify = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Submitting manual bank verification (verify_manually_if_required: true)", { user_id });

            const [primary_bank, kyc_profile] = await Promise.all([
                user_bank_details_service.get_primary(user_id),
                db.kycProfile.findUnique({
                    where: { user_id },
                    select: { pan: true, full_name: true, dob: true },
                }),
            ]);

            if (!primary_bank) {
                throw new AppError("No bank details found - submit bank details first", 400, "BANK_DETAILS_NOT_FOUND");
            }
            if (!kyc_profile?.pan || !kyc_profile?.full_name || !kyc_profile?.dob) {
                throw new AppError("Complete PAN verification first", 400, "PAN_VERIFICATION_REQUIRED");
            }

            const outcome = await this.trigger_manual_verification(
                user_id,
                primary_bank,
                kyc_profile as { pan: string; full_name: string; dob: string }
            );

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "Bank details submitted for manual verification (Turnaround time: 24 hours)",
                data: {
                    bank_account_id: primary_bank.id,
                    pre_verification_id: outcome.pre_verification_id,
                    verification_status: "IN_PROGRESS",
                    is_manual_verification: true,
                    tat: "24 hours",
                    bank_accounts: outcome.bank_accounts,
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
