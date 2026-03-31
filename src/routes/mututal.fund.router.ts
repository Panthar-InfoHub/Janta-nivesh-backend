import { Router } from "express";
import { mutual_fund_controller } from "../controller/mutual-fund.controller.js";
import { login_require } from "../middleware/session.middleware.js";
import { require_mfKyc, require_tradingKyc } from "../middleware/kyc.middleware.js";

export const mututal_fund_router = Router();

mututal_fund_router.get("/", mutual_fund_controller.get_mutual_funds);
mututal_fund_router.get("/history/:id", mutual_fund_controller.get_mutual_fund_history);
mututal_fund_router.get("/:id", mutual_fund_controller.get_mutual_fund_by_id);


// Add Mutualfunds to cart
mututal_fund_router.post("/lumpsum-cart",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.add_to_lumpsum_cart
);
mututal_fund_router.post("/sip-cart",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.add_to_sip_cart
);

// Purchasing Mutualfunds
mututal_fund_router.post("/purchase-lumpsum",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.purchase_lumpsum
);
mututal_fund_router.post("/purchase-sip",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.purchase_sip
);

// Redeeming Mutualfunds
mututal_fund_router.post("/redeem",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.redeem
);