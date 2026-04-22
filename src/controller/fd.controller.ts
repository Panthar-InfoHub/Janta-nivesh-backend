import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import logger from "../middleware/logger.js";
import { FdCustomerType, FdPayoutFrequency } from "../prisma/generated/prisma/enums.js";
import { fd_service } from "../services/fd/fd.service.js";
import AppError from "../middleware/error.middleware.js";
import { fd_transaction_service } from "../services/fd.transaction.service.js";
import { env } from "../lib/config-env.js";
import { user_service } from "../services/user.service.js";
import { redis_buffer_client } from "../lib/redis.js";
import {
    build_fd_list_cache_key,
    compress_json,
    decompress_json,
    get_fd_search_query
} from "../lib/utils.js";
import { job_controller } from "./job.controller.js";

class FdControllerClass {

    private to_dd_mm_yyyy = (date_value?: Date | string | null): string | undefined => {
        if (!date_value) return undefined;

        if (typeof date_value === "string") {
            return date_value;
        }

        const day = String(date_value.getDate()).padStart(2, "0");
        const month = String(date_value.getMonth() + 1).padStart(2, "0");
        const year = date_value.getFullYear();

        return `${day}/${month}/${year}`;
    }

    private omit_empty = <T>(obj: T): T => {
        if (Array.isArray(obj)) {
            return obj
                .map((item) => this.omit_empty(item))
                .filter((item) => item !== undefined && item !== null) as T;
        }

        if (obj && typeof obj === "object") {
            const cleaned = Object.entries(obj as Record<string, unknown>)
                .map(([key, value]) => {
                    if (value === undefined || value === null) return [key, undefined] as const;
                    if (value === "") return [key, undefined] as const;

                    const nested = this.omit_empty(value);
                    if (typeof nested === "object" && nested !== null && !Array.isArray(nested) && Object.keys(nested as Record<string, unknown>).length === 0) {
                        return [key, undefined] as const;
                    }

                    return [key, nested] as const;
                })
                .filter(([, value]) => value !== undefined);

            return Object.fromEntries(cleaned) as T;
        }

        return obj;
    }

    private normalize_payout_frequency = (value?: string): FdPayoutFrequency => {
        const normalized = String(value ?? FdPayoutFrequency.CUMULATIVE).toUpperCase();
        return Object.values(FdPayoutFrequency).includes(normalized as FdPayoutFrequency)
            ? (normalized as FdPayoutFrequency)
            : FdPayoutFrequency.CUMULATIVE;
    }

    private normalize_customer_type = (value?: string): FdCustomerType => {
        const normalized = String(value ?? FdCustomerType.STANDARD).toUpperCase();
        return Object.values(FdCustomerType).includes(normalized as FdCustomerType)
            ? (normalized as FdCustomerType)
            : FdCustomerType.STANDARD;
    }


    private create_encryption_text = (plainText: any) => {

        const iterations = 1000;
        const keySize = 256 / 8;
        const ivSize = 128 / 8;
        function generateKeyAndIV() {
            const password = env.BLOSTEM_ENCRYPTION_KEY;
            const salt = env.BLOSTEM_ENCRYPTION_SALT;
            const derivedBytes = crypto.pbkdf2Sync(password, Buffer.from(salt), iterations, keySize +
                ivSize, 'sha256');
            const key = derivedBytes.slice(0, keySize);
            const IV = derivedBytes.slice(keySize);
            return { key, IV };
        }
        try {
            const { IV, key } = generateKeyAndIV();
            const plainBytes = Buffer.from(plainText, 'utf-8');
            const cipher = crypto.createCipheriv('aes-256-gcm', key, IV);
            const encryptedBytes = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
            const tag = cipher.getAuthTag();
            const encryptedData = Buffer.concat([encryptedBytes, tag]);
            const encryptedBase64 = encryptedData.toString('base64');
            return 'ENCRYPTED:' + encryptedBase64;
        } catch (ex) {
            logger.error("Error in create_encryption_text: ", ex);
            throw ex;
        }
    }


    create_purchase_url = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user_id = req.user?.id! as string;
            logger.info(`Creating purchase URL for User ID: ${user_id}...`);


            const { product_id, tenure, investment_amount, payout_frequency, investment_period } = req.body;
            const [fd_product, user] = await Promise.all([
                fd_service.get_fd_details({ id: product_id }),
                user_service.get_user_by_id(user_id)
            ]);

            if (!fd_product) {
                logger.error(`FD Product with ID ${product_id} not found`);
                throw new AppError("FD Product not found", 404, "FD_PRODUCT_NOT_FOUND");
            }

            const requested_tenure_days = Number(tenure ?? investment_period);
            logger.debug(`Requested Tenure (days): ${requested_tenure_days}, Payout Frequency: ${payout_frequency} for Product ID: ${product_id} and amount: ${investment_amount}`);

            if (!Number.isFinite(requested_tenure_days) || requested_tenure_days <= 0) {
                throw new AppError("Invalid tenure/investment_period", 400, "INVALID_TENURE");
            }

            const matched_rate = await fd_service.get_fd_interest_rate({
                product_id,
                payout_frequency: payout_frequency as FdPayoutFrequency,
                tenure_days: requested_tenure_days,
            });
            if (!matched_rate) {
                throw new AppError("Selected payout frequency and tenure are not available for this product", 400, "FD_RATE_NOT_AVAILABLE");
            }


            const { id } = fd_product;
            const fd_transaction = await fd_transaction_service.create_transaction({
                user: { connect: { id: user_id } },
                issuer_id: fd_product.issuer_id,
                product: { connect: { id: product_id } },
                amount: investment_amount,
                payout_frequency: payout_frequency as FdPayoutFrequency,
                tenure_at_booking: requested_tenure_days,
                roi_at_booking: matched_rate.interest_rate,
            })

            const encrypted_text = this.create_encryption_text(user?.phone_no)

            const response = await fd_transaction_service.create_transaction_with_purchase_url({
                id,
                jid: fd_transaction.id,
                investment_amount,
                payout_frequency,
                investment_period, encrypted_text
            })


            logger.debug("Purchase URL response from Blostem: ", response);

            res.status(200).json({
                success: true,
                message: "Purchase URL created successfully",
                data: response
            });
            return;


        } catch (error) {
            logger.error("Error in create_purchase_url: ", error);
            next(error);
            return;
        }
    }


    create_redirect_url = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user_id = req.user?.id! as string;
            logger.info(`Creating purchase URL for User ID: ${user_id}...`);

            const { fd_trans_id, event } = req.body;

            const fd_transaction = await fd_transaction_service.get_user_fd_transaction_by_id(fd_trans_id, user_id);

            if (!fd_transaction) {
                logger.error(`FD Transaction with ID ${fd_trans_id} not found for User ID ${user_id}`);
                throw new AppError("FD Transaction not found", 404, "FD_TRANSACTION_NOT_FOUND");
            }
            const token = await job_controller.get_redirect_blostem_token();

            logger.info(`User phone number for FD Transaction ID ${fd_trans_id}: ${fd_transaction.user?.phone_no}`);
            const encrypted_text = this.create_encryption_text(fd_transaction.user?.phone_no);

            logger.debug(`Creating redirect URL for FD Transaction ID: ${fd_trans_id}, Event: ${event}, User ID: ${user_id} and token from job_controller: ${token} and the encrypted text: ${encrypted_text}`);

            const redirect_res = await fd_transaction_service.create_redirect_url({
                jid: fd_transaction.id,
                event: event as 'VKYC' | 'PAYMENT',
                encrypted_text,
                token
            });
            logger.debug("Redirect URL response from Blostem: ", redirect_res);

            res.status(200).json({
                success: true,
                message: "Redirect URL created successfully",
                data: redirect_res
            });
            return;

        } catch (error) {
            logger.error("Error in create_redirect_url: ", error);
            next(error);
            return;
        }
    }



    get_user_fd_transaction_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id! as string;
            const transaction_id = req.params.transaction_id as string;

            logger.info(`Fetching FD Transaction with ID ${transaction_id} for User ID ${user_id}...`);

            const transaction = await user_service.get_user_fd_transaction_by_id({ user_id, transaction_id });

            if (!transaction) {
                logger.warn(`FD Transaction with ID ${transaction_id} not found for User ID ${user_id}`);
                throw new AppError("FD Transaction not found", 404, "FD_TRANSACTION_NOT_FOUND");
            }

            res.status(200).json({
                success: true,
                message: "FD Transaction retrieved successfully",
                data: transaction
            });
            return;

        } catch (error) {
            logger.error("Error in get_user_fd_transaction_by_id: ", error);
            next(error);
            return;
        }
    }

    get_customer_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const mobile = String(req.query.mobile ?? "").trim();

            if (!mobile) {
                throw new AppError("mobile query param is required", 400, "MOBILE_REQUIRED");
            }

            const user = await user_service.get_user_by_phone(mobile);

            if (!user) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            const primary_bank = user.user_bank_details?.find((bank) => bank.is_primary) || user.user_bank_details?.[0];
            const kyc_identity = user.mfKycIdentities;

            const bank_payload = this.omit_empty({
                user: {
                    name: user.full_name,
                    mobileNumber: user.phone_no,
                }
            });


            // {
            //     "status": "Ok",
            //         "message": "Success",
            //             "user": {
            //         "name": "",
            //             "email": "",
            //                 "mobileNumber": "",
            //                     "pan": "CBGPT9606L",
            //                         "dob": "2003-02-05"
            //     }
            // }

            const nbfc_payload = this.omit_empty({
                user: {
                    name: user.full_name,
                    fatherName: kyc_identity?.father_name,
                    email: user.email || kyc_identity?.email_id,
                    mobileNumber: user.phone_no,
                    pan: kyc_identity?.pan_no,
                    dob: this.to_dd_mm_yyyy(user.dob) || kyc_identity?.dob,
                },
                personalDetails: {
                    maritalStatus: kyc_identity?.marital_status,
                    gender: kyc_identity?.gender,
                    // TODO: salutation is not stored in current DB models; will map once source is available.
                    salutation: undefined,
                },
                bankAccount: {
                    accountNo: primary_bank?.account_no,
                    ifscCode: primary_bank?.ifsc_code,
                    bankName: primary_bank?.bank_name,
                    // TODO: branchName is not stored in current DB models; will map once source is available.
                    branchName: undefined,
                },
                kyc: {
                    timestamp: kyc_identity?.updatedAt?.getTime(),
                    uid: kyc_identity?.uid,
                    name: kyc_identity?.full_name,
                    photoUrl: kyc_identity?.digilocker_photo_url,
                    dob: kyc_identity?.dob,
                    gender: kyc_identity?.gender,
                    addressLine1: kyc_identity?.address_line,
                    addressLine2: kyc_identity?.full_address,
                    city: kyc_identity?.city,
                    state: kyc_identity?.state,
                    pincode: kyc_identity?.pincode,
                    locality: kyc_identity?.district,
                    landmark: kyc_identity?.land_mark,
                }
            });

            res.status(200).json({

                status: "Ok",
                message: "Success",
                user: {
                    name: user.full_name,
                    email: user.email || kyc_identity?.email_id,
                    mobileNumber: user.phone_no,
                    pan: kyc_identity?.pan_no,
                    dob: this.to_dd_mm_yyyy(user.dob) || kyc_identity?.dob,
                },
                // data: {
                //     bank: bank_payload,
                //     nbfc: nbfc_payload,
                // }
            });
            return;
        } catch (error) {
            logger.error("Error in get_customer_details: ", error);
            next(error);
            return;
        }
    }



    // Fetch public data of FDs for a user with pagination and filtering
    get_fds = async (req: Request, res: Response, next: NextFunction) => {
        try {

        const raw_query = req.query as Record<string, unknown>;
        const { query, order, pagination, interest_rate_filter } = get_fd_search_query(raw_query);


        const should_use_cache = pagination.page === 1;
        logger.debug(`FD products request - Page: ${pagination.page}, Limit: ${pagination.limit}, Using Cache: ${should_use_cache}`);
        const cache_key = should_use_cache ? build_fd_list_cache_key(raw_query) : "";

        logger.debug("Cache key for FD products: ", cache_key);

        if (should_use_cache) {
            const cached = await redis_buffer_client.get(cache_key);

            if (cached) {
                logger.debug(`FD products cache hit for key: ${cache_key}`);
                const cached_data = await decompress_json<any>(cached as Buffer);


                logger.debug("Cached FD products data: ", cached_data);
                res.status(200).json({
                    success: true,
                    message: "FD products fetched successfully",
                    data: cached_data,
                });
                return;
            }

            logger.debug(`FD products cache miss for key: ${cache_key}`);
        } else {
            logger.debug(`FD products cache bypass for page: ${pagination.page}`);
        }

        logger.debug("FD products search query - ", { query, order, pagination, interest_rate_filter });
        const data = await fd_service.get_fd_products({ pagination, order, query, interest_rate_filter });

        if (should_use_cache) {
            const compressed = await compress_json(data);
            await redis_buffer_client.set(cache_key, compressed, { EX: 300 });
        }

        res.status(200).json({
            success: true,
            message: "FD products fetched successfully",
            data,
        });
        return;

    } catch (error) {
        logger.error("Error in get_fds: ", error);
        next(error);
        return;
    }
}



    get_fd_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const fd_id = req.params.fd_id as string;
            const payout_frequency = this.normalize_payout_frequency(req.query.payout_frequency as string | undefined);
            const customer_type = this.normalize_customer_type(req.query.customer_type as string | undefined);

        logger.info(`Fetching FD Product with ID ${fd_id}, payout_frequency: ${payout_frequency}, customer_type: ${customer_type}`);

        const fd_product = await fd_service.get_fd_details({
            id: fd_id,
            payout_frequency,
            customer_type,
        });

        if (!fd_product) {
            logger.warn(`FD Product with ID ${fd_id} not found`);
            throw new AppError("FD Product not found", 404, "FD_PRODUCT_NOT_FOUND");
        }

        res.status(200).json({
            success: true,
            message: "FD Product retrieved successfully",
            data: fd_product
        });
        return;

    } catch (error) {
        logger.error("Error in get_fd_by_id: ", error);
        next(error);
        return;
    }
}
}
export const fd_controller = new FdControllerClass();