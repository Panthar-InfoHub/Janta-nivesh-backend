import { db } from "../server.js";
import logger from "../middleware/logger.js";
import type { PennyDropInput } from "../lib/zod-schemas/penny-drop.schema.js";

class UserBankDetailsServiceClass {

    get_primary = async (user_id: string) => {
        const primary = await db.userBankDetails.findFirst({ where: { user_id, is_primary: true } });
        if (primary) return primary;
        return await db.userBankDetails.findFirst({ where: { user_id } });
    }

    /**
     * Penny drop save - upserts by (user_id, account_no) same pattern as v1's
     * mfkyc_identity_service.upsert_bank_details: pass the plain account_no in the
     * account_no_hash slot of the unique-index where clause, the Prisma extension rewrites
     * it to the actual blind-index hash before hitting the DB.
     * verification_status is IN_PROGRESS, not VERIFIED - the frontend's own UPI flow isn't a
     * real verification on our side, Cybrilla's pre_verifications bank_accounts check (fired
     * right after this) is the actual authority. See sync_verification_from_pre_verification.
     */
    save_from_penny_drop = async (user_id: string, input: PennyDropInput) => {
        logger.debug("Persisting penny drop bank details", { user_id });

        return await db.userBankDetails.upsert({
            where: {
                user_account_no_idx: {
                    user_id,
                    account_no_hash: input.account_number
                }
            },
            create: {
                user_id,
                account_no: input.account_number,
                ifsc_code: input.ifsc_code,
                bank_name: input.bank_name,
                account_holder_name: input.account_holder_name,
                account_type: input.account_type,
                is_primary: true,
                verification_status: "IN_PROGRESS",
                verification_method: "CYBRILLA_PRE_VERIFICATION",
            },
            update: {
                ifsc_code: input.ifsc_code,
                bank_name: input.bank_name,
                account_holder_name: input.account_holder_name,
                account_type: input.account_type,
                is_primary: true,
                verification_status: "IN_PROGRESS",
                verification_method: "CYBRILLA_PRE_VERIFICATION",
            }
        });
    }

    /**
     * Reverse penny save - upserts bank details fetched via Decentro UPI ₹1 verification
     * so that the subsequent Penny Drop stage has accurate pre-filled data.
     */
    save_from_reverse_penny = async (
        user_id: string,
        input: {
            account_number: string;
            ifsc_code: string;
            account_holder_name?: string | null;
            account_type?: string | null;
            bank_name?: string | null;
            bank_reference_number?: string | null;
            raw_response?: any;
        }
    ) => {
        logger.debug("Persisting reverse penny bank details", { user_id });

        return await db.userBankDetails.upsert({
            where: {
                user_account_no_idx: {
                    user_id,
                    account_no_hash: input.account_number,
                },
            },
            create: {
                user_id,
                account_no: input.account_number,
                ifsc_code: input.ifsc_code,
                bank_name: input.bank_name,
                account_holder_name: input.account_holder_name,
                account_type: input.account_type,
                is_primary: true,
                verification_status: "PENDING",
                verification_method: "REVERSE_PENNY",
                provider_reference_id: input.bank_reference_number,
                raw_verification_response: input.raw_response,
            },
            update: {
                ifsc_code: input.ifsc_code,
                bank_name: input.bank_name,
                account_holder_name: input.account_holder_name,
                account_type: input.account_type,
                is_primary: true,
                provider_reference_id: input.bank_reference_number,
                raw_verification_response: input.raw_response,
            },
        });
    };

    /** Syncs verification_status/raw_verification_response from a pre_verification's bank_accounts[0] entry. */
    sync_verification_from_pre_verification = async (id: string, bank_account_result: any) => {
        const status = bank_account_result?.status; // verified | failed | null (in progress)

        return await db.userBankDetails.update({
            where: { id },
            data: {
                verification_status: status === "verified" ? "VERIFIED" : status === "failed" ? "FAILED" : "IN_PROGRESS",
                verified_at: status === "verified" ? new Date() : undefined,
                raw_verification_response: bank_account_result ?? undefined,
            }
        });
    }

    /**
     * Stores both FP identifiers from the bank_account create response - the string id
     * (bac_...) for folio_defaults.payout_bank_account, and the numeric old_id for mandate
     * creation's bank_account_id. Same object, two different identifiers, both needed.
     */
    set_fp_bank_account_ids = async (id: string, fp_bank_account_id: string, fp_bank_account_old_id?: number) => {
        return await db.userBankDetails.update({
            where: { id },
            data: {
                fp_bank_account_id,
                ...(fp_bank_account_old_id !== undefined ? { fp_bank_account_old_id } : {}),
            }
        });
    }
}

export const user_bank_details_service = new UserBankDetailsServiceClass();
