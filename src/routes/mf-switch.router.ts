import { Router } from "express";
import { login_require } from "../middleware/session.middleware.js";
import { mf_switch_controller } from "../controller/mf-switch.controller.js";

export const mf_switch_router = Router();

mf_switch_router.post(
    "/",
    login_require,
    mf_switch_controller.create_switch,
);

mf_switch_router.get(
    "/",
    login_require,
    mf_switch_controller.get_switches,
);

mf_switch_router.get(
    "/:id",
    login_require,
    mf_switch_controller.fetch_switch,
);

mf_switch_router.post(
    "/:id/confirm/request-otp",
    login_require,
    mf_switch_controller.request_confirmation_otp,
);

mf_switch_router.post(
    "/:id/confirm/verify-otp",
    login_require,
    mf_switch_controller.verify_confirmation_otp,
);