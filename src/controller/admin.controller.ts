import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { generate_JWT } from "../middleware/jwt.js";
import { admin_login_schema, mf_product_import_schema } from "../lib/zod-schemas/admin.schema.js";
import { user_service } from "../services/user.service.js";
import { user_onboarding_service } from "../services/kyc/user.onboarding.service.js";
import { mf_product_service } from "../services/mutual-funds/mf-product.service.js";

import * as fs from 'fs';
import path from "path";
import { db } from "../server.js";

class AdminControllerClass {

    /**
     * Development-only login that skips the OTP entirely and returns the same payload as
     * POST /api/v2/auth/validate-otp, so the client can point at either URL unchanged.
     *
     * Gated twice over: the router only mounts when ENVIRONMENT === "dev" (server.ts), and
     * admin_require checks the x-admin-secret header on top of that.
     */
    admin_login = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { email, phone_no, fcm_token } = admin_login_schema.parse(req.body);

            logger.warn("ADMIN OTP-BYPASS LOGIN used", { email, phone_no, ip: req.ip });

            // phone_no is the primary identity and the only field create_user needs, so a fresh
            // test user can be conjured in one call. An email that no user owns can't create a
            // valid row - phone_no is @unique and goes into the JWT payload - and inventing a
            // placeholder number would leave junk rows that collide with a later real signup.
            // Typed to just what's used downstream (id, plus phone_no for the JWT payload) so the
            // differing include shapes of the two lookups and create_user all satisfy it.
            let user: { id: string; phone_no: string | null } | null = phone_no
                ? await user_service.get_user_by_phone(phone_no)
                : await user_service.get_user_by_email(email!);

            if (!user && phone_no) {
                logger.info("Admin login creating a new user for an unseen phone number", { phone_no });
                user = await user_service.create_user({ phone_no });
            }

            if (!user) {
                throw new AppError("User not found, sign up first", 404, "USER_NOT_FOUND");
            }

            const refresh_token = generate_JWT(user, "30d");

            const updated_user = await user_service.update_user(user.id, {
                refresh_token,
                fcm_token,
            });

            const token = generate_JWT(updated_user);

            // Deliberately not firing the Zoho USER_SIGNUP_COMPLETED webhook or the login push
            // notification that auth_validate_otp sends - both are outward-facing, and firing
            // them on every test login pollutes the CRM and spams devices.

            const onboarding = await user_onboarding_service.get_status_summary(updated_user.id);

            res.status(200).json({
                success: true,
                message: "Admin login successful",
                data: {
                    user: {
                        user_id: updated_user.id,
                        phone_no: updated_user.phone_no,
                    },
                    onboarding,
                    token: token,
                    refresh_token: refresh_token
                }
            });
            return;
        } catch (error) {
            logger.error("Error in admin_login:", error);
            next(error);
            return;
        }
    }

    /**
     * Bulk-inserts/updates the curated Cybrilla/FP ISIN list. Runs in production (see
     * admin.router.ts - no dev_only_require here, unlike /login), so this is a real ops tool,
     * not a testing shortcut. Upserts by isin (unique on MfProduct) - safe to re-run.
     */
    import_mf_products = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const filePath = path.join(process.cwd(), 'extras/output_new.json');
            logger.debug(`Starting mf product migration from file: ${filePath}`);

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(fileContent);

            logger.info(`Total records to insert in mf product: ${data.length}`);

            let successCount = 0;
            let skipCount = 0;
            const failedIds: string[] = [];

            // Process EVERYTHING now, no slicing.
            for (const row of data) {
                logger.debug(`Total success count - ${successCount} where row is --> `, row)
                try {
                    await db.mfProduct.upsert({
                        where: { isin: row.isin },
                        update: {
                            name: row.name
                        },
                        create: {
                            isin: row.isin,
                            name: row.name
                        }
                    });
                    successCount++;

                    if (successCount % 500 === 0) {
                        logger.info(`✔ Progress: ${successCount} records upserted...`);
                    }
                } catch (err: any) {
                    // We catch the error but DON'T 'throw' it.
                    // This allows the loop to move to the next record.
                    logger.error(`Error inserting row ${row.isin}:`, err);
                    skipCount++;
                    failedIds.push(row.id);
                }
            }

            logger.info(`\n Data upsertion finished! 🎉`);
            logger.info(`✅ Successfully upserted: ${successCount}`);
            logger.info(`!!!!! Failed to upsert: ${skipCount}`);

            if (failedIds.length > 0) {
                logger.warn(`Failed IDs: ${failedIds.slice(0, 5).join(', ')}`);
            }

            res.status(200).json({
                success: true,
                message: "MF products imported",
            });
            return;
        } catch (error) {
            logger.error("Error in import_mf_products:", error);
            next(error);
            return;
        }
    }

    import_mf_sub_category = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const filePath = path.join(process.cwd(), 'extras/cat_output.json');
            logger.debug(`Starting mf product migration from file: ${filePath}`);

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(fileContent);

            logger.info(`Total records to insert in mf scheme plan sub category: ${data.length}`);

            let successCount = 0;
            let skipCount = 0;
            const failedIds: string[] = [];

            // Process EVERYTHING now, no slicing.
            for (const row of data) {
                logger.debug(`Total success count - ${successCount} where row is --> `, row)
                try {
                    await db.mfSchemePlan.updateMany({
                        where: { isin: row.isin },
                        data: {
                            sub_category: row.display_category
                        },
                    });
                    successCount++;

                    if (successCount % 500 === 0) {
                        logger.info(`✔ Progress: ${successCount} records upserted...`);
                    }
                } catch (err: any) {
                    // We catch the error but DON'T 'throw' it.
                    // This allows the loop to move to the next record.
                    logger.error(`Error updating sub categories ${row.isin}:`, err);
                    skipCount++;
                    failedIds.push(row.isin);
                }
            }

            logger.info(`\n Data updated finished! 🎉`);
            logger.info(`✅ Successfully updated: ${successCount}`);
            logger.info(`!!!!! Failed to updated: ${skipCount}`);

            if (failedIds.length > 0) {
                logger.warn(`Failed IDs: ${failedIds.slice(0, 5).join(', ')}`);
            }

            res.status(200).json({
                success: true,
                message: "MF scheme plan sub category updated",
            });
            return;
        } catch (error) {
            logger.error("Error in import_mf_products:", error);
            next(error);
            return;
        }
    }
}

export const admin_controller = new AdminControllerClass();
