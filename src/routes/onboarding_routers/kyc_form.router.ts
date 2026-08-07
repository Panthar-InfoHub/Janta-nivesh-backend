import { Router } from "express";
import multer from "multer";
import { kyc_form_controller } from "../../controller/onboarding/kyc_form.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const kyc_form_router = Router();

// Multer: hold signature file in-memory, forward straight to Cybrilla (no disk write)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max, per Cybrilla's signature upload limit
    fileFilter: (_req, file, cb) => {
        const allowed = ["image/png", "image/jpeg", "application/pdf"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only PNG, JPG/JPEG, or PDF files are accepted"));
        }
    },
});

kyc_form_router.post("/", login_require, kyc_form_controller.initiate_kyc_form);
kyc_form_router.get("/status", login_require, kyc_form_controller.check_kyc_form_status);
kyc_form_router.patch("/", login_require, kyc_form_controller.update_kyc_form_details);
kyc_form_router.post("/retry-proof-fetch", login_require, kyc_form_controller.retry_proof_fetch);
kyc_form_router.post("/signature", login_require, upload.single("file"), kyc_form_controller.upload_signature);
