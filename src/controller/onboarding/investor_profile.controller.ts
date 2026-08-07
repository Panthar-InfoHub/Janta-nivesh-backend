import { NextFunction, Request, Response } from "express";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { profile_stage_schema } from "../../lib/zod-schemas/kyc-onboarding.schema.js";
import { fintech_primitive_investor_profile_service } from "../../services/fintech-primitive/investor_profile.service.js";
import { fintech_primitive_address_service } from "../../services/fintech-primitive/address.service.js";
import { fintech_primitive_phone_number_service } from "../../services/fintech-primitive/phone_number.service.js";
import { fintech_primitive_email_address_service } from "../../services/fintech-primitive/email_address.service.js";
import { fintech_primitive_bank_account_service } from "../../services/fintech-primitive/bank_account.service.js";
import { cybrilla_kyc_form_service } from "../../services/cybrilla/kyc_form.service.js";
import { kyc_profile_service } from "../../services/kyc/kyc-profile.service.js";
import { user_onboarding_service } from "../../services/kyc/user.onboarding.service.js";
import { user_service } from "../../services/user.service.js";
import { user_bank_details_service } from "../../services/user-bank-details.service.js";
import { build_kyc_form_patch_payload, map_pep_details_for_investor_profile } from "../../services/kyc/onboarding-field-mapper.js";

const TERMINAL_KYC_STATUSES = ["failed", "expired", "submitted"];

class InvestorProfileControllerClass {

    /**
     * Profile stage ("Review Profile" screen):
     * 1. Save email + create the Fintech Primitives investor_profile (id -> User.investor_profile).
     * 2. Register address/phone/email as FP objects, and the penny-drop bank account (if saved)
     *    as an FP bank_account object - all required to build folio_defaults later. Investment
     *    account creation itself moved to the Nominee stage (needs related_party ids too).
     * 3. If the user has a kyc_form still in progress, fetch its current fields_needed and
     *    patch whatever this screen's data can now satisfy - keeps KYC moving forward without
     *    a separate step, per the flow we settled on.
     */
    complete_profile_stage = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const input = profile_stage_schema.parse(req.body);

            logger.info("Completing profile stage", { user_id });

            const kyc_profile = await kyc_profile_service.upsert_profile_stage(user_id, input);

            if (!kyc_profile.pan) {
                throw new AppError("Complete PAN verification first", 400, "PAN_VERIFICATION_REQUIRED");
            }

            // 1. Create the investor profile (Fintech Primitives)
            const ip_address = req.ip || req.socket.remoteAddress || undefined;

            const investor_profile = await fintech_primitive_investor_profile_service.create_investor_profile({
                name: kyc_profile.full_name!,
                date_of_birth: kyc_profile.dob!,
                gender: kyc_profile.gender!,
                occupation: kyc_profile.occupation!,
                pan: kyc_profile.pan,
                place_of_birth: kyc_profile.place_of_birth,
                use_default_tax_residences: kyc_profile.use_default_tax_residences,
                first_tax_residency: kyc_profile.first_tax_residency,
                source_of_wealth: kyc_profile.source_of_fund!,
                income_slab: kyc_profile.income_slab!,
                pep_details: map_pep_details_for_investor_profile(kyc_profile.is_pep_declaration_confirmed),
                ip_address,
            });

            if (!investor_profile?.id) {
                logger.error("Fintech Primitives investor_profile response missing id ==> ", investor_profile);
                throw new AppError("Failed to create investor profile", 502, "INVESTOR_PROFILE_CREATE_FAILED");
            }

            const user = await user_service.update_user(user_id, { investor_profile: investor_profile.id, email: input.email });

            // 2. Register address/phone/email as FP objects - all mandatory-for-folio_defaults,
            // and all require `profile` (investor_profile.id), so this is the earliest point they can exist.
            const address = await fintech_primitive_address_service.create_address(investor_profile.id, {
                line1: kyc_profile.address!,
                postal_code: kyc_profile.pincode!,
                city: kyc_profile.city!,
                country: "IN",
                nature: "residential",
            });

            const phone = await fintech_primitive_phone_number_service.create_phone_number(
                investor_profile.id, "91", user.phone_no!, "self"
            );

            const email = await fintech_primitive_email_address_service.create_email_address(
                investor_profile.id, input.email, "self"
            );

            await kyc_profile_service.upsert(user_id, {
                fp_address_id: address?.id ?? null,
                fp_phone_id: phone?.id ?? null,
                fp_email_id: email?.id ?? null,
            });

            // 2b. If penny drop already saved a bank account, register it with FP too (needs
            // `profile`, so couldn't happen at penny-drop time - investor_profile didn't exist yet)
            const primary_bank = await user_bank_details_service.get_primary(user_id);
            if (primary_bank && !primary_bank.fp_bank_account_id) {
                const bank_account = await fintech_primitive_bank_account_service.create_bank_account(investor_profile.id, {
                    primary_account_holder_name: primary_bank.account_holder_name ?? kyc_profile.full_name!,
                    account_number: primary_bank.account_no,
                    type: (primary_bank.account_type as "savings" | "current" | "nre" | "nro") ?? "savings",
                    ifsc_code: primary_bank.ifsc_code,
                });

                if (bank_account?.id) {
                    await user_bank_details_service.set_fp_bank_account_ids(primary_bank.id, bank_account.id, bank_account.old_id);
                }
            }

            // 3. If a kyc_form is still in progress, patch whatever we can now satisfy
            let kyc_form_patch_result: any = null;

            if (kyc_profile.cybrilla_kyc_form_id && !TERMINAL_KYC_STATUSES.includes(kyc_profile.cybrilla_status ?? "")) {
                // const user = await user_service.get_user_by_id(user_id);
                const latest_kyc_form = await cybrilla_kyc_form_service.get_kyc_form(kyc_profile.cybrilla_kyc_form_id);
                const fields_needed: string[] = latest_kyc_form?.requirements?.fields_needed ?? [];

                if (fields_needed.length > 0) {
                    // const refreshed_kyc_profile = await kyc_profile_service.get_by_user_id(user_id);
                    const patch_payload = build_kyc_form_patch_payload(fields_needed, {
                        user: { email: user?.email, phone_no: user?.phone_no },
                        kyc_profile: kyc_profile!,
                    });

                    if (Object.keys(patch_payload).length > 0) {
                        logger.debug("Patching in-progress kyc_form from profile stage data", { fields: Object.keys(patch_payload) });
                        kyc_form_patch_result = await cybrilla_kyc_form_service.update_kyc_form(kyc_profile.cybrilla_kyc_form_id, patch_payload);
                        await kyc_profile_service.upsert_kyc_form(user_id, kyc_form_patch_result);
                    }
                } else {
                    kyc_form_patch_result = latest_kyc_form;
                }
            }

            await user_onboarding_service.update_stage(user_id, {
                profile_status: "VERIFIED",
                current_stage: "NOMINEE_ADDITION",
            });

            const onboarding = await user_onboarding_service.get_status_summary(user_id);

            res.status(200).json({
                success: true,
                message: "Profile stage completed",
                data: {
                    investor_profile_id: investor_profile.id,
                    kyc_form: kyc_form_patch_result ? {
                        status: kyc_form_patch_result.status,
                        fields_needed: kyc_form_patch_result.requirements?.fields_needed ?? [],
                        esign_url: kyc_form_patch_result.esign_details?.esign_url ?? null,
                    } : null,
                    onboarding,
                }
            });
            return;
        } catch (error) {
            logger.error("Error in complete_profile_stage controller:", error);
            next(error);
            return;
        }
    }
}

export const investor_profile_controller = new InvestorProfileControllerClass();
