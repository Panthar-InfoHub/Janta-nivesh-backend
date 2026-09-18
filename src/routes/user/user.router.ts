import { Router } from "express";
import multer from "multer";
import { mf_transaction_controller } from "../../controller/mf-transaction.controller.js";
import { notification_controller } from "../../controller/notification.controller.js";
import { user_controller } from "../../controller/user.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

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
user_router.get("/all", user_controller.get_all_user)
user_router.get("/portfolio", login_require, user_controller.get_user_portfolio)


// Authenticated user transaction history (lumpsum, SIP, redemption, switch)
// GET /api/v2/mf/transactions?plan_type=PURCHASE&systematic=true&page=1&limit=20
user_router.get("/orders", login_require, mf_transaction_controller.get_user_transactions);







user_router.get("/notifications", login_require, notification_controller.get_notifications)
user_router.get("/notifications/unread-status", login_require, notification_controller.get_unread_status)
user_router.patch("/notifications/read", login_require, notification_controller.mark_all_read)
user_router.patch("/notifications/:id/read", login_require, notification_controller.mark_notification_read)
user_router.get("/portfolio/{*folio_id}", login_require, user_controller.get_folio_details)
user_router.get("/investment-rate", login_require, user_controller.get_investment_rate)
// user_router.get("/cart", login_require, user_controller.get_user_cart)
user_router.get("/pending-orders", login_require, user_controller.get_pending_orders)

user_router.patch("/", login_require, user_controller.patch_user)

user_router.post("/verify-mpin", login_require, user_controller.verify_mpin)

user_router.get("/fd-transactions", login_require, user_controller.get_user_fd_transactions)
