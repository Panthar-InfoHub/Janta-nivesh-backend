import { Router } from "express";
import { mf_cart_controller } from "../controller/mf-cart.controller.js";
import { mf_cart_checkout_controller } from "../controller/mf-cart-checkout.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_cart_router = Router();

mf_cart_router.get(
    "/",
    login_require,
    mf_cart_controller.get_cart,
);

mf_cart_router.post(
    "/",
    login_require,
    mf_cart_controller.add_to_cart,
);

mf_cart_router.post(
    "/bundle",
    login_require,
    mf_cart_controller.add_bundle_to_cart,
);

mf_cart_router.patch(
    "/:id",
    login_require,
    mf_cart_controller.update_cart_item,
);

mf_cart_router.delete(
    "/:id",
    login_require,
    mf_cart_controller.remove_from_cart,
);

mf_cart_router.delete(
    "/",
    login_require,
    mf_cart_controller.clear_cart,
);

mf_cart_router.post(
    "/checkout/lumpsum",
    login_require,
    mf_cart_checkout_controller.initiate_lumpsum_checkout,
);

mf_cart_router.post(
    "/checkout/lumpsum/confirm",
    login_require,
    mf_cart_checkout_controller.confirm_lumpsum_checkout,
);
