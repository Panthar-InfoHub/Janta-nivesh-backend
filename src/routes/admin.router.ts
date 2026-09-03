import { Router } from "express";
import { admin_controller } from "../controller/admin.controller.js";
import { admin_require, dev_only_require } from "../middleware/admin.middleware.js";

export const admin_router = Router();

// Mints auth tokens without an OTP - dev_only_require on top of the usual secret-header check,
// unlike the rest of this router.
admin_router.post("/login", admin_controller.admin_login);

// Bulk-inserts/updates the curated ISIN list (Excel -> JSON, converted externally). Runs in
// production, so admin_require's secret header is the only gate - no dev_only_require.
admin_router.post("/mf-product-import", admin_controller.import_mf_products);

admin_router.post("/mf-sub-category-import", admin_controller.import_mf_sub_category);