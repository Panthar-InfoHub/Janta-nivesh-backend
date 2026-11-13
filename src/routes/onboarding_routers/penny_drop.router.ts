import { Router } from "express";
import multer from "multer";
import { penny_drop_controller } from "../../controller/onboarding/penny_drop.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const penny_drop_router = Router();

// Multer: hold bank account proof file in-memory, forward directly to Cybrilla (no disk write)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max per Cybrilla Files API
    fileFilter: (_req, file, cb) => {
        const allowed = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only PNG, JPG/JPEG, or PDF files are accepted"));
        }
    },
});

penny_drop_router.get("/prefill", login_require, penny_drop_controller.get_prefill);
penny_drop_router.get("/status", login_require, penny_drop_controller.check_status);
penny_drop_router.get("/", login_require, penny_drop_controller.get_prefill);
penny_drop_router.post("/", login_require, penny_drop_controller.submit_bank_details);
penny_drop_router.post("/manual-verify", login_require, upload.single("file"), penny_drop_controller.manual_verify);
