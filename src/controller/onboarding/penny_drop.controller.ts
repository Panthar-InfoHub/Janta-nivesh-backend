import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { penny_drop_schema } from "../../lib/zod-schemas/penny-drop.schema.js";
import { user_bank_details_service } from "../../services/user-bank-details.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { cybrilla_pan_verification_service } from "../../services/cybrilla/pan_verification.service.js";

class PennyDropControllerClass {

    submit_bank_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = penny_drop_schema.parse(req.body);

            logger.info("Saving penny drop bank details", { user_id });

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

            // i know this is a shitty approach three db call for one this just bear with me for the compliance phase
            await user_onboarding_service.update_stage(user_id, {
                penny_drop_status: "IN_PROGRESS",
                current_stage: "EMAIL_VERIFICATION",
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
                        await user_bank_details_service.sync_verification_from_pre_verification(bank_details.id, bank_accounts[0]);

                        if (bank_accounts[0]?.status === "verified") {
                            await user_onboarding_service.update_stage(user_id, { penny_drop_status: "VERIFIED" });
                        } else if (bank_accounts[0]?.status === "failed") {
                            await user_onboarding_service.update_stage(user_id, { penny_drop_status: "FAILED" });
                        }
                    }
                } catch (poll_error) {
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
    }
}

export const penny_drop_controller = new PennyDropControllerClass();
