import { db } from "../../server.js";
import logger from "../../middleware/logger.js";
import { user_service } from "../user.service.js";
import { kyc_profile_service } from "./kyc-profile.service.js";
import { user_bank_details_service } from "../user-bank-details.service.js";
import { fintech_primitive_investor_profile_service } from "../fintech-primitive/investor_profile.service.js";

/**
 * Builds folio_defaults from whatever's registered so far (address/phone/email/bank account/
 * nominees) and creates the FP investment account if it doesn't exist yet, or PATCHes it if it
 * does - so this is safe to call repeatedly (nominee add, skip, later edit/delete after skip).
 * No-ops quietly if investor_profile doesn't exist yet (Profile stage not done).
 */
export const sync_investment_account = async (user_id: string) => {
    const user = await user_service.get_user_by_id(user_id);
    if (!user?.investor_profile) {
        logger.warn("Skipping investment account sync - investor_profile not set up yet", { user_id });
        return null;
    }

    const [kyc_profile, primary_bank, nominees] = await Promise.all([
        kyc_profile_service.get_by_user_id(user_id),
        user_bank_details_service.get_primary(user_id),
        db.nominee.findMany({ where: { user_id }, orderBy: { createdAt: "asc" } }),
    ]);

    const folio_defaults: Record<string, any> = {};
    if (kyc_profile?.fp_email_id) folio_defaults.communication_email_address = kyc_profile.fp_email_id;
    if (kyc_profile?.fp_phone_id) folio_defaults.communication_mobile_number = kyc_profile.fp_phone_id;
    if (kyc_profile?.fp_address_id) folio_defaults.communication_address = kyc_profile.fp_address_id;
    if (primary_bank?.fp_bank_account_id) folio_defaults.payout_bank_account = primary_bank.fp_bank_account_id;

    // Only nominees already synced to FP (have fp_related_party_id) can go into folio_defaults - max 3
    const synced_nominees = nominees.filter((n) => n.fp_related_party_id).slice(0, 3);
    synced_nominees.forEach((n, i) => {
        folio_defaults[`nominee${i + 1}`] = n.fp_related_party_id;
        folio_defaults[`nominee${i + 1}_allocation_percentage`] = Number(n.percentage_allocation);
        // No separate "proof number" field - this just tells FP which field on the related_party
        // to read as the proof (the number itself is already on that related_party record,
        // under whichever type-specific field document_type maps to)
        folio_defaults[`nominee${i + 1}_identity_proof_type`] = n.document_type;
    });

    // FP requires nominations_info_visibility unconditionally - no skip_nomination field
    // needed (deprecated), confirmed against a working payload.
    folio_defaults.nominations_info_visibility = "show_nomination_status";

    if (!user.investment_account) {
        logger.debug("Creating investment account", { user_id, folio_defaults_keys: Object.keys(folio_defaults) });
        const investment_account = await fintech_primitive_investor_profile_service.create_investment_account(
            user.investor_profile, folio_defaults
        );

        if (investment_account?.id) {
            await user_service.update_user(user_id, {
                investment_account: investment_account.id,
                investment_account_old_id: investment_account.old_id ?? null,
            });
        }
        return investment_account;
    }

    logger.debug("Updating investment account folio_defaults", { user_id, folio_defaults_keys: Object.keys(folio_defaults) });
    const updated_account = await fintech_primitive_investor_profile_service.update_investment_account(
        user.investment_account, user.investor_profile, folio_defaults
    );

    // Backfill path: accounts created before investment_account_old_id existed only pick it up
    // once this PATCH runs for them again (nominee edit, etc.) - this is a normal call this
    // function already made every time, not a new one, so nothing extra is triggered by adding it.
    if (updated_account?.old_id && updated_account.old_id !== user.investment_account_old_id) {
        await user_service.update_user(user_id, { investment_account_old_id: updated_account.old_id });
    }

    return updated_account;
}
