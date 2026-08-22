import { Router } from "express";

import { mf_redemption_controller } from "../controller/mf-redemption.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mf_redemption_router = Router();

mf_redemption_router.post(
    "/",
    login_require,
    mf_redemption_controller.create_redemption,
);

mf_redemption_router.get(
    "/:id",
    login_require,
    mf_redemption_controller.fetch_redemption,
);

mf_redemption_router.post(
    "/:id/confirm/request-otp",
    login_require,
    mf_redemption_controller.request_confirmation_otp,
);

mf_redemption_router.post(
    "/:id/confirm/verify-otp",
    login_require,
    mf_redemption_controller.verify_confirmation_otp,
);