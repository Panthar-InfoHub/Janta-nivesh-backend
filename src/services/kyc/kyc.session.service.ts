import { db } from "../../server.js";

class KycSessionServiceClass {

    create_kyc_session = async (data: any, kyc_type_id: string) => {
        // const kyc_session = await db.mfKycSession.upsert({
        //     where: {
        //         kyc_type_id
        //     },
        //     create: {
        //         ...data,
        //         kyc_type_id
        //     },
        //     update: {
        //         ...data
        //     }
        // });
        // return kyc_session;
    }

}
export const kyc_session_service = new KycSessionServiceClass()