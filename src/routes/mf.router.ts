import { Router } from "express";
import { mf_purchase_router } from "./mf-purchase.router.js";
import { mf_purchase_plan_router } from "./mf-purchase-plan.router.js";
import { mf_redemption_plan_router } from "./mf-redemption-plan.router.js";
import { mf_switch_plan_router } from "./mf-switch-plan.router.js";
import { mf_redemption_router } from "./mf-redemption.router.js";
import { mf_catalogue_controller } from "../controller/mf-catalogue.controller.js";

export const mf_router = Router();

mf_router.use("/purchase", mf_purchase_router);
mf_router.use("/purchase-plan", mf_purchase_plan_router);
mf_router.use("/redemption-plan", mf_redemption_plan_router);
mf_router.use("/switch-plan", mf_switch_plan_router);
mf_router.use("/redemption", mf_redemption_router);


// ------------------------ Mutual Fund Routes -----------------------------

// Public (no login_require) - fund discovery happens before onboarding.
// GET /api/v2/mf/funds?tag=popular&page=1&limit=5   ("see all" behind each home-screen carousel)
mf_router.get("/funds", mf_catalogue_controller.get_funds_by_tag);