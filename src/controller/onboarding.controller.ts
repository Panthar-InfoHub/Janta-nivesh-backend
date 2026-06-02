import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { complete_onboarding_zod_schema } from "../lib/zod-schemas/onboarding.schema.js";
import { onboarding_service } from "../services/onboarding.service.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";
import { zoho_webhook_service } from "../services/zoho.webhook.service.js";
import { user_service } from "../services/user.service.js";

class OnBoardingControllerClass {

    private formatDOB = (date?: Date): string | undefined => {
        if (!date) return undefined;

        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        const day = String(date.getDate()).padStart(2, "0");
        const month = months[date.getMonth()];
        const year = date.getFullYear();

        return `${day}-${month}-${year}`;
    };

    complete_onboarding = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.id) {
                throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
            }

            const validation_result = complete_onboarding_zod_schema.safeParse(req.body);
            if (!validation_result.success) {
                logger.error("Validation failed for complete_onboarding ==> ", validation_result.error);
                throw new AppError("Validation failed", 400, "VALIDATION_ERROR");
            }

            const [result, finnsys_res] = await Promise.all([
                onboarding_service.complete_onboarding(user, validation_result.data),
                user_finnsys_service.update_user_finnsys_details(user.log!, user.pwd!, {
                    invname: validation_result.data.profile?.full_name,
                    invemail: validation_result.data.profile?.email,
                    invdob: this.formatDOB(validation_result.data.profile?.dob),
                })
            ])

            if (finnsys_res.code !== 1) {
                logger.error(`Failed to update user finnsys details for user_id: ${user.id}, response ==> `, finnsys_res);
                throw new AppError("Failed to update user finnsys details", 500, "FINNSYS_UPDATE_FAILED");
            }
            const db_user = await user_service.get_user_by_id(user.id);
            logger.info(`User Finnsys details updated successfully for user_id: ${user.id}`);
            logger.info(`Onboarding completed for user: ${user.id}`);

            await zoho_webhook_service.send_event({
                event_type: "FINANCIAL_ONBOARDING_COMPLETED",
                timestamp: new Date().toISOString(),
                user_id: user.id,
                user_phone: db_user?.phone_no,
                full_name: validation_result.data.profile?.full_name,
                email: validation_result.data.profile?.email,
                dob: validation_result.data.profile?.dob ? validation_result.data.profile.dob.toISOString() : undefined
            });

            res.status(200).json({
                success: true,
                message: "Onboarding completed successfully",
                data: result,
            });
            return;

        } catch (error) {
            logger.error("Error in complete_onboarding:", error);
            next(error);
            return;
        }
    }
}

export const onboarding_controller = new OnBoardingControllerClass();