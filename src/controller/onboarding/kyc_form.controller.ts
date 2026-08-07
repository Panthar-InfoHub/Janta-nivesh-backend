import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { kyc_form_update_schema } from "../../lib/zod-schemas/kyc-onboarding.schema.js";
import { cybrilla_kyc_form_service } from "../../services/cybrilla/kyc_form.service.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";

// readiness.code -> kyc_form type, decided in stage 1 (see pan_verification.controller.ts)
const MODIFY_READINESS_CODES = ["kyc_incomplete", "kyc_onhold", "kyc_legacy"];
const TERMINAL_STATUSES = ["failed", "expired"];

class KycFormControllerClass {

    /**
     * Get-or-create guard: resumes an in-progress kyc_form if one exists (Cybrilla rejects
     * creating a second one for the same PAN), otherwise creates fresh using pan/name/dob
     * already stored from stage 1 - no frontend input needed.
     */
    initiate_kyc_form = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("KYC form initiation requested", { user_id });

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.pan || !kyc_profile?.full_name || !kyc_profile?.dob) {
                throw new AppError("Complete PAN verification first", 400, "PAN_VERIFICATION_REQUIRED");
            }

            let kyc_form: any;

            if (kyc_profile.cybrilla_kyc_form_id && !TERMINAL_STATUSES.includes(kyc_profile.cybrilla_status ?? "")) {
                logger.debug("Resuming existing Cybrilla kyc_form", { kyc_form_id: kyc_profile.cybrilla_kyc_form_id });
                kyc_form = await cybrilla_kyc_form_service.get_kyc_form(kyc_profile.cybrilla_kyc_form_id);
            } else {
                const readiness_code = (kyc_profile.pre_verification_response as any)?.readiness?.code;
                const type = MODIFY_READINESS_CODES.includes(readiness_code) ? "modify" : "fresh";

                logger.debug("Creating fresh Cybrilla kyc_form", { user_id, type, readiness_code });
                kyc_form = await cybrilla_kyc_form_service.create_kyc_form({
                    type,
                    pan: kyc_profile.pan,
                    name: kyc_profile.full_name,
                    date_of_birth: kyc_profile.dob,
                });
            }

            const [_kyc_profile_res, _user_onboard_res] = await Promise.all([
                kyc_profile_service.upsert_kyc_form(user_id, kyc_form),
                user_onboarding_service.update_stage(user_id, {
                    kyc_status: "IN_PROGRESS",
                    current_stage: "KYC_VERIFICATION",
                })
            ])

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "KYC form ready",
                data: {
                    kyc_form_id: kyc_form?.id,
                    status: kyc_form?.status,
                    type: kyc_form?.type,
                    proof_fetch_url: kyc_form?.proof_details?.fetch_url ?? null,
                    fields_needed: kyc_form?.requirements?.fields_needed ?? [],
                    onboarding,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in initiate_kyc_form controller:", error);
            next(error);
            return;
        }
    }

    /**
     * Single source of truth for "what's the current state" - call this after every action
     * (DigiLocker return, signature upload, patch, esign return) to know what's still needed.
     */
    check_kyc_form_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Polling KYC form status", { user_id });

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.cybrilla_kyc_form_id) {
                throw new AppError("No KYC form found - initiate one first", 404, "KYC_FORM_NOT_FOUND");
            }

            const kyc_form = await cybrilla_kyc_form_service.get_kyc_form(kyc_profile.cybrilla_kyc_form_id);
            await kyc_profile_service.upsert_kyc_form(user_id, kyc_form);

            if (kyc_form?.status === "submitted") {
                await user_onboarding_service.update_stage(user_id, {
                    kyc_status: "VERIFIED",
                    current_stage: "PENNY_DROP_VERIFICATION",
                });
            } else if (kyc_form?.status === "failed" || kyc_form?.status === "expired") {
                await user_onboarding_service.update_stage(user_id, { kyc_status: "FAILED" });
            }

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "KYC form status fetched",
                data: {
                    kyc_form_id: kyc_form?.id,
                    status: kyc_form?.status,
                    reason: kyc_form?.reason ?? null,
                    fields_needed: kyc_form?.requirements?.fields_needed ?? [],
                    proof_details: kyc_form?.proof_details ?? null,
                    identity_proof_type: kyc_form?.identity?.proof_type ?? null,
                    address_proof_type: kyc_form?.address?.proof_type ?? null,
                    signature_provided: kyc_form?.signature_provided ?? false,
                    esign_details: kyc_form?.esign_details ?? null,
                    onboarding,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in check_kyc_form_status controller:", error);
            next(error);
            return;
        }
    }

    /** PATCH the demographic/declaration fields - independent of the DigiLocker proof track. */
    update_kyc_form_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const patch: Record<string, any> = kyc_form_update_schema.parse(req.body);

            const user = await user_service.get_user_by_id(user_id);
            if (!user?.phone_no) {
                throw new AppError("User has no verified phone number on file", 400, "USER_PHONE_MISSING");
            }
            // Always the OTP-verified number - never trust client input for this
            patch.phone_number = { isd: "+91", number: user.phone_no };

            logger.info("Updating KYC form details", { user_id, fields: Object.keys(patch) });

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.cybrilla_kyc_form_id) {
                throw new AppError("No KYC form found - initiate one first", 404, "KYC_FORM_NOT_FOUND");
            }

            const kyc_form = await cybrilla_kyc_form_service.update_kyc_form(kyc_profile.cybrilla_kyc_form_id, patch);
            await kyc_profile_service.upsert_kyc_form(user_id, kyc_form);

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "KYC form details updated",
                data: {
                    kyc_form_id: kyc_form?.id,
                    status: kyc_form?.status,
                    fields_needed: kyc_form?.requirements?.fields_needed ?? [],
                    onboarding,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in update_kyc_form_details controller:", error);
            next(error);
            return;
        }
    }

    /** Retry the DigiLocker proof fetch if proof_details.status === "failed". */
    retry_proof_fetch = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Retrying KYC form proof details fetch", { user_id });

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.cybrilla_kyc_form_id) {
                throw new AppError("No KYC form found - initiate one first", 404, "KYC_FORM_NOT_FOUND");
            }

            const kyc_form = await cybrilla_kyc_form_service.retry_proof_details_fetch(kyc_profile.cybrilla_kyc_form_id);
            await kyc_profile_service.upsert_kyc_form(user_id, kyc_form);

            res.status(200).json({
                success: true,
                message: "Proof details fetch retried",
                data: {
                    kyc_form_id: kyc_form?.id,
                    proof_fetch_url: kyc_form?.proof_details?.fetch_url ?? null,
                    proof_status: kyc_form?.proof_details?.status ?? null,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in retry_proof_fetch controller:", error);
            next(error);
            return;
        }
    }

    /** Multipart signature upload - req.file populated by multer memoryStorage upstream. */
    upload_signature = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Uploading KYC form signature", { user_id });

            const file = (req as any).file;
            if (!file) {
                throw new AppError("Signature file is required", 400, "SIGNATURE_FILE_REQUIRED");
            }

            const kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
            if (!kyc_profile?.cybrilla_kyc_form_id) {
                throw new AppError("No KYC form found - initiate one first", 404, "KYC_FORM_NOT_FOUND");
            }

            const kyc_form = await cybrilla_kyc_form_service.upload_signature(
                kyc_profile.cybrilla_kyc_form_id,
                file.buffer,
                file.originalname,
                file.mimetype
            );
            await kyc_profile_service.upsert_kyc_form(user_id, kyc_form);

            res.status(200).json({
                success: true,
                message: "Signature uploaded",
                data: {
                    kyc_form_id: kyc_form?.id,
                    signature_provided: kyc_form?.signature_provided ?? false,
                    fields_needed: kyc_form?.requirements?.fields_needed ?? [],
                }
            });
            return;
        } catch (error) {
            logger.error("Error in upload_signature controller:", error);
            next(error);
            return;
        }
    }
}

export const kyc_form_controller = new KycFormControllerClass();
