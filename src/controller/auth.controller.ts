import { NextFunction, Request, Response } from "express";
import { AuthResponse } from "../lib/types.js";
import AppError from "../middleware/error.middleware.js";
import { generate_JWT } from "../middleware/jwt.js";
import logger from "../middleware/logger.js";
import { User } from "../prisma/generated/prisma/client.js";
import { deviceParamsSchema, reqOtpSchema, validateOtpSchema } from "../schemas/auth.schema.js";
import { auth_service } from "../services/auth.service.js";
import { user_service } from "../services/user.service.js";
import { zoho_webhook_service } from "../services/zoho.webhook.service.js";

class AuthControllerClass {

    private extract_device_params(req: Request) {
        const validation = deviceParamsSchema.safeParse(req.query);
        if (!validation.success) {
            logger.error("Invalid device parameters:", validation.error.format());
            throw new AppError("Invalid device parameters", 400, "INVALID_DEVICE_PARAMS");
        }
        return validation.data;
    }

    auth_req_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {

            // Required Query Params
            logger.debug("Extracting device parameters for OTP request  ==> ", req.query);
            const device_params = this.extract_device_params(req);

            // Validation
            const validation = reqOtpSchema.safeParse(req.query);
            if (!validation.success) {
                logger.error("Mobile number validation failed");
                throw new AppError("A valid 10-digit mobile number is required", 400, "INVALID_PHONE_NUMBER");
            }

            const mob = validation.data.mob;

            logger.info(`OTP Request for Mobile: ${mob}, Device: ${device_params.did}`);

            const auth_res: AuthResponse = await auth_service.req_otp(mob, device_params);

            if (auth_res.code !== 1) {
                throw new AppError("Failed to request OTP", 500, "OTP_REQUEST_FAILED");
            }

            const user = await user_service.create_user({
                phone_no: mob
            })

            logger.debug("User record ensured/created with ID: ", user.id);


            res.status(200).json({
                success: true,
                message: "OTP requested successfully",
                data: {
                    user_id: user.id,
                    phone_no: user.phone_no
                }
            });
            return;


        } catch (error) {
            logger.error("Error in auth_req_otp:", error);
            next(error);
            return;
        }
    }

    auth_validate_otp = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const device_params = this.extract_device_params(req);

            const validation = validateOtpSchema.safeParse(req.body);
            if (!validation.success) {
                logger.error("OTP validation payload invalid");
                throw new AppError("Mobile number and 4-digit OTP are required", 400, "INVALID_OTP_PAYLOAD");
            }

            const { mob, otp, fcm_token } = validation.data;

            const user = await user_service.get_user_by_phone(mob);
            if (!user) {
                logger.error("User not found for mobile number during OTP validation");
                throw new AppError("User not found, Sign up first", 404, "USER_NOT_FOUND");
            }

            logger.info(`Validating OTP for Mobile: ${mob}, Device: ${device_params.did}`);
            const auth_res: AuthResponse = await auth_service.validate_otp(mob, otp, device_params);
            logger.debug("OTP Validation Response:", auth_res);

            if (auth_res.code !== 1) {
                throw new AppError("OTP validation failed", 401, "OTP_VALIDATION_FAILED");
            }

            const refresh_token = generate_JWT(user, "30d");

            const updated_user = await user_service.update_user(user.id, {
                usr: auth_res.results[0].usr,
                pwd: auth_res.results[0].pwd,
                inv_id: auth_res.results[0].invid,
                refresh_token: refresh_token,
                fcm_token,
            });

            await zoho_webhook_service.send_event({
                event_type: "USER_SIGNUP_COMPLETED",
                timestamp: new Date().toISOString(),
                user_id: updated_user.id,
                user_phone: updated_user.phone_no,
                inv_id: String(auth_res.results?.[0]?.invid ?? ""),
                finnsys_usr: auth_res.results?.[0]?.usr ?? "",
                onboarding_stage: 0,
                is_onboarding_completed: false
            });

            const token = generate_JWT(updated_user);

            res.status(200).json({
                success: true,
                message: "OTP validated successfully",
                data: {
                    user: {
                        user_id: updated_user.id,
                        phone_no: updated_user.phone_no,
                        metadata: updated_user.meta_data ?? {
                            onboarding_stage: 0,
                            is_onboarding_completed: false,
                        }
                    },
                    token: token,
                    refresh_token: refresh_token
                }
            });
            return;

        } catch (error) {
            logger.error("Error in auth_validate_otp:", error);
            next(error);
            return;
        }
    }

    auth_login_invId = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const device_params = this.extract_device_params(req);

            const inv_id = parseInt(req.body.inv_id as string);

            if (!inv_id) {
                logger.error("Invoice ID is required for login");
                throw new AppError("Invoice ID is required", 400, "NOT_INV_ID_PROVIDED");
            }

            const user = await user_service.get_user_by_invId(inv_id);
            if (!user) {
                logger.error("User not found for inv Id during login");
                throw new AppError("User not found, Sign up first", 404, "USER_NOT_FOUND");
            }

            logger.info(`Login Attempt for User with InvId: ${inv_id}, Device: ${device_params.did}`);
            const auth_res = await auth_service.login_invId(device_params, inv_id, user.phone_no ?? undefined, "");

            logger.debug("Login response from auth service ==> ", auth_res);


            if (auth_res.code !== 1) {
                throw new AppError("Login validation failed", 401, "LOGIN_VALIDATION_FAILED");
            }

            const updated_user = await user_service.update_user(user.id, {
                usr: auth_res.results.usr,
                pwd: auth_res.results.pwd,
                inv_id: auth_res.results.invid
            });

            const token = generate_JWT(updated_user);
            const refresh_token = generate_JWT(updated_user, "30d");
            res.status(200).json({
                success: true,
                message: "Login successful",
                data: {
                    user: {
                        user_id: updated_user.id,
                        phone_no: updated_user.phone_no,
                    },
                    token: token,
                    refresh_token: refresh_token
                }
            });
            return;

        } catch (error) {
            logger.error("Error in auth_login_invId:", error);
            next(error);
            return;
        }
    }

    auth_login_creds = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const device_params = this.extract_device_params(req);

            logger.debug("Request Body for Login: ", req.body);

            const usr = req.body.usr as string || "";
            const pwd = req.body.pwd as string || "";
            if (!usr || !pwd) {
                logger.error("Username and Password are required for login");
                throw new AppError("Username and Password are required", 400, "NOT_CREDENTIALS_PROVIDED");
            }

            const user = await user_service.get_user_by_usr(usr);
            if (!user) {
                logger.error("User not found for username during login");
                throw new AppError(`User not found for username : ${usr}`, 404, "USER_NOT_FOUND");
            }

            logger.info(`Login Attempt for User: ${usr}, Device: ${device_params.did}`);

            const auth_res = await auth_service.login_creds(usr, pwd, device_params);
            logger.debug("Auth response for creds ==> ", auth_res)
            if (auth_res.code !== 1) {
                throw new AppError("Login validation failed", 401, "LOGIN_VALIDATION_FAILED");
            }

            const updated_user = await user_service.update_user(user.id, {
                usr: auth_res.results.usr,
                pwd: auth_res.results.pwd,
                inv_id: auth_res.results.invid
            });

            const token = generate_JWT(updated_user);
            const refresh_token = generate_JWT(updated_user, "30d");

            res.status(200).json({
                success: true,
                message: "OTP validated successfully",
                data: {
                    user: {
                        user_id: updated_user.id,
                        phone_no: updated_user.phone_no,
                        metadata: updated_user.meta_data ?? {
                            onboarding_stage: 0,
                            is_onboarding_completed: false,
                        }
                    },
                    token: token,
                    refresh_token
                }
            });
            return;

        } catch (error) {
            logger.error("Error in auth_login_creds:", error);
            next(error);
            return;
        }
    }


    refresh_token = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const old_token = req.body.token as string;
            if (!old_token) {
                logger.error("Refresh token is required");
                throw new AppError("Refresh token is required", 400, "NOT_REFRESH_TOKEN_PROVIDED");
            }

            const user: any = await user_service.get_user_by_refresh_token(old_token);

            if (!user) {
                logger.error("Invalid refresh token provided");
                throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
            }

            logger.info(`Refreshing token for User ID: ${user.id}`);

            const access_token = generate_JWT(user);
            const refresh_token = generate_JWT(user, "30d");

            await user_service.update_user(user.id, {
                refresh_token: refresh_token
            });

            res.status(200).json({
                success: true,
                message: "Token refreshed successfully",
                data: {
                    token: access_token,
                    refresh_token: refresh_token
                }
            });
            return;

        } catch (error) {
            logger.error("Error in refresh_token:", error);
            next(error);
            return;
        }
    }
}

export const auth_controller = new AuthControllerClass();