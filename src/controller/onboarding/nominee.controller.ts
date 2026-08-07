import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { nominee_stage_schema, update_nominee_schema } from "../../lib/zod-schemas/nominee.schema.js";
import { nominee_service } from "../../services/nominee.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";
import { fintech_primitive_related_party_service } from "../../services/fintech-primitive/related_party.service.js";
import { sync_investment_account } from "../../services/kyc/investment-account-sync.service.js";

/** Rebuilds the related_party create input from a flat Nominee DB row. */
const to_related_party_input = (nominee: any) => ({
    name: nominee.nominee_name,
    relationship: nominee.relationship,
    date_of_birth: nominee.dob,
    document_type: nominee.document_type,
    document_number: nominee.document_number,
    email_address: nominee.email_address,
    phone_number: { isd: nominee.phone_isd, number: nominee.phone_number },
    address: {
        line1: nominee.address_line1,
        line2: nominee.address_line2 ?? undefined,
        line3: nominee.address_line3 ?? undefined,
        city: nominee.address_city ?? undefined,
        state: nominee.address_state ?? undefined,
        postal_code: nominee.address_postal_code,
        country: nominee.address_country ?? "IN",
    },
});

class NomineeControllerClass {

    /**
     * POST - either { skip: true } or { skip: false, nominees: [...] }, per nominee_stage_schema.
     * Also covers "add nominees after having skipped" - sync_investment_account decides
     * create-vs-update based on whether User.investment_account already exists.
     */
    submit_nominees = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = nominee_stage_schema.parse(req.body);

            let nominees: any[] = [];

            if (input.skip === true) {
                logger.info("User skipped nominee stage", { user_id });
                await user_onboarding_service.update_stage(user_id, { nominee_status: "SKIPPED", current_stage: "COMPLETED" });
            } else {
                logger.info("Submitting nominees", { user_id, count: input.nominees.length });
                nominees = await nominee_service.create_many(user_id, input.nominees);

                const user = await user_service.get_user_by_id(user_id);
                if (!user?.investor_profile) {
                    throw new AppError("Complete the profile stage first", 400, "INVESTOR_PROFILE_REQUIRED");
                }

                for (const nominee of nominees) {
                    const related_party = await fintech_primitive_related_party_service.create_related_party(
                        user.investor_profile, to_related_party_input(nominee)
                    );
                    if (related_party?.id) {
                        await nominee_service.set_fp_related_party_id(nominee.id, related_party.id);
                    }
                }

                await user_onboarding_service.update_stage(user_id, { nominee_status: "VERIFIED", current_stage: "COMPLETED" });
            }

            // Create (first time) or update (e.g. adding nominees after a prior skip) the investment account either way
            await sync_investment_account(user_id);
            await user_onboarding_service.recompute_completion(user_id);

            res.status(200).json({
                success: true,
                message: input.skip ? "Nominee stage skipped" : "Nominees added",
                data: {
                    nominees,
                    onboarding: await user_onboarding_service.get_status_summary(user_id),
                }
            });
            return;
        } catch (error) {
            logger.error("Error in submit_nominees controller:", error);
            next(error);
            return;
        }
    }

    get_nominees = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Fetching nominees", { user_id });

            const nominees = await nominee_service.get_all(user_id);

            res.status(200).json({
                success: true,
                message: "Nominees fetched",
                data: { nominees }
            });
            return;
        } catch (error) {
            logger.error("Error in get_nominees controller:", error);
            next(error);
            return;
        }
    }

    /**
     * name/relationship/dob/document_type/document_number/email_address/phone_number/address
     * are all immutable on FP's related_party once set - if any of those change on an
     * already-synced nominee, register a fresh related_party and swap the id rather than
     * trying to patch the old one. percentage_allocation changes don't need a new
     * related_party, just a folio_defaults resync.
     */
    update_nominee = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const nominee_id = req.params.id as string;
            const patch = update_nominee_schema.parse(req.body);

            logger.info("Updating nominee", { user_id, nominee_id });

            const nominee = await nominee_service.update(user_id, nominee_id, patch);

            const identity_changed = [
                patch.nominee_name, patch.relationship, patch.dob, patch.document_type, patch.document_number,
                patch.email_address, patch.phone_number, patch.address,
            ].some((v) => v !== undefined);

            if (identity_changed && nominee.fp_related_party_id) {
                const user = await user_service.get_user_by_id(user_id);
                if (user?.investor_profile) {
                    const related_party = await fintech_primitive_related_party_service.create_related_party(
                        user.investor_profile, to_related_party_input(nominee)
                    );
                    if (related_party?.id) {
                        await nominee_service.set_fp_related_party_id(nominee_id, related_party.id);
                    }
                }
            }

            await sync_investment_account(user_id);

            res.status(200).json({
                success: true,
                message: "Nominee updated",
                data: { nominee }
            });
            return;
        } catch (error) {
            logger.error("Error in update_nominee controller:", error);
            next(error);
            return;
        }
    }

    delete_nominee = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const nominee_id = req.params.id as string;

            logger.info("Deleting nominee", { user_id, nominee_id });

            await nominee_service.delete(user_id, nominee_id);
            await sync_investment_account(user_id);

            res.status(200).json({
                success: true,
                message: "Nominee deleted",
                data: null
            });
            return;
        } catch (error) {
            logger.error("Error in delete_nominee controller:", error);
            next(error);
            return;
        }
    }
}

export const nominee_controller = new NomineeControllerClass();
