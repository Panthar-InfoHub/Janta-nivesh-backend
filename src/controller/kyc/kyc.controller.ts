import { NextFunction, Request, Response } from "express";
import { env } from "../../lib/config-env.js";
import { map_kyc_data_to_identity, update_kyc_data_schema } from "../../lib/zod-schemas/finnsys.schema.js";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import { kyc_finnsys_service } from "../../services/kyc/kyc.finnsys.service.js";
import { kyc_session_service } from "../../services/kyc/kyc.session.service.js";
import { kyc_type_service } from "../../services/kyc/kyc.type.service.js";
import { mfkyc_identity_service } from "../../services/kyc/mfkyc.identity.service.js";
import { user_service } from "../../services/user.service.js";
import { MfKycIdentity } from "../../prisma/generated/prisma/client.js";
import { notification_producer_service } from "../../services/notification.producer.service.js";
import { notification_type } from "../../lib/types.js";

class KycControllerClass {




    /**
     * 
     *  * @description " Channel Login" : {
        "userName":"---", // Secrets : user name password arn
        "password":"---",
        "arn":"---",
        "investorId":"18",
        "platform":"test",
        "appName":"postman",
        "appVersion":"1.0",
        "isWebUiRequest": false
    }
     * 
     * 
     * @description " Onboarding login" : {
        "arn":"161951", -- env config --
        "investorId":"18",
        "email":"sharadsengar2003@gmail.com",
        "userName":"Sharad Segar",
        "phone":"9198663033",
        "name": "Sharad Segar"
        }
     * 


    * @description " Digilocker create link data" :{
        "arn":"161951",
        "investorId":"18",
        "merchantId": "{{merchantId}}",
        "inputData": {
            "service": "identity",
            "type": "aadhaarDigiLocker",
            "task": "createUrl",
            "data": {
                "images": [],
                "toVerifyData": {},
                "searchParam": {},
                "proofType": "identity"
            }
        }
    }* 


     * Initiate Kyc Flow :
     * Finnsys call : channel login -> create or upsert kyc_type store res.id in MfKycSession.kyc_access_token and kyc_type_id in MfKycSession.kyc_type_id
     * Finnsys call after Onboarding login : Upsert MfKycSession.kyc_access_token from onboarding login response and store MfKycSession.merchant_id = res.userId
     * Finnsys call to create digilocker link : create digilocker link and store digilocker_link_id in MfKycSession.digilocker_link_id
     * Response : user_id, digilocker_link_id, kyc_access_token, kyc_type_id
     */

    initiate_kyc = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user_id = req.user?.id!;
            const user_inv_id = req.user?.inv_id!;

            logger.info("Initiating KYC process for user ID: ", user_id, " and inv_id: ", user_inv_id);

            const user = await user_service.get_user_by_id(user_id);

            logger.debug("User for kyc ==> ", user)

            if (!user) {
                logger.warn("User not found for ID: ", user_id);
                throw new AppError("User not found", 404);
            }

            const kyc_type = "mf";


            // Channel login payload and request to Finnsys
            const channel_login_payload = {
                userName: env.FINNSYS_USERNAME,
                password: env.FINNSYS_PASSWORD,
                arn: env.ARN,
                investorId: `${user_inv_id}`,
                platform: "test",
                appName: "postman",
                appVersion: "1.0",
                isWebUiRequest: false
            };

            const channel_login_res = await kyc_finnsys_service.channel_login(channel_login_payload);

            logger.debug("Channel login response: ", channel_login_res);
            const channel_access_token = channel_login_res?.id || channel_login_res?.access_token || channel_login_res?.token;

            if (!channel_access_token) {
                logger.error("Channel login failed, response: ", channel_login_res);
                throw new AppError("Channel login token missing", 502, "KYC_CHANNEL_LOGIN_FAILED");
            }


            // Onboarding login payload and request to Finnsys

            const onboarding_login_payload = {
                arn: env.ARN,
                investorId: `${user_inv_id}`,
                email: user.email,
                userName: user.full_name || user.usr || "",
                phone: user.phone_no || "",
                name: user.full_name || user.usr || ""
            };

            if (!onboarding_login_payload.email || !onboarding_login_payload.phone || !onboarding_login_payload.userName) {
                throw new AppError("Missing onboarding login data", 400, "KYC_ONBOARDING_DATA_MISSING");
            }

            const onboarding_login_res = await kyc_finnsys_service.onboarding_login(onboarding_login_payload, channel_access_token);

            logger.debug("Onboarding login response: ", onboarding_login_res);
            const onboarding_access_token = onboarding_login_res?.access_token || onboarding_login_res?.token || onboarding_login_res?.id;
            const merchant_id = onboarding_login_res?.userId || onboarding_login_res?.merchantId || onboarding_login_res?.merchant_id;

            if (!onboarding_access_token || !merchant_id) {
                logger.error("Onboarding login failed, response, either onboarding_access_token or merchant_id missing: ", onboarding_login_res);
                throw new AppError("Onboarding login response missing fields", 502, "KYC_ONBOARDING_LOGIN_FAILED");
            }


            // Digilocker link creation payload and request to Finnsys
            const digilocker_payload = {
                arn: env.ARN,
                investorId: `${user_inv_id}`,
                merchantId: merchant_id,
                inputData: {
                    service: "identity",
                    type: "aadhaarDigiLocker",
                    task: "createUrl",
                    data: {
                        images: [],
                        toVerifyData: {},
                        searchParam: {},
                        proofType: "identity"
                    }
                }
            };

            const digilocker_res = await kyc_finnsys_service.digilocker_create_link(digilocker_payload, onboarding_access_token);
            logger.debug("Digilocker create link response: ", digilocker_res);

            const digilocker_url = digilocker_res?.result?.url;

            if (!digilocker_url) {
                logger.error("Digilocker link creation failed, response: ", digilocker_res);
                throw new AppError("Digilocker link missing", 502, "KYC_DIGILOCKER_LINK_FAILED");
            }







            // Saving Finnsys session details in database to accesss in next apis
            const kyc_type_record = await kyc_type_service.create_kyc_type({
                user_id: user_id,
                kyc_type: kyc_type,
                status: "initiated"
            });

            const kyc_session_record = await kyc_session_service.create_kyc_session({
                kyc_access_token: onboarding_access_token,
                merchant_id: merchant_id,
                digilocker_url: digilocker_url
            }, kyc_type_record.id);

            res.status(200).json({
                success: true,
                message: "KYC initiated successfully",
                data: {
                    user_id: user_id,
                    kyc_type_id: kyc_type_record.id,
                    kyc_access_token: onboarding_access_token,
                    digilocker_url: digilocker_url,
                    session_id: kyc_session_record.id
                }
            });
            return;

        } catch (error) {
            logger.error("Error initiating KYC process: ", error);
            next(error);
            return;
        }
    }


    user_digiliocker_data = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user_id = req.user?.id!;
            const inv_id = req.user?.inv_id!;
            logger.info("Fetching digilocker data for user Id ==> ", user_id);

            const user_kyc_session = await kyc_type_service.get_kyc_query(user_id, { kyc_type: "mf" });

            logger.debug("User KYC session data: ", user_kyc_session);

            if (!user_kyc_session) {
                logger.warn("No KYC session found for user ID: ", user_id);
                throw new AppError("KYC session not found", 404, "KYC_SESSION_NOT_FOUND");
            }

            // 4th Api : Finnsys KYC : Get user details after web kyc
            const digilocker_data = await kyc_finnsys_service.user_digilocker_data(
                user_kyc_session?.mfKycSessions?.merchant_id!,
                user_kyc_session?.mfKycSessions?.kyc_access_token!,
                inv_id.toString()
            );

            logger.debug("Digilocker data response: ", digilocker_data);

            // Save digilocker data in database
            const user_mf_kyc_identity = await mfkyc_identity_service.upsert_from_digilocker(user_id, digilocker_data.result.output);
            logger.info("Digilocker data upserted to MfKycIdentity for user ID: ", user_id);

            // hit finnsys POI, POA and Corr Address update APIs in sequence 
            const address_data = this.extract_poi_data(user_mf_kyc_identity);
            const poi_res = await kyc_finnsys_service.update_poi(address_data, user_kyc_session?.mfKycSessions?.kyc_access_token!, user_kyc_session?.mfKycSessions?.merchant_id!, inv_id.toString());
            const poa_res = await kyc_finnsys_service.update_poa(address_data, user_kyc_session?.mfKycSessions?.kyc_access_token!, user_kyc_session?.mfKycSessions?.merchant_id!, inv_id.toString());
            const corr_res = await kyc_finnsys_service.update_corr_poa_address(user_kyc_session?.mfKycSessions?.kyc_access_token!, user_kyc_session?.mfKycSessions?.merchant_id!, inv_id.toString());


            logger.debug(` Poi res ==> `, poi_res)
            logger.debug(` Poa res ==> `, poa_res)
            logger.debug(` Corr res ==> `, corr_res)

            res.status(200).json({
                success: true,
                message: "Digilocker data fetched successfully",
                data: user_mf_kyc_identity
            });
            return;
        } catch (error: any) {
            logger.error("Error fetching digilocker data: ", error.response.data);
            next(error);
            return;
        }
    }

    update_kyc_data = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            const inv_id = req.user?.inv_id!;
            logger.info("Updating KYC data for user ID: ", user_id);

            // Validate request body
            const validation_result = update_kyc_data_schema.safeParse(req.body.kyc_data);
            if (!validation_result.success) {
                logger.warn("KYC data validation failed: ", validation_result.error.flatten());
                throw new AppError("Invalid KYC data", 400, "KYC_DATA_VALIDATION_FAILED");
            }

            const kyc_data = validation_result.data;

            // Get KYC session
            const user_kyc_session = await kyc_type_service.get_kyc_query(user_id, { kyc_type: "mf" });

            if (!user_kyc_session || !user_kyc_session.mfKycSessions) {
                logger.warn("No KYC session found for user ID: ", user_id);
                throw new AppError("KYC session not found", 404, "KYC_SESSION_NOT_FOUND");
            }

            // Update KYC data and FATCA data via Finnsys in parallel
            const update_response = await kyc_finnsys_service.update_kyc_data(
                kyc_data,
                user_kyc_session.mfKycSessions.kyc_access_token,
                user_kyc_session?.mfKycSessions?.merchant_id!,
                `${inv_id}`
            )

            const fatca_response = await kyc_finnsys_service.update_fatca_data(
                user_kyc_session.mfKycSessions.kyc_access_token,
                user_kyc_session?.mfKycSessions?.merchant_id!,
                `${inv_id}`
            )

            logger.debug("KYC data update response: ", update_response);
            logger.debug("FATCA data update response: ", fatca_response);

            // Update MfKycIdentity with extended KYC fields via mapper
            await mfkyc_identity_service.update_identity(user_id, map_kyc_data_to_identity(kyc_data));
            logger.info("MfKycIdentity updated with extended KYC data for user ID: ", user_id);

            // Update KYC status to in_progress
            await kyc_type_service.create_kyc_type({
                user_id: user_id,
                kyc_type: "mf",
                status: "in_progress"
            });

            res.status(200).json({
                success: true,
                message: "KYC data updated successfully",
                data: {
                    kyc_update: update_response,
                    fatca_update: fatca_response
                }
            });
            return;
        } catch (error) {
            logger.error("Error updating KYC data: ", error);
            next(error);
            return;
        }
    }


    update_doc = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            const user_id = user.id!;
            logger.info("Updating KYC document for user ID: ", user_id);

            const { img_url, type }: { img_url: string, type: "photo" | "signature" } = req.body;

            if (!img_url || !type) {
                logger.warn("Missing img_url or type in request body");
                throw new AppError("Missing img_url or type", 400, "KYC_UPDATE_DOC_DATA_MISSING");
            }

            const user_kyc_session = await kyc_type_service.get_kyc_query(req.user?.id!, { kyc_type: "mf" });

            if (!user_kyc_session || !user_kyc_session.mfKycSessions) {
                logger.warn("No KYC session found for user ID: ", req.user?.id);
                throw new AppError("KYC session not found", 404, "KYC_SESSION_NOT_FOUND");
            }


            // Finnsys call :
            type === "photo" ? await kyc_finnsys_service.update_photo(img_url, user_kyc_session.mfKycSessions.kyc_access_token, user_kyc_session?.mfKycSessions?.merchant_id!, user.inv_id!.toString()) :
                await kyc_finnsys_service.update_signature(img_url, user_kyc_session.mfKycSessions.kyc_access_token, user_kyc_session?.mfKycSessions?.merchant_id!, user.inv_id!.toString());

            // Update the document URL in the KYC session
            await mfkyc_identity_service.update_identity(user_id, {
                ...((type === "photo") && { user_photo_url: img_url }),
                ...((type === "signature") && { signature_url: img_url })
            });
            res.status(200).json({
                success: true,
                message: "KYC document updated successfully",
                data: { document_url: img_url }
            });
            return;
        } catch (error) {
            logger.error("Error updating KYC document: ", error);
            next(error);
            return;
        }
    }


    create_contract = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const user_id = user?.id!;
            logger.info("Creating contract PDF for user ID: ", user_id);

            const user_kyc_session = await kyc_type_service.get_kyc_query(user_id, { kyc_type: "mf" });

            if (!user_kyc_session || !user_kyc_session.mfKycSessions) {
                logger.warn("No KYC session found for user ID: ", req.user?.id);
                throw new AppError("KYC session not found", 404, "KYC_SESSION_NOT_FOUND");
            }

            const contract_response = await kyc_finnsys_service.create_contract_pdf(
                user_kyc_session.mfKycSessions.kyc_access_token,
                user_kyc_session?.mfKycSessions?.merchant_id!,
                user.inv_id!.toString()
            );

            logger.debug("Contract PDF creation response: ", contract_response);

            // Save contract PDF URL to MfKycIdentity
            await mfkyc_identity_service.update_identity(user_id, {
                contract_pdf_url: contract_response?.object?.result?.combinedPdf || null
            });
            logger.info("Contract PDF URL updated in MfKycIdentity for user ID: ", user_id);

            res.status(200).json({
                success: true,
                message: "Contract PDF created successfully",
                data: contract_response
            });
            return;

        } catch (error) {
            logger.error("Error creating contract PDF: ", error);
            next(error);
            return;
        }
    }


    get_aadhar_esign_url = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            const user_id = user?.id!;
            logger.info("Verifying KYC for user ID: ", user_id);

            const user_kyc_session = await kyc_type_service.get_kyc_query(req.user?.id!, { kyc_type: "mf" });
            const user_data = await user_service.get_all_user_data(user_id, { mfKycIdentities: true });


            if (!user_kyc_session || !user_kyc_session.mfKycSessions) {
                logger.warn("No KYC session found for user ID: ", req.user?.id);
                throw new AppError("KYC session not found", 404, "KYC_SESSION_NOT_FOUND");
            }

            const generate_esign = await kyc_finnsys_service.generate_esign_url(
                user_kyc_session.mfKycSessions.kyc_access_token,
                user_kyc_session?.mfKycSessions?.merchant_id!,
                user.inv_id!.toString(),
                user_data?.mfKycIdentities?.contract_pdf_url!,
            )

            logger.debug("Generate esign response ==> ", generate_esign)

            res.status(200).json({
                success: true,
                message: "Aadhar esign url generated successfully",
                data: generate_esign.object.result.url
            })
            return;

        } catch (error) {
            logger.error("Error while generating aadhar esign url ===> ", error)
            next(error);
            return;
        }
    }

    verify_kyc = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const user_id = user?.id!;
            logger.info("Verifying KYC for user ID: ", user_id);

            const user_kyc_session = await kyc_type_service.get_kyc_query(req.user?.id!, { kyc_type: "mf" });
            const user_data = await user_service.get_all_user_data(user_id, { mfKycIdentities: true });


            if (!user_kyc_session || !user_kyc_session.mfKycSessions) {
                logger.warn("No KYC session found for user ID: ", req.user?.id);
                throw new AppError("KYC session not found", 404, "KYC_SESSION_NOT_FOUND");
            }

            // Save esign pdf and exxecute verification in sequence
            const esign_response = await kyc_finnsys_service.save_esign_pdf(
                user_kyc_session.mfKycSessions.kyc_access_token,
                user_kyc_session?.mfKycSessions?.merchant_id!,
                user.inv_id!.toString()
            )
            logger.debug("Esign PDF save response ==> ", esign_response)

            const verification_response = await kyc_finnsys_service.execute_verification(
                user_kyc_session.mfKycSessions.kyc_access_token,
                user_kyc_session?.mfKycSessions?.merchant_id!,
                user.inv_id!.toString()
            )
            logger.debug("KYC verification response: ", verification_response);

            // Update KYC status to completed
            await Promise.all([
                kyc_type_service.create_kyc_type({
                    user_id: user_id,
                    kyc_type: "mf",
                    status: "verified"
                }),
                mfkyc_identity_service.confirm_identity(user_id)
            ]);
            logger.info("KYC marked as verified for user ID: ", user_id);

            await notification_producer_service.publish_notification_event(
                user.id,
                "TRANSACTION",
                "KYC Verified Successfully",
                `Your KYC has been verified successfully`,
                {
                    txn: "kyc",
                    sub_type: notification_type.NOTIFICATION
                }
            );


            res.status(200).json({
                success: true,
                message: "KYC verified successfully",
            });
            return;

        } catch (error) {
            logger.error("Error verifying KYC: ", error);
            next(error);
            return;
        }
    }



    //// Helper methods :

    // 1. Extract POI data from mfkyc identity response and call Finnsys API to update POI
    private extract_poi_data = (user_mf_kyc_identity: MfKycIdentity) => {

        return {
            type: "aadhaarDigiLocker",
            name: user_mf_kyc_identity.full_name || "",
            uid: user_mf_kyc_identity.uid || "",
            address: user_mf_kyc_identity.address_line || "",
            city: user_mf_kyc_identity.city || "",
            state: user_mf_kyc_identity.state || "",
            district: user_mf_kyc_identity.district || "",
            pincode: user_mf_kyc_identity.pincode || "",
            dob: user_mf_kyc_identity.dob || ""
        }
    }
}

export const kyc_controller = new KycControllerClass()