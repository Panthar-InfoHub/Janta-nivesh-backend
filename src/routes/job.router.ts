import { Router } from "express";
import { job_controller } from "../controller/job.controller.js";

export const job_router = Router();

// mf-daily removed - replaced by POST /api/v2/admin/mf-product-import (curated JSON list) plus
// the per-ISIN sync job TODO'd below. mf-nav-history and mf-single-nav/:id are disabled, not
// removed - both keyed NAV lookups off a Finnsys column (mapping_code) that no longer exists on
// MfProduct; NAV sourcing for the curated catalogue is an explicitly deferred decision. See the
// TODO above job.service.ts's now-commented nav_history_job/process_nav_history/single_nav_history_job.
job_router.post("/mf-metrics-calc", job_controller.mf_metrics_calc_job);
job_router.post("/fd-daily", job_controller.daily_fd_product_sync_job);
job_router.post("/user-snapshot", job_controller.monthly_user_snapshot_job);

// TODO: periodic FP scheme-plan sync. For every MfProduct row (the curated list - small, bounded,
// not "ISINs users viewed"), call fintech_primitive_mf_scheme_service.get_scheme_by_isin(isin) and
// upsert into MfSchemePlan where: { mf_product_id: product.id } (a real required FK now - isin is
// unique on MfProduct, so this is a direct lookup, no ambiguity to resolve).
// Needs a mapper that flattens FP's thresholds[] into the MfSchemePlan columns:
//   type=lumpsum                 -> lumpsum_*
//   type=withdrawal              -> withdrawal_*     (SWP / redeem)
//   type=sip + frequency=daily   -> sip_daily_*
//   type=sip + frequency=monthly -> sip_monthly_*    (incl. the `dates` array)
// A missing entry means that mode is unsupported -> leave its *_allowed false.
// FP has no bulk endpoint - one HTTP call per ISIN, needs rate limiting. Cadence TBD.
// Newly JSON-imported products have no MfSchemePlan row until this runs once.
// job_router.post("/mf-scheme-plan-sync", job_controller.mf_scheme_plan_sync_job);