import { Router } from "express";
import { login_require } from "../middleware/session.middleware.js";
import { fd_controller } from "../controller/fd.controller.js";

export const fd_router = Router();

fd_router.get("/", fd_controller.get_fds)
fd_router.get("/customer-details", fd_controller.get_customer_details)


fd_router.post("/purchase-url", [login_require], fd_controller.create_purchase_url)



// Fd Transaction routes :
fd_router.get("/transactions/:transaction_id", [login_require], fd_controller.get_user_fd_transaction_by_id);
fd_router.get("/:fd_id", fd_controller.get_fd_by_id)