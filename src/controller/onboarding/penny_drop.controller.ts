import { NextFunction, Request, Response } from "express";
import logger from "../../middleware/logger.js";
import { penny_drop_schema } from "../../lib/zod-schemas/penny-drop.schema.js";
import { user_bank_details_service } from "../../services/user-bank-details.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";

class PennyDropControllerClass {

    submit_bank_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = penny_drop_schema.parse(req.body);

            logger.info("Saving penny drop bank details", { user_id });

            const bank_details = await user_bank_details_service.save_from_penny_drop(user_id, input);

            await user_onboarding_service.update_stage(user_id, {
                penny_drop_status: "VERIFIED",
                current_stage: "INVESTOR_PROFILE",
            });
            await user_onboarding_service.recompute_completion(user_id);

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "Bank details saved",
                data: {
                    bank_account_id: bank_details.id,
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
