import { NextFunction, Request, Response } from "express";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { generate_JWT } from "../middleware/jwt.js";
import { admin_login_schema, mf_product_import_schema } from "../lib/zod-schemas/admin.schema.js";
import { user_service } from "../services/user.service.js";
import { user_onboarding_service } from "../services/kyc/user.onboarding.service.js";
import { mf_product_service } from "../services/mutual-funds/mf-product.service.js";

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
            const { products } = mf_product_import_schema.parse(req.body);

            logger.info("Admin MF product import requested", { count: products.length });

            const result = await mf_product_service.bulk_upsert(products);

            logger.info("Admin MF product import completed", result);

            res.status(200).json({
                success: true,
                message: "MF products imported",
                data: result,
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
