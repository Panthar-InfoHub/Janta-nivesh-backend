import { NextFunction, Request, Response } from "express";
import logger from "../../middleware/logger.js";
import { trading_account_service } from "../../services/kyc/trading.account.service.js";
import { kyc_type_service } from "../../services/kyc/kyc.type.service.js";
import { generate_unique_code } from "../../helpers/unique.code.js";
import { NseRegistrationSchema, ConfirmTradingAccountSchema } from "../../lib/zod-schemas/trading.account.schema.js";
import { user_service } from "../../services/user.service.js";
import AppError from "../../middleware/error.middleware.js";
import { mfkyc_identity_service } from "../../services/kyc/mfkyc.identity.service.js";
import { kyc_finnsys_service } from "../../services/kyc/kyc.finnsys.service.js";
import { nse_service } from "../../services/nse.service.js";
import { user_finnsys_service } from "../../services/user.finnsys.service.js";

class TradingAccountControllerClass {

    get_trading_account_data = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id!;
            logger.info("Fetching trading account data for user id ==> ", user_id);

            const { user_data, kyc_data } = await trading_account_service.get_trading_account(user_id);

            res.status(200).json({
                success: true,
                message: "Trading account data fetched successfully",
                data: {
                    full_name: user_data.full_name,
                    email: user_data.email,
                    phone_no: user_data.phone_no,
                    dob: new Date(user_data.dob).toISOString(),
                    gender: kyc_data.gender,
                    pan_no: kyc_data.pan_no,
                    place_of_birth: kyc_data.place_of_birth,
                    full_address: kyc_data.full_address,
                    uid: kyc_data.uid,
                    pin_code: kyc_data.pincode,
                    city: kyc_data.city,
                    district: kyc_data.district,
                    state: kyc_data.state,
                    country: kyc_data.country,
                    martial_status: kyc_data.marital_status,
                    father_name: kyc_data.father_name,
                    mother_name: kyc_data.mother_name
                }
            });
            return;
        } catch (error) {
            logger.error("Error while fetching trading account data controller ==> ", error);
            next(error);
        }
    }


    create_trading_account = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info("Creating trading account for user id ==> ", user?.id);

            // 1. Mark KYC status as initiated
            await kyc_type_service.upsert_kyc_status(req.user!.id, "trading", "initiated");

            const raw_payload = {
                ...req.body.data,
                paperless_flag: "Z",
                client_code: await generate_unique_code("VLVTINV"),
            };

            logger.debug("Raw payload for trading account creation ==> ", raw_payload);

            const result = NseRegistrationSchema.safeParse(raw_payload);

            if (!result.success) {
                logger.error("Validation failed for trading account creation ==> ", result.error);
                throw new AppError("Validation failed", 400, "VALIDATION_ERROR");
            }

            logger.debug("Trading account mandatory data is validated...")

            // Store bank details if provided in current registration flow
            if (result.data.account_no_1 && result.data.ifsc_code_1) {

                logger.info("Updating user bank details...")
                logger.info(`Updating user finnsys details with pan ==> ${result.data.primary_holder_pan} of username ==> ${user.log}`)
                const [_, __] = await Promise.all([
                    mfkyc_identity_service.upsert_bank_details(req.user!.id, {
                        account_no: result.data.account_no_1,
                        ifsc_code: result.data.ifsc_code_1,
                        account_type: result.data.account_type_1 || "SB",
                        is_primary: result.data.default_bank_flag_1 === "Y"
                    }),
                    user_finnsys_service.update_user_finnsys_details(user.log!, user.pwd!, {
                        invpan: (result.data.primary_holder_pan as string) ?? undefined
                    })
                ]);
            }

            /**
             * Trading account creation flow:
             * 1. Call client registration API to create trading account in NSE system.
             * 2. Call FATCA registration API as well.
             * 3. Update user record with NSE client code and other relevant details.
             * 4. Generate short URL for client code activation and send it in response.
             * 
             * Note: Client code activation is a separate step that user needs to do by clicking on the short URL sent in response. We are not automating that step as it requires user interaction and consent.
             */
            await trading_account_service.client_registration(req.user!.id, result.data, user.log!, user.pwd!);
            const [_user, short_url_res] = await Promise.all([
                user_service.update_user(req.user!.id, { nse_client_code: raw_payload.client_code }),
                nse_service.get_short_url("CL_ACT", raw_payload.client_code, user.log!, user.pwd!)
            ]);

            logger.info(`Trading account created successfully for user id ==> ${req.user?.id} with NSE client code ==> ${raw_payload.client_code}`);
            logger.debug("Short URL response from NSE ==> ", short_url_res);

            if (short_url_res.code != 1) {
                logger.warn("Failed to generate short URL for trading account creation. Response from NSE ==> ", short_url_res);
                throw new AppError("Trading account created but failed to generate short URL, Check your registered mail for Client Code activation", 500, "SHORT_URL_ERROR");
            }

            // 5. Update KYC status to in_progress
            await kyc_type_service.upsert_kyc_status(req.user!.id, "trading", "in_progress");


            res.status(200).json({
                success: true,
                message: "Trading account created successfully and FATCA registration completed",
                data: {
                    short_url: short_url_res.data.firstHolderLink
                },
            });
            return;

        } catch (error) {
            logger.error("Error in creating trading account controller ==> ", error);
            next(error);
        }
    }

    pan_verification = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user_id = req.user?.id!;
            const pan_number = req.query.pan_number as string;
            logger.info(`Initiating PAN verification for user id ==> ${user_id} with PAN number ==> ${pan_number}`);

            let pan_verified = true;
            let app_verified = true;

            /**
             * PAN verification logic:
             * 1. Call Finnsys API to verify PAN number : Checking if the PAN number is valid and matches the user's name as per government records..
             * -> Why? User have already KYC from anyother app
             * 
             * 2. Call MF KYC Identity service to get verified details for the user : Checking if the user has completed KYC and the PAN number matches with the one provided by user.
             * -> Why? User might have completed KYC but PAN verification might be pending or failed. We need to ensure that PAN is verified and KYC is completed before allowing user to create trading account.
             */


            const [pan_verification_result, mf_kyc_identity] = await Promise.all([
                kyc_finnsys_service.pan_verification(pan_number),
                mfkyc_identity_service.get_verified_details(user_id, pan_number)
            ]);

            logger.debug("PAN verification result from Finnsys ==> ", pan_verification_result);
            logger.debug("MF KYC identity details ==> ", mf_kyc_identity);

            if (pan_verification_result.code as any != "1") {
                logger.warn(`PAN verification failed for user id ==> ${user_id} with PAN number ==> ${pan_number}. Finnsys response code ==> ${pan_verification_result.code}`);
                pan_verified = false;
                throw new AppError("PAN verification failed", 400, "PAN_VERIFICATION_FAILED");
            }

            if (!mf_kyc_identity || mf_kyc_identity.pan_no != pan_number) {
                logger.warn(`PAN verification failed for user id ==> ${user_id} with PAN number ==> ${pan_number}. PAN number mismatch`);
                app_verified = false;
                // throw new AppError("PAN number does not match or App KYC isn't completed yet", 400, "PAN_MISMATCH");
            }

            logger.info("PAN verification successful for user id ==> ", user_id);

            res.status(200).json({
                success: true,
                message: "PAN verification successful",
                data: {
                    pan_verified,
                    app_verified,
                    ...mf_kyc_identity,
                    full_name: pan_verification_result.firstPanName,
                }
            });
            return;

        } catch (error) {
            logger.error("Error in pan verification controller ==> ", error);
            next(error);
            return;
        }
    }

    confirm_trading_account = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info("Confirming trading account verification for user id ==> ", user.id);

            // 1. Validate request body
            const result = ConfirmTradingAccountSchema.safeParse(req.body);
            if (!result.success) {
                logger.error("Validation failed for confirming trading account ==> ", result.error);
                throw new AppError("Validation failed", 400, "VALIDATION_ERROR");
            }

            const { tax_status, holding_nature, jh1_name, jh2_name, guardian_name } = result.data;

            // 2. Load user details
            const user_data = await user_service.get_user_by_id(user.id);
            if (!user_data) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            // Guard: ensure user.nse_client_code exists (this is the IIN)
            if (!user_data.nse_client_code) {
                logger.warn(`Trading account confirmation failed for user id: ${user.id} - nse_client_code is missing`);
                throw new AppError("NSE client code (IIN) is missing. Please create a trading account first.", 400, "MISSING_CLIENT_CODE");
            }

            // 3. Load primary bank details
            const primary_bank = await mfkyc_identity_service.get_primary_bank(user.id);
            if (!primary_bank) {
                logger.warn(`Trading account confirmation failed for user id: ${user.id} - primary bank details are missing`);
                throw new AppError("Primary bank details are missing. Please add a bank account first.", 400, "MISSING_BANK_DETAILS");
            }

            // 4. Guard: ensure user.full_name exists
            if (!user_data.full_name) {
                logger.warn(`Trading account confirmation failed for user id: ${user.id} - full name is missing`);
                throw new AppError("User full name is missing.", 400, "MISSING_FULL_NAME");
            }

            // 5. Call Finnsys SaveNSEIIN
            const save_res = await kyc_finnsys_service.save_nse_iin(user.log!, user.pwd!, {
                iin: user_data.nse_client_code,
                tax_status,
                holding_nature,
                primary_name: user_data.full_name,
                bank_ac_no: primary_bank.account_no,
                bank_ifsc: primary_bank.ifsc_code,
                bank_ac_type: primary_bank.account_type,
                jh1_name,
                jh2_name,
                guardian_name,
            });

            // 6. Check response code (Finnsys APIs return code: 1 on success)
            if (save_res.code != 1) {
                logger.error(`Finnsys SaveNSEIIN failed for user id ${user.id} with response ==> `, save_res);
                throw new AppError(save_res.message || "Failed to save NSE IIN with Finnsys", 400, "SAVE_NSE_IIN_FAILED");
            }

            logger.info(`Finnsys SaveNSEIIN succeeded for user id: ${user.id}`);

            // 7. Update KYC status to verified
            await kyc_type_service.upsert_kyc_status(user.id, "trading", "verified");

            res.status(200).json({
                success: true,
                message: "Trading account verification confirmed"
            });
        } catch (error) {
            logger.error("Error in confirming trading account ==> ", error);
            next(error);
        }
    }
}

export const trading_account_controller = new TradingAccountControllerClass();