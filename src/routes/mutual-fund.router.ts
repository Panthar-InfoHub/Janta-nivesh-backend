import { Router } from "express";
import { mutual_fund_controller } from "../controller/mutual-fund.controller.js";
import { login_require } from "../middleware/session.middleware.js";
import { require_mfKyc, require_tradingKyc } from "../middleware/kyc.middleware.js";

export const mutual_fund_router = Router();

mutual_fund_router.get("/", mutual_fund_controller.get_mutual_funds);
mutual_fund_router.get("/history/:id", mutual_fund_controller.get_mutual_fund_history);
mutual_fund_router.get("/:id", mutual_fund_controller.get_mutual_fund_by_id);


// Add Mutualfunds to cart
mutual_fund_router.post("/lumpsum-cart",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.add_to_lumpsum_cart
);
mutual_fund_router.post("/sip-cart",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.add_to_sip_cart
);

// Add bundle to cart
mutual_fund_router.post("/bundle-cart",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.add_bundle_to_cart
);


mutual_fund_router.delete("/remove-cart-item",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.remove_item_from_cart
);

// Purchasing Mutualfunds
mutual_fund_router.post("/purchase-lumpsum",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.purchase_lumpsum
);
mutual_fund_router.post("/purchase-sip",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.purchase_sip
);

// Redeeming Mutualfunds
mutual_fund_router.post("/redeem",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.redeem
);