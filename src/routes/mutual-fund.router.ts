import { Router } from "express";
import { mutual_fund_controller } from "../controller/mutual-fund.controller.js";
import { login_require } from "../middleware/session.middleware.js";
import { require_mfKyc, require_tradingKyc } from "../middleware/kyc.middleware.js";

export const mutual_fund_router = Router();

mutual_fund_router.get("/", mutual_fund_controller.get_mutual_funds);
mutual_fund_router.get("/history/:id", mutual_fund_controller.get_mutual_fund_history);



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

mutual_fund_router.delete("/clear-cart",
    [login_require],
    mutual_fund_controller.clear_cart
);

// Purchasing Mutualfunds
mutual_fund_router.post("/purchase-lumpsum",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.purchase_lumpsum
);



// SIP purchase flow : mandate registration -> mandate approval by user ==> SIP purchase execution
mutual_fund_router.post("/initiate-sip",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.initiate_sip
);

mutual_fund_router.get("/mandate-status",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.mandate_status
);

// Execute xSIP purchase after mandate approval
mutual_fund_router.post("/purchase-sip",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.purchase_sip
);

mutual_fund_router.post("/invest-more",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.invest_more
);

// Redeeming Mutualfunds
mutual_fund_router.post("/redeem",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.redeem
);

// Cancellation APIs
mutual_fund_router.post("/cancel-order",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.cancel_order
);

mutual_fund_router.post("/cancel-xsip",
    [login_require, require_mfKyc, require_tradingKyc],
    mutual_fund_controller.cancel_xsip
);

mutual_fund_router.get("/:id", mutual_fund_controller.get_mutual_fund_by_id);