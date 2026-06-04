import { Router } from "express";
import multer from "multer";
import { login_require } from "../../middleware/session.middleware.js";
import { user_controller } from "../../controller/user.controller.js";
import { cas_report_controller } from "../../controller/cas.report.controller.js";

export const user_router = Router();

// Multer: store PDF in-memory (no temp files on disk)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are accepted"));
        }
    },
});

user_router.get("/", login_require, user_controller.get_user)
user_router.get("/portfolio", login_require, user_controller.get_user_portfolio)
user_router.get("/portfolio/:folio_id", login_require, user_controller.get_folio_details)
user_router.get("/investment-rate", login_require, user_controller.get_investment_rate)
user_router.get("/iin", login_require, user_controller.get_user_iin)
user_router.get("/cart", login_require, user_controller.get_user_cart)
user_router.get("/pending-orders", login_require, user_controller.get_pending_orders)

user_router.patch("/discard-onboard", login_require, user_controller.discard_onboard)
user_router.patch("/", login_require, user_controller.patch_user)

user_router.post("/verify-mpin", login_require, user_controller.verify_mpin)

user_router.get("/fd-transactions", login_require, user_controller.get_user_fd_transactions)

user_router.post("/cas-report", login_require, upload.single("pdf_file"), cas_report_controller.parse_cas_report,)