import axios from "axios";
import { env } from "../../lib/config-env.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";

class KycFinnsysServiceClass {
    kyc_base_url: string;
    finnsys_base_url: string;

    constructor() {
        this.kyc_base_url = `${env.KYC_BASE_URL}/kyc/v1`;
        this.finnsys_base_url = `${env.KYC_BASE_URL}`;
    }


    channel_login = async (data: any) => {
        const response = await axios.post(`${this.kyc_base_url}/channels/login`, data);
        return response.data;
    }


    onboarding_login = async (data: any, kyc_access_token: string) => {
        const response = await axios.post(`${this.kyc_base_url}/onboardings/login`, data, {
            headers: {
                "Authorization": `${kyc_access_token}`
            }
        });
        return response.data;
    }

    digilocker_create_link = async (data: any, kyc_access_token: string) => {
        const response = await axios.post(`${this.kyc_base_url}/onboardings/execute`, data, {
            headers: {
                "Authorization": `${kyc_access_token}`
            }
        });
        return response.data;
    }

    user_digilocker_data = async (merchant_id: string, kyc_access_token: string, inv_id: any) => {
        const data = {
            arn: env.ARN,
            investorId: inv_id,
            merchantId: merchant_id,
            inputData: {
                service: "identity",
                type: "aadhaarDigiLocker",
                task: "getDetails",
                data: {
                    images: [],
                    toVerifyData: {},
                    searchParam: {},
                    proofType: "identity"
                }
            }
        };



        const response = await axios.post(`${this.kyc_base_url}/onboardings/execute`, data, {
            headers: {
                "Authorization": `${kyc_access_token}`
            }
        });
        return response.data;
    }



    private update_form = async (kyc_access_token: string, merchant_id: string, inv_id: string, type: string, data: object) => {
        const payload = {
            arn: env.ARN,
            investorId: inv_id,
            merchantId: merchant_id,
            save: "formData",
            type,
            data
        };

        logger.debug("Payload for updating form data ==> ", payload);
        const response = await axios.post(`${this.kyc_base_url}/onboardings/updateForm`, payload, {
            headers: { "Authorization": `${kyc_access_token}` }
        });

        logger.warn(`Response from updating ${type} form data ==> `, response.data);
        return response.data;
    }

    // Background hitting POI, POA and Corresponsing address apis of finnsys
    // POI : "type": "identityProof", data from mfkyc identiy that we saved in our db from digilocker response
    update_poi = async (poi_data: any, kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.update_form(kyc_access_token, merchant_id, inv_id, "identityProof", {
                type: "identityProof",
                ...poi_data
            });
        } catch (error) {
            logger.error("Error in updating POI data ==> ", error);
            throw error;
        }
    }

    update_poa = async (poa_data: any, kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.update_form(kyc_access_token, merchant_id, inv_id, "addressProof", {
                type: "aadhaarDigiLocker",
                ...poa_data
            });
        } catch (error: any) {
            console.log("Error in updating POA data ==> ", error?.response);
            // logger.error("Error in updating POA data ==> ", error?.response);
            // throw error;
        }
    }

    update_corr_poa_address = async (kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.update_form(kyc_access_token, merchant_id, inv_id, "corrAddressProof", {
                sameAsPermanent: "true"
            });
        } catch (error) {
            logger.error("Error in updating corresponding POA address data ==> ", error);
            throw error;
        }
    }



    update_kyc_data = async (kyc_data: any, kyc_access_token: string, merchant_id: string, inv_id: string) => {
        return this.update_form(kyc_access_token, merchant_id, inv_id, "kycdata", {
            type: "kycdata",
            kycData: kyc_data
        });
    }

    update_fatca_data = async (kyc_access_token: string, merchant_id: string, inv_id: string) => {
        return this.update_form(kyc_access_token, merchant_id, inv_id, "fatca", {
            type: "fatca",
            fatcaData: {
                pep: "NO",
                rpep: "NO",
                residentForTaxInIndia: "NO",
                relatedPerson: "NO"
            }
        });
    }

    update_signature = async (signature_url: string, kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.update_form(kyc_access_token, merchant_id, inv_id, "signature", {
                type: "signature",
                signatureImageUrl: signature_url,
                consent: "true"
            });
        } catch (error) {
            logger.error("Error in updating user signature ==> ", error);
            throw new AppError("Failed to update user signature. Please try again later.", 500);
        }

    }

    update_photo = async (photo_url: string, kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.update_form(kyc_access_token, merchant_id, inv_id, "userPhoto", {
                photoUrl: photo_url
            });
        } catch (error) {
            logger.error("Error in updating user photo ==> ", error);
            throw new AppError("Failed to update user photo. Please try again later.", 500);
        }

    }

    private execute_onboarding = async (kyc_access_token: string, merchant_id: string, inv_id: string, inputData: object) => {
        const payload = {
            arn: env.ARN,
            investorId: inv_id,
            merchantId: merchant_id,
            inputData
        };

        logger.debug("Payload for executing onboarding task ==> ", payload);
        const response = await axios.post(`${this.kyc_base_url}/onboardings/execute`, payload, {
            headers: { "Authorization": `${kyc_access_token}` }
        });
        return response.data;
    }

    create_contract_pdf = async (kyc_access_token: string, merchant_id: string, inv_id: string) => {
        return this.execute_onboarding(kyc_access_token, merchant_id, inv_id, {
            service: "esign",
            type: "",
            task: "createPdf",
            data: {}
        });
    }

    save_esign_pdf = async (kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.execute_onboarding(kyc_access_token, merchant_id, inv_id, {
                service: "esign",
                type: "",
                task: "getEsignData",
                data: {}
            });
        } catch (error) {
            logger.error("Error in saving esign pdf data ==> ", error);
            throw error;
        }
    }

    execute_verification = async (kyc_access_token: string, merchant_id: string, inv_id: string) => {
        try {
            return this.execute_onboarding(kyc_access_token, merchant_id, inv_id, {
                service: "verificationEngine",
                merchantId: merchant_id
            });
        } catch (error) {
            logger.error("Error in executing verification ==> ", error);
            throw error;
        }
    }


    pan_verification = async (pan_number: string) => {

        try {
            const response = await axios.post(`${this.finnsys_base_url}/icici/v1/checkKyc`, {
                "arn": Number(env.ARN),
                "firstPan": pan_number,
                "taxStatus": "01"
            });
            return response.data;
        } catch (error) {
            logger.error("Error in PAN verification with Finnsys ==> ", error);
            throw error;
        }

    }
}

export const kyc_finnsys_service = new KycFinnsysServiceClass()