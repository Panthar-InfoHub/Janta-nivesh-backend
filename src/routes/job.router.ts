import { Router } from "express";
import { job_controller } from "../controller/job.controller.js";

export const job_router = Router();

// mf-daily removed - replaced by POST /api/v2/admin/mf-product-import (curated JSON list) plus
// the FP scheme-plan sync below. mf-single-nav/:id is gone, superseded by the mfapi jobs.
//
// NAV pipeline, in order:
//   1. POST /api/v2/admin/mf-product-import  - curated CSV/JSON -> MfProduct (name + isin)
//   2. POST /api/v1/jobs/mf-scheme-code-sync - match our isin against mfapi's master list to
//      learn each fund's scheme_code. Occasional; one bulk fetch of ~40k rows.
//   3. POST /api/v1/jobs/mf-nav-history      - one-time seed: each fund's FULL history from mfapi
//      into MfNavHistory. Without this the metrics job has no lookback and every return_* is null.
//   4. POST /api/v1/jobs/mf-nav-daily        - per-fund latest NAV -> MfProduct.latest_nav +
//      an MfNavHistory point. Daily; appends on top of the seed above.
//   5. POST /api/v1/jobs/mf-metrics-calc     - derives MfMetrics from the NAV history.
job_router.post("/mf-scheme-code-sync", job_controller.mf_scheme_code_sync_job);
job_router.post("/mf-nav-history", job_controller.mf_nav_history_job);
job_router.post("/mf-nav-daily", job_controller.mf_nav_daily_job);
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
job_router.post("/mf-scheme-plan-sync", job_controller.mf_scheme_plan_sync_job);

// Enrichment pass over the rows the job above creates, from FP's OLDER /api/oms/fund_schemes
// endpoint. Both are needed - neither response is a superset of the other:
//   v2 (above) -> daily-SIP and SWP thresholds, which v1 doesn't return
//   v1 (here)  -> fund_category / sub_category, the real switch_in/switch_out limits, STP data,
//                 and the quarterly/half-yearly/yearly SIP frequencies v2 never sends
// The two jobs write disjoint columns (see mutual-fund.prisma), so order between them only
// matters in that this one skips any ISIN the v2 job hasn't created a row for yet.
// Note: fund_category/sub_category give the group (Equity/Debt/Liquid) and coarse labels
// (ELSS/FMP/FOF) - NOT the large/mid/flexi cap classification, which still has no source.
job_router.post("/mf-scheme-v1-sync", job_controller.mf_scheme_v1_sync_job);

// Portfolio numbers (units, current value, XIRR) - synced from FP's Investor Reports into
// MfHolding, not computed from MfTransactionPlan (see mf-holding.prisma for why: a fund can have
// several MfTransactionPlan rows - a SIP and a later lumpsum on the same folio - but only one real
// current balance). Nightly backstop; controllers should also call
// mf_holding_sync_service.sync_account right after a transaction succeeds, not wired up yet.
job_router.post("/mf-holdings-sync", job_controller.mf_holding_sync_job);