import { Router } from "express";
import { mf_purchase_router } from "./mf-purchase.router.js";
import { mf_purchase_plan_router } from "./mf-purchase-plan.router.js";
import { mf_redemption_plan_router } from "./mf-redemption-plan.router.js";
import { mf_switch_plan_router } from "./mf-switch-plan.router.js";
import { mf_switch_router } from "./mf-switch.router.js";

export const mf_router = Router();

mf_router.use("/purchase", mf_purchase_router);
mf_router.use("/purchase-plan", mf_purchase_plan_router);
mf_router.use("/redemption-plan", mf_redemption_plan_router);
mf_router.use("/switch-plan", mf_switch_plan_router);
mf_router.use("/switch", mf_switch_router);