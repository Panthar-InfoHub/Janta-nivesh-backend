import { Router } from "express";
import { user_loan_controller } from "../../controller/user.loan.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const user_loan_router = Router();

user_loan_router.post("/", login_require, user_loan_controller.create);
user_loan_router.patch("/:loan_id", login_require, user_loan_controller.update);
user_loan_router.get("/", login_require, user_loan_controller.get_all);
user_loan_router.get("/:loan_id", login_require, user_loan_controller.get_loan_by_id);
user_loan_router.delete("/:loan_id", login_require, user_loan_controller.delete);