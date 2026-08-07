import { db } from "../server.js";
import logger from "../middleware/logger.js";
import type { PennyDropInput } from "../lib/zod-schemas/penny-drop.schema.js";

class UserBankDetailsServiceClass {

    get_primary = async (user_id: string) => {
        return await db.userBankDetails.findFirst({ where: { user_id, is_primary: true } });
    }

    /**
     * Penny drop save - upserts by (user_id, account_no) same pattern as v1's
     * mfkyc_identity_service.upsert_bank_details: pass the plain account_no in the
     * account_no_hash slot of the unique-index where clause, the Prisma extension rewrites
     * it to the actual blind-index hash before hitting the DB.
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
                verification_status: "VERIFIED",
                verification_method: "UPI",
                verified_at: new Date(),
            },
            update: {
                ifsc_code: input.ifsc_code,
                bank_name: input.bank_name,
                account_holder_name: input.account_holder_name,
                account_type: input.account_type,
                is_primary: true,
                verification_status: "VERIFIED",
                verification_method: "UPI",
                verified_at: new Date(),
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
