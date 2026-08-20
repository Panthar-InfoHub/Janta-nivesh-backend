import { Router } from "express";
import { mf_purchase_router } from "./mf-purchase.router.js";
import { mf_purchase_plan_router } from "./mf-purchase-plan.router.js";
import { mf_redemption_plan_router } from "./mf-redemption-plan.router.js";

export const mf_router = Router();

mf_router.use("/purchase", mf_purchase_router);
mf_router.use("/purchase-plan", mf_purchase_plan_router);
mf_router.use("/redemption-plan", mf_redemption_plan_router);