import { db } from "../../server.js";
// import type { Prisma, KycTypeValue, KycStatus } from "../../prisma/generated/prisma/client.js";
// import { KycTypeUpdateInput } from "../../prisma/generated/prisma/models.js";

// type KycQueryInput = {
//     kyc_type?: KycTypeValue;
// };

// type KycTypeWithSession = Prisma.KycTypeGetPayload<{
//     include: { mfKycSessions: true };
// }>;

class KycTypeServiceClass {

    create_kyc_type = async (data: any) => {
        // const kyc_type = await db.kycType.upsert({
        //     where: {
        //         user_id_kyc_type: {
        //             user_id: data.user_id,
        //             kyc_type: data.kyc_type
        //         }
        //     },
        //     create: {
        //         ...data
        //     },
        //     update: {
        //         ...data
        //     }
        // });
        // return kyc_type;
    }


    get_kyc_query = async (user_id: string, data) => {
        const { kyc_type } = data;

        // const kyc_data = await db.kycType.findFirst({
        //     where: {
        //         user_id: user_id,
        //         ...(kyc_type ? { kyc_type: kyc_type } : {})
        //     },
        //     include: {
        //         mfKycSessions: true
        //     }
        // });

        // return kyc_data;
    }

    update_kyc_type = async (user_id: string, kyc_type, data) => {
        // const kyc_type_data = await db.kycType.update({
        //     where: {
        //         user_id_kyc_type: {
        //             user_id,
        //             kyc_type
        //         }
        //     },
        //     data: {
        //         ...data
        //     }
        // });

        // return kyc_type_data;
    }

    upsert_kyc_status = async (user_id: string, kyc_type, status) => {
        // const kyc_type_data = await db.kycType.upsert({
        //     where: {
        //         user_id_kyc_type: {
        //             user_id,
        //             kyc_type
        //         }
        //     },
        //     update: {
        //         status
        //     },
        //     create: {
        //         user_id,
        //         kyc_type,
        //         status
        //     }
        // });
        // return kyc_type_data;
    }

}

export const kyc_type_service = new KycTypeServiceClass()