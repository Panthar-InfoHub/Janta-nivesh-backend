import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { create_mandate_schema } from "../lib/zod-schemas/mandate.schema.js";
import { fintech_primitive_mandate_service } from "../services/fintech-primitive/mandate.service.js";
import { mandate_service } from "../services/mandate.service.js";
import { user_bank_details_service } from "../services/user-bank-details.service.js";

class MandateControllerClass {

    /** Create then authorize in one call - returns the token_url for the frontend to open in a webview. */
    create_and_authorize_mandate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = create_mandate_schema.parse(req.body);

            const primary_bank = await user_bank_details_service.get_primary(user_id);
            if (!primary_bank?.fp_bank_account_old_id) {
                throw new AppError(
                    "Bank account not registered with the provider yet - complete penny drop and the profile stage first",
                    400,
                    "FP_BANK_ACCOUNT_MISSING"
                );
            }

            logger.info("Creating mandate", { user_id, bank_account_id: primary_bank.fp_bank_account_old_id, mandate_limit: input.mandate_limit });

            const created = await fintech_primitive_mandate_service.create_mandate({
                bank_account_id: primary_bank.fp_bank_account_old_id,
                mandate_limit: input.mandate_limit,
                valid_from: input.valid_from,
                valid_to: input.valid_to,
            });

            if (!created?.id) {
                logger.error("FP mandate create response missing id ==> ", created);
                throw new AppError("Failed to create mandate", 502, "MANDATE_CREATE_FAILED");
            }

            const mandate = await mandate_service.create(user_id, {
                mandate_id: String(created.id),
                amount: input.mandate_limit,
                fp_bank_account_id: String(primary_bank.fp_bank_account_old_id),
                start_date: input.valid_from ? new Date(input.valid_from) : null,
                end_date: input.valid_to ? new Date(input.valid_to) : null,
            });

            logger.info("Authorizing mandate", { user_id, mandate_id: created.id });

            const authorized = await fintech_primitive_mandate_service.authorize_mandate(created.id, input.payment_postback_url);

            if (!authorized?.token_url) {
                logger.error("FP mandate authorize response missing token_url ==> ", authorized);
                throw new AppError("Failed to authorize mandate", 502, "MANDATE_AUTHORIZE_FAILED");
            }

            await mandate_service.update(mandate.id, { fp_payment_id: authorized.id ? String(authorized.id) : null });

            res.status(200).json({
                success: true,
                message: "Mandate created and authorization initiated",
                data: {
                    mandate_id: created.id,
                    token_url: authorized.token_url,
                    status: "PENDING", // final SUCCESS/FAILED only lands via the async authorization webhook
                }
            });
            return;
        } catch (error) {
            logger.error("Error in create_and_authorize_mandate controller:", error);
            next(error);
            return;
        }
    }

    get_mandates = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const mandates = await mandate_service.get_all(user_id);

            res.status(200).json({
                success: true,
                message: "Mandates fetched",
                data: { mandates }
            });
            return;
        } catch (error) {
            logger.error("Error in get_mandates controller:", error);
            next(error);
            return;
        }
    }

    /**
     * Polls FP for the mandate's current state and syncs our row. Stand-in for the webhook
     * until that's registered - same outcome, just pull instead of push.
     */
    fetch_mandate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const mandate_id = req.params.mandate_id as string;

            logger.info("Fetching mandate status", { user_id, mandate_id });

            const mandate = await mandate_service.get_by_mandate_id(user_id, mandate_id);
            if (!mandate) {
                throw new AppError("Mandate not found", 404, "MANDATE_NOT_FOUND");
            }

            const fp_mandate = await fintech_primitive_mandate_service.get_mandate(mandate_id);
            const updated = await mandate_service.sync_from_fp(mandate.id, fp_mandate);

            res.status(200).json({
                success: true,
                message: "Mandate status fetched",
                data: {
                    mandate_id,
                    status: updated.status,
                    mandate_status: fp_mandate?.mandate_status ?? null,
                    umrn: fp_mandate?.umrn ?? null,
                    mandate_token: fp_mandate?.mandate_token ?? null,
                    approved_at: fp_mandate?.approved_at ?? null,
                    rejected_reason: fp_mandate?.rejected_reason ?? null,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in fetch_mandate controller:", error);
            next(error);
            return;
        }
    }
}

export const mandate_controller = new MandateControllerClass();
