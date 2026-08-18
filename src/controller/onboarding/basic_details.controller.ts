import { NextFunction, Request, Response } from "express";
import logger from "../../middleware/logger.js";
import { basic_details_schema } from "../../lib/zod-schemas/kyc-onboarding.schema.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";

class BasicDetailsControllerClass {

    /**
     * First onboarding stage - name + DOB. Mandatory, no skip: deferring the flow happens at the
     * PAN stage instead (see pan_verification.controller.ts).
     *
     * Saves to both KycProfile (source of truth for the rest of onboarding) and User - nothing in
     * this pipeline wrote User.full_name/dob before now, which also means email_verification's
     * greeting stops being permanently blank for anyone who reaches that stage afterward.
     */
    submit_basic_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = basic_details_schema.parse(req.body);

            logger.info("Saving basic details", { user_id });

            await Promise.all([
                kyc_profile_service.upsert(user_id, {
                    full_name: input.full_name,
                    dob: input.date_of_birth,
                }),
                user_service.update_user(user_id, {
                    full_name: input.full_name,
                    dob: input.date_of_birth,
                }),
                user_onboarding_service.update_stage(user_id, {
                    basic_details_status: "VERIFIED",
                    current_stage: "PAN_VERIFICATION",
                }),
            ]);

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "Basic details saved",
                data: { onboarding }
            });
            return;
        } catch (error) {
            logger.error("Error in submit_basic_details controller:", error);
            next(error);
            return;
        }
    }
}

export const basic_details_controller = new BasicDetailsControllerClass();
