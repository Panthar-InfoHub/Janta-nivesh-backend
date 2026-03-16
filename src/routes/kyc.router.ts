import { Router } from "express";
import { kyc_controller } from "../controller/kyc/kyc.controller.js";
import { login_require } from "../middleware/session.middleware.js";
import { trading_account_controller } from "../controller/kyc/trading.account.controller.js";
import { require_mfKyc } from "../middleware/kyc.middleware.js";

export const kyc_router = Router();

kyc_router.post("/mf-initiate", login_require, kyc_controller.initiate_kyc)
kyc_router.post("/mf-details", login_require, kyc_controller.user_digiliocker_data)
kyc_router.post("/mf-update", login_require, kyc_controller.update_kyc_data)
kyc_router.patch("/mf-doc", login_require, kyc_controller.update_doc)
kyc_router.post("/mf-contract", login_require, kyc_controller.create_contract)
kyc_router.get("/mf-verify", login_require, kyc_controller.verify_kyc)


// Trading account specific routes
kyc_router.get("/pan-verify", login_require, trading_account_controller.pan_verification)
kyc_router.post("/trading-account", login_require, require_mfKyc, trading_account_controller.create_trading_account) // Client registration API for NSE trading account creation
kyc_router.post("/trading-confirmation", login_require, require_mfKyc, trading_account_controller.confirm_trading_account) // Mark user as verified after successful client activation