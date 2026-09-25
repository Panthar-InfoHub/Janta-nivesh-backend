import { NextFunction, Request, Response } from "express";
import logger from "../../middleware/logger.js";
import { reverse_penny_service } from "../../services/kyc/reverse_penny.service.js";
import {
    reverse_penny_initiate_input_schema,
    reverse_penny_status_input_schema,
} from "../../lib/zod-schemas/reverse-penny.schema.js";

class ReversePennyControllerClass {

    /**
     * POST /api/v2/onboarding/reverse-penny/initiate
     * Initiates reverse penny intent via Decentro central server,
     * stores it in DB, and sets onboarding to IN_PROGRESS.
     */
    initiate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = reverse_penny_initiate_input_schema.parse(req.body ?? {});

            logger.info("Reverse penny initiation requested", { user_id, input });

            const result = await reverse_penny_service.initiate(user_id, input);

            res.status(200).json({
                success: true,
                message: result.message || "Validation Link created Successfully.",
                data: result,
            });
            return;
        } catch (error) {
            logger.error("Error in reverse_penny initiate controller:", error);
            next(error);
            return;
        }
    };

    /**
     * POST /api/v2/onboarding/reverse-penny/status
     * Checks Decentro transaction status via central server (or uses passed decentro_txn_id),
     * stores it in DB (reference_id, bank_reference_number, error_key, payer details),
     * auto pre-fills UserBankDetails upon SUCCESS, and advances user onboarding stage.
     */
    check_status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const decentro_txn_id =
                (req.query.decentro_txn_id as string) ||
                (req.query.txnId as string) ||
                (req.params.txnId as string) ||
                (req.body?.decentro_txn_id as string);
            const reference_id =
                (req.query.reference_id as string) ||
                (req.body?.reference_id as string);

            logger.info("Reverse penny status check requested", { user_id, decentro_txn_id, reference_id });

            const result = await reverse_penny_service.check_status(user_id, {
                decentro_txn_id,
                reference_id,
            });

            res.status(200).json({
                success: true,
                message: result.status_description || "Transaction status processed successfully",
                data: result.data,
                onboarding: result.onboarding,
            });
            return;
        } catch (error) {
            logger.error("Error in reverse_penny check_status controller:", error);
            next(error);
            return;
        }
    };

    /**
     * GET /api/v2/onboarding/reverse-penny/prefill
     * Returns pre-filled bank details captured from Reverse Penny.
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
            logger.error("Error in reverse_penny get_prefill controller:", error);
            next(error);
            return;
        }
    };
}

export const reverse_penny_controller = new ReversePennyControllerClass();
