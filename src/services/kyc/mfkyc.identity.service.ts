import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { map_digilocker_to_identity, type DigilockerData } from "../../lib/zod-schemas/finnsys.schema.js";
import logger from "../../middleware/logger.js";

export type { DigilockerData };

class MFKycIdentityServiceClass {

    /**
     * Step 1: Upsert from digilocker data (basic Aadhaar identity)
     */
    upsert_from_digilocker = async (user_id: string, digilocker_data: DigilockerData) => {
        const mapped = map_digilocker_to_identity(digilocker_data);

        return await db.mfKycIdentity.upsert({
            where: { user_id },
            create: { user: { connect: { id: user_id } }, ...mapped },
            update: mapped
        });
    }

    /**
     * Typed update — accepts any valid MfKycIdentity fields.
     * Usage:
     *   update_identity(user_id, map_kyc_data_to_identity(kyc_data))
     *   update_identity(user_id, { user_photo_url: "url" })
     *   update_identity(user_id, { is_final_confirmed: true, verified_at: new Date() })
     */
    update_identity = async (user_id: string, data: Prisma.MfKycIdentityUpdateInput) => {
        return await db.mfKycIdentity.update({
            where: { user_id },
            data
        });
    }

    get_by_user_id = async (user_id: string) => {
        return await db.mfKycIdentity.findUnique({
            where: { user_id }
        });
    }

    upsert_bank_details = async (user_id: string, bank_data: {
        account_no: string;
        ifsc_code: string;
        bank_name?: string;
        account_type: string;
        is_primary?: boolean;
    }) => {
        return await db.userBankDetails.upsert({
            where: {
                user_account_no_idx: {
                    user_id,
                    account_no: bank_data.account_no
                }
            },
            create: {
                user_id,
                ...bank_data
            },
            update: {
                ...bank_data
            }
        });
    }

    get_primary_bank = async (user_id: string) => {
        return await db.userBankDetails.findFirst({
            where: { user_id, is_primary: true }
        });
    }


    get_verified_details = async (user_id: string, pan_no: string) => {
        try {
            return await db.mfKycIdentity.findUnique({
                where: {
                    user_id,
                    pan_no,
                    is_final_confirmed: true
                }
            });
        } catch (error) {
            logger.error("Error in fetching verified KYC details ==> ", error);
            throw error;
        }

    }

    confirm_identity = async (user_id: string) => {
        return await this.update_identity(user_id, {
            is_final_confirmed: true,
            verified_at: new Date()
        });
    }
}

export const mfkyc_identity_service = new MFKycIdentityServiceClass();