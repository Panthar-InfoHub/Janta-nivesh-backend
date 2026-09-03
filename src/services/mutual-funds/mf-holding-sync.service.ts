import logger from "../../middleware/logger.js";
import { db } from "../../server.js";
import { fintech_primitive_mf_reports_service } from "../fintech-primitive/mf_reports.service.js";

// Builds MfHolding - our own durable "what does this user currently own" table - from FP's
// Investor Reports. FP is the source of truth for the numbers; this is a synced copy, not a live
// read, so portfolio screens never wait on FP and keep working if FP is briefly slow or down.
//
// Refreshed two ways: call sync_account right after any of our own controllers changes a
// transaction for that account (so the acting user sees correct numbers immediately - not wired
// up yet, left for the controllers themselves to call), and once nightly for every account via
// job.service.ts's mf_holding_sync_job, which catches settlement that happens without the user
// touching the app.
class MfHoldingSyncServiceClass {

    sync_account = async (user_id: string, mf_investment_account: string, investment_account_old_id: number) => {
        logger.info("Syncing MF holdings", { user_id, mf_investment_account, investment_account_old_id });

        const [folios, scheme_returns] = await Promise.all([
            fintech_primitive_mf_reports_service.get_holdings(investment_account_old_id),
            // Best-effort - a failure here shouldn't block the per-folio numbers below, it just
            // means xirr stays whatever it was (or null on first sync).
            fintech_primitive_mf_reports_service.get_scheme_wise_returns(mf_investment_account)
                .catch((error) => {
                    logger.warn("scheme-wise returns fetch failed, continuing without xirr", {
                        user_id, mf_investment_account, error: error?.message,
                    });
                    return [];
                }),
        ]);

        // Keyed by isin, not (folio, isin) - FP doesn't split xirr any finer than the scheme
        // level (see the FP client's comment), so a scheme held in two folios gets the same value.
        const xirr_by_isin = new Map<string, number | null>(
            scheme_returns.map((r) => [r.isin, r.xirr ?? null] as [string, number | null])
        );

        let synced = 0;
        for (const folio of folios) {
            for (const scheme of folio.schemes) {
                const units = scheme.holdings?.units ?? 0;
                const invested_amount = scheme.invested_value?.amount ?? 0;
                const current_value = scheme.market_value?.amount ?? 0;

                const product = await db.mfProduct.findUnique({
                    where: { isin: scheme.isin },
                    select: { id: true },
                });

                // One flat object for both branches (same shape mf-transaction-plan.service.ts's
                // upsert_from_fp uses) - splitting the identity fields (user_id, folio_number,
                // isin) into a separate outer literal and spreading the rest in breaks Prisma's
                // create/update type inference.
                const data = {
                    user_id,
                    mf_investment_account,
                    folio_number: folio.folio_number,
                    isin: scheme.isin,
                    fund_name: scheme.name ?? null,
                    mf_product_id: product?.id ?? null,
                    units,
                    redeemable_units: scheme.holdings?.redeemable_units ?? null,
                    nav: scheme.nav?.value ?? null,
                    nav_as_on: scheme.nav?.as_on ? new Date(scheme.nav.as_on) : null,
                    invested_amount,
                    current_value,
                    unrealized_gain: current_value - invested_amount,
                    absolute_return: invested_amount > 0
                        ? ((current_value - invested_amount) / invested_amount) * 100
                        : null,
                    avg_nav: units > 0 ? invested_amount / units : null,
                    xirr: xirr_by_isin.get(scheme.isin) ?? null,
                    raw_response: scheme as any,
                    synced_at: new Date(),
                };

                await db.mfHolding.upsert({
                    where: {
                        mf_investment_account_folio_number_isin: {
                            mf_investment_account,
                            folio_number: folio.folio_number,
                            isin: scheme.isin,
                        },
                    },
                    create: data,
                    update: data,
                });
                synced++;
            }
        }

        logger.info("MF holdings sync completed", { user_id, mf_investment_account, synced });
        return { folios: folios.length, holdings_synced: synced };
    };
}

export const mf_holding_sync_service = new MfHoldingSyncServiceClass();
