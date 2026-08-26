import { env } from "../lib/config-env.js";
import { FdCustomerType, FdPayoutFrequency, Prisma } from "../prisma/generated/prisma/client.js";
import { chunkArray, logMemoryUsage } from "../lib/utils.js";
import cuid from 'cuid';
import axios from "axios";
import logger from "../middleware/logger.js";
import { db } from "../server.js";
import pLimit from "p-limit";
import { mfapi_service } from "./mutual-funds/mfapi.service.js";
import { user_snapshot_service } from "./user/user.snapshot.service.js";
import { mf_scheme_plan_sync_service } from "./mutual-funds/mf-scheme-plan-sync.service.js";
import { mf_scheme_v1_sync_service } from "./mutual-funds/mf-scheme-v1-sync.service.js";
import { mf_holding_sync_service } from "./mutual-funds/mf-holding-sync.service.js";

class JobServiceClass {

    monthly_user_snapshot_job = async () => {
        logger.info("Starting monthly user net worth snapshot job...");
        try {
            const result = await user_snapshot_service.capture_all_users_snapshots();
            logger.info(`Monthly snapshot job completed. Results: ${JSON.stringify(result)}`);
            return result;
        } catch (error) {
            logger.error("Error in monthly_user_snapshot_job:", error);
            throw error;
        }
    }

    // daily_mf_product_job (the Finnsys ~30k bulk upsert) was removed as part of the Cybrilla/FP
    // migration - replaced by POST /api/v2/admin/mf-product-import (curated JSON list) and the
    // per-ISIN sync job TODO'd in job.router.ts. Unlike the NAV jobs below, this had a clear,
    // already-decided replacement, so there was nothing worth leaving commented as a breadcrumb.


    mf_scheme_plan_sync_job = async () => {
        logger.info("Starting MF scheme-plan sync job...");

        const products = await db.mfProduct.findMany({
            select: {
                id: true,
                isin: true,
            },
            orderBy: {
                id: "asc",
            },
        });

        logger.info(
            `[MF SCHEME SYNC] Found ${products.length} curated MF products`
        );

        // FP has no bulk endpoint, so limit concurrent requests.
        // The old NAV job used pLimit(2), so use the same conservative limit.
        const limit = pLimit(2);
        let successful = 0;
        let failed = 0;
        const tasks = products.map((product) =>
            limit(async () => {
                try {
                    await mf_scheme_plan_sync_service.sync_by_isin(product.isin);
                    successful++;
                    logger.info(
                        `[MF SCHEME SYNC] Successfully synced ISIN ${product.isin}`);
                } catch (error: any) {
                    failed++;
                    logger.error(
                        `[MF SCHEME SYNC] Failed to sync ISIN ${product.isin}`,
                        {
                            isin: product.isin,
                            error: error?.message,
                        });
                }
            }));
        await Promise.allSettled(tasks);
        const result = {
            total: products.length,
            successful,
            failed,
        };
        logger.info(
            "[MF SCHEME SYNC] Scheme-plan sync job completed",
            result);
        return result;
    };

    /**
     * Fills the v1-owned half of MfSchemePlan (category, switch/STP limits, capability flags) from
     * FP's older /api/oms/fund_schemes endpoint. Runs AFTER mf_scheme_plan_sync_job, which creates
     * the rows this one updates - a fund with no row yet is counted as skipped, not failed, since
     * the next run picks it up once the v2 job has been through.
     */
    mf_scheme_v1_sync_job = async () => {
        logger.info("Starting MF v1 fund-scheme sync job...");

        // Driven off MfSchemePlan, not MfProduct: this job only ever updates existing rows, so a
        // product the v2 sync hasn't reached yet has nothing to update.
        const scheme_plans = await db.mfSchemePlan.findMany({
            select: { isin: true },
            orderBy: { isin: "asc" },
        });

        logger.info(`[MF SCHEME V1 SYNC] Found ${scheme_plans.length} scheme plans to enrich`);

        // Same conservative concurrency as the v2 sync - one HTTP call per ISIN, no bulk endpoint.
        const limit = pLimit(2);
        let successful = 0;
        let failed = 0;
        const tasks = scheme_plans.map((plan) =>
            limit(async () => {
                try {
                    await mf_scheme_v1_sync_service.sync_by_isin(plan.isin);
                    successful++;
                    logger.info(`[MF SCHEME V1 SYNC] Successfully synced ISIN ${plan.isin}`);
                } catch (error: any) {
                    failed++;
                    logger.error(`[MF SCHEME V1 SYNC] Failed to sync ISIN ${plan.isin}`, {
                        isin: plan.isin,
                        error: error?.message,
                    });
                }
            })
        );
        await Promise.allSettled(tasks);

        const result = { total: scheme_plans.length, successful, failed };
        logger.info("[MF SCHEME V1 SYNC] v1 fund-scheme sync job completed", result);
        return result;
    };

    /**
     * Nightly refresh of MfHolding for every account. Same call any of our own controllers should
     * make right after a transaction succeeds (mf-holding-sync.service.ts) - this is the backstop
     * for settlement that happens without the user opening the app (an installment going through,
     * NAV moving). One account with no holdings is a no-op at FP's end, not an error, so this is
     * safe to run against every user with an investment account rather than a filtered subset.
     */
    mf_holding_sync_job = async () => {
        logger.info("Starting MF holdings sync job...");

        const users = await db.user.findMany({
            where: { AND: [{ investment_account: { not: null } }, { investment_account_old_id: { not: null } }] },
            select: { id: true, investment_account: true, investment_account_old_id: true },
        });

        logger.info(`[MF HOLDINGS SYNC] Found ${users.length} users with an investment account`);

        // One user's sync = 2 FP calls (holdings + scheme-wise-returns), not per-fund/per-folio,
        // so this stays cheap even at scale. Same conservative concurrency as the scheme-plan job.
        const limit = pLimit(2);
        let successful = 0;
        let failed = 0;
        const tasks = users.map((user) =>
            limit(async () => {
                try {
                    await mf_holding_sync_service.sync_account(user.id, user.investment_account!, user.investment_account_old_id);
                    successful++;
                } catch (error: any) {
                    failed++;
                    logger.error(`[MF HOLDINGS SYNC] Failed to sync user ${user.id}`, {
                        user_id: user.id,
                        error: error?.message,
                    });
                }
            })
        );
        await Promise.allSettled(tasks);

        const result = { total: users.length, successful, failed };
        logger.info("[MF HOLDINGS SYNC] Holdings sync job completed", result);
        return result;
    };

    daily_fd_job = async (token: string) => {
        try {

            const api_res = env.ENVIRONMENT === "dev"
                ? await axios.get(`${env.BLOSTEM_MASTER_URL}/binvestt/portal/fixed-deposit/templates`, {
                    headers: { 'x-partner-token': token },
                    timeout: 15000
                }).then(res => res.data)
                : await axios.get(`https://binvestt-api.blostem.com/portal/fixed-deposit/templates`, {
                    headers: { 'x-partner-token': token },
                    timeout: 15000
                }).then(res => res.data)

            const api_data: any[] = api_res.data?.data ?? [];

            // 1. Frequency Mapper to handle API typos like "ANNUALY"
            const frequencyMap: Record<string, FdPayoutFrequency> = {
                'ANNUALY': 'YEARLY',
                'ANNUALLY': 'YEARLY',
                'YEARLY': 'YEARLY',
                'MONTHLY': 'MONTHLY',
                'QUARTERLY': 'QUARTERLY',
                'HALF_YEARLY': 'HALF_YEARLY',
                'HALFYEARLY': 'HALF_YEARLY',
                'CUMULATIVE': 'CUMULATIVE',
                'ON_MATURITY': 'ON_MATURITY'
            };

            const batches = chunkArray(api_data, 25);
            let totalSynced = 0;

            for (const batch of batches) {
                try {
                    // DEBUG LOGGING: Check batch composition
                    logger.debug(`[FD SYNC] Processing batch of ${batch.length} products`);
                    logger.debug(`[FD SYNC] Batch issuer IDs: ${batch.map((fd: any) => fd.issuerId).join(', ')}`);
                    logger.debug(`[FD SYNC] Batch product types: ${batch.map((fd: any) => fd?.type).join(', ')}`);

                    await db.$transaction(async (tx) => {
                        // --- STEP A: UPSERT ISSUERS ---
                        logger.debug(`[FD SYNC] STEP A: Starting issuer upsert`);
                        const issuerValues = batch.map(fd => {
                            const desc = (fd.aboutIssuer?.about?.description || '').toLowerCase();
                            const issuer_type = desc.includes('nbfc') ? 'NBFC' : 'BANK';
                            const rating_text = fd.tags?.map((t: any) => t.text).join(', ') || '';

                            return Prisma.sql`(
                            ${fd.issuerId}, 
                            ${fd.organization?.fullName || fd.displayName}, 
                            ${fd.displayName}, 
                            ${issuer_type}, 
                            ${fd.organization?.logo || ''}, 
                            ${fd.aboutIssuer?.banner || ''}, 
                            ${rating_text}, 
                            ${fd.aboutIssuer?.customerServed || ''}, 
                            'Not provided',
                            ${fd.aboutIssuer?.about?.description || ''}, 
                            '', '', NOW()
                        )`;
                        });

                        logger.debug(`[FD SYNC] STEP A: Created ${issuerValues.length} issuer value rows (may contain duplicates)`);

                        await tx.$executeRaw`
                        INSERT INTO "FdIssuer" (id, full_name, display_name, issuer_type, logo_url, banner_url, rating_text, customer_served, operating_since, about_description, support_email, support_phone, "updatedAt")
                        VALUES ${Prisma.join(issuerValues)}
                        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, "updatedAt" = NOW();
                    `;

                        logger.debug(`[FD SYNC] STEP A: Issuer upsert completed successfully`);

                        // --- STEP B: UPSERT PRODUCTS ---
                        logger.debug(`[FD SYNC] STEP B: Starting product upsert`);
                        const productValues = batch.map(fd => Prisma.sql`(
                        ${fd.id}, ${fd.issuerId}, ${fd.type}, 
                        ${parseFloat(fd.minimumDeposit || 0)}, ${parseFloat(fd.maximumDeposit || 0)},
                        ${parseInt(fd.minimumTenure || 0)}, ${parseInt(fd.maximumTenure || 0)},
                        ${fd.aboutIssuer?.lockInDetails?.period || 0}, ${fd.aboutIssuer?.lockInDetails?.message || ''}, 
                        1.0, ${!!fd.aboutIssuer?.vkyc}, ${parseFloat(fd.aboutIssuer?.vkyc?.minAmountForVkyc || 0)},
                        ${JSON.stringify(fd.aboutIssuer?.invest?.content || [])}::jsonb,
                        ${JSON.stringify(fd.aboutIssuer?.questions?.content || [])}::jsonb,
                        ${JSON.stringify(fd.tags || [])}::jsonb, NOW()
                    )`);

                        logger.debug(`[FD SYNC] STEP B: Created ${productValues.length} product value rows`);

                        await tx.$executeRaw`
                        INSERT INTO "FdProduct" (id, issuer_id, type, min_deposit, max_deposit, min_tenure_days, max_tenure_days, lock_in_period_days, withdrawal_message, premature_penalty_percent, is_vkyc_required, min_amount_for_vkyc, usps, faqs, tags, "updatedAt")
                        VALUES ${Prisma.join(productValues)}
                        ON CONFLICT (issuer_id, type) DO UPDATE SET min_deposit = EXCLUDED.min_deposit, max_deposit = EXCLUDED.max_deposit, "updatedAt" = NOW();
                    `;

                        logger.debug(`[FD SYNC] STEP B: Product upsert completed successfully`);

                        // --- STEP C: MAP IDS FOR RATES ---
                        const currentProducts = await tx.fdProduct.findMany({
                            where: { issuer_id: { in: batch.map(b => b.issuerId) } },
                            select: { id: true, issuer_id: true, type: true }
                        });
                        const productMap = new Map(currentProducts.map(p => [`${p.issuer_id}-${p.type}`, p.id]));

                        // --- STEP D: UPSERT INTEREST RATES ---
                        logger.debug(`[FD SYNC] STEP D: Starting interest rate upsert`);
                        const rateValues: Prisma.Sql[] = [];
                        const seenUniqueKeys = new Set<string>();  // Deduplicate by unique constraint
                        let duplicatesSkipped = 0;

                        for (const fd of batch) {
                            const pId = productMap.get(`${fd.issuerId}-${fd.type}`);
                            if (!pId) continue;

                            fd.frequencyTenureMapping?.forEach((freqGroup: any) => {
                                const apiFreq = freqGroup.frequency?.toUpperCase();
                                const mappedFreq = frequencyMap[apiFreq] || 'CUMULATIVE';

                                // Use FREQUENCY GROUP's flags, not product-level calculator flags
                                const groupHasSenior = freqGroup.isSeniorCitizen || false;
                                const groupHasFemale = freqGroup.isFemale || false;

                                let customerType: FdCustomerType = "STANDARD";

                                if (groupHasSenior && groupHasFemale) {
                                    customerType = "SENIOR_CITIZEN_FEMALE";
                                } else if (groupHasSenior) {
                                    customerType = "SENIOR_CITIZEN";
                                } else if (groupHasFemale) {
                                    customerType = "FEMALE";
                                }

                                freqGroup.tenure_mapping?.forEach((tm: any) => {
                                    // Unique constraint: (fd_product_id, payout_frequency, tenure_days, customer_type)
                                    const uniqueKey = `${pId}|${mappedFreq}|${tm.tenure}|${customerType}`;

                                    if (seenUniqueKeys.has(uniqueKey)) {
                                        duplicatesSkipped++;
                                    } else {
                                        seenUniqueKeys.add(uniqueKey);
                                        rateValues.push(Prisma.sql`(
                                        ${cuid()}, ${pId}, ${mappedFreq}::"FdPayoutFrequency", ${customerType}::"FdCustomerType", 
                                        ${tm.tenure}, ${tm.year || tm.display}, ${parseFloat(tm.rates.replace('%', ''))}, 
                                        ${parseFloat(tm.annualizedYield?.replace('%', '') || '0')},
                                        ${tm.default === true}, null, NOW()
                                    )`);
                                    }
                                });
                            });
                        }

                        logger.debug(`[FD SYNC] STEP D: Total unique rate rows: ${rateValues.length}, Duplicates skipped: ${duplicatesSkipped}`);

                        if (rateValues.length > 0) {
                            logger.debug(`[FD SYNC] STEP D: Created ${rateValues.length} interest rate rows`);
                            await tx.$executeRaw`
                            INSERT INTO "FdInterestRate" (
                                id, fd_product_id, payout_frequency, customer_type, 
                                tenure_days, tenure_label, interest_rate, annualized_yield, 
                                is_default_selection, is_tax_saver, "updatedAt"
                            )
                            VALUES ${Prisma.join(rateValues)}
                            ON CONFLICT (fd_product_id, payout_frequency, tenure_label, customer_type) 
                            DO UPDATE SET 
                                interest_rate = EXCLUDED.interest_rate,
                                annualized_yield = EXCLUDED.annualized_yield, 
                                "updatedAt" = NOW();
                        `;
                            logger.debug(`[FD SYNC] STEP D: Interest rate upsert completed successfully`);
                        } else {
                            logger.debug(`[FD SYNC] STEP D: No rate values to insert`);
                        }
                    }, { timeout: 30000 });

                    totalSynced += batch.length;
                    logger.info(`[FD SYNC] Batch Sync Successful: ${totalSynced}/${api_data.length}`);
                } catch (batchError) {
                    logger.error(`[FD SYNC] Batch failed with error:`, batchError);
                    logger.error(`[FD SYNC] Batch error details:`, {
                        message: (batchError as any).message,
                        code: (batchError as any).code,
                        constraint: (batchError as any).constraint
                    });
                    logger.error("Batch failed, skipping to next...", batchError);
                }
            }
        } catch (error: any) {
            logger.error("FATAL: FD Sync Job Failed.", error);
            throw error
        }
    };



    /**
     * mfapi returns dates as DD-MM-YYYY ("29-05-2008"), which `new Date()` parses as Invalid Date.
     * Reorders to YYYY-MM-DD before parsing. Returns null on anything unparseable so callers can
     * skip the record rather than writing a bad timestamp.
     */
    private parse_mfapi_date = (raw: string): Date | null => {
        if (typeof raw !== "string") return null;

        const parts = raw.split("-");
        const parsed = (parts.length === 3 && parts[0].length === 2)
            ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
            : new Date(raw);

        return isNaN(parsed.getTime()) ? null : parsed;
    }

    /**
     * Stage 2 of the NAV pipeline: resolve each curated fund's mfapi scheme_code.
     *
     * mfapi has no lookup-by-isin endpoint, so this pulls the whole master list once (~40k rows)
     * and builds an in-memory isin -> schemeCode map. Both isinGrowth and isinDivReinvestment are
     * indexed - a fund sits in one or the other depending on whether it's the growth or the
     * IDCW-reinvestment plan, and ISINs are globally unique so either match is the right fund.
     *
     * Returns the unmatched ISINs: those funds have no code, so mf_nav_daily_job will skip them
     * and they'll never get a NAV until someone looks into why.
     */
    mf_scheme_code_sync_job = async () => {
        const master = await mfapi_service.get_master_list();

        const isin_to_code = new Map<string, number>();
        for (const row of master) {
            if (!row?.schemeCode) continue;
            if (row.isinGrowth) isin_to_code.set(row.isinGrowth.trim().toUpperCase(), row.schemeCode);
            if (row.isinDivReinvestment) isin_to_code.set(row.isinDivReinvestment.trim().toUpperCase(), row.schemeCode);
        }
        logger.info(`mfapi isin map built: ${isin_to_code.size} ISINs across ${master.length} schemes`);

        const products = await db.mfProduct.findMany({ select: { id: true, isin: true, scheme_code: true } });

        logger.debug(`Total products to updates scheme code --> ${products.length}`)

        let matched = 0;
        let unchanged = 0;
        const unmatched: string[] = [];

        for (const product of products) {
            const code = isin_to_code.get(product.isin.trim().toUpperCase());

            if (!code) {
                unmatched.push(product.isin);
                continue;
            }
            if (product.scheme_code === code) {
                unchanged++;
                continue;
            }

            await db.mfProduct.update({ where: { id: product.id }, data: { scheme_code: code } });
            matched++;
        }

        logger.info(`Scheme code sync done - updated: ${matched}, already correct: ${unchanged}, unmatched: ${unmatched.length}`);
        if (unmatched.length > 0) {
            logger.warn(`ISINs with no mfapi match: ${unmatched.join(", ")}`);
        }

        return { total: products.length, matched, unchanged, unmatched_count: unmatched.length, unmatched };
    }

    /**
     * Stage 3: pull the latest NAV for every fund that has a scheme_code.
     *
     * Writes both MfProduct.latest_nav/latest_nav_date (what mf-metrics-calc anchors on) and an
     * MfNavHistory row. The history insert relies on @@unique([mf_product_id, nav_date]) to make a
     * same-day re-run a no-op rather than a duplicate.
     *
     * One HTTP call per fund - mfapi has no bulk latest-NAV endpoint - so concurrency is capped.
     * A fund that fails is collected and reported, never aborts the batch.
     */
    mf_nav_daily_job = async () => {
        const products = await db.mfProduct.findMany({
            where: { scheme_code: { not: null } },
            select: { id: true, isin: true, scheme_code: true },
        });

        logger.info(`Starting NAV refresh for ${products.length} funds with a scheme_code`);

        const limit = pLimit(5);
        let updated = 0;
        let history_inserted = 0;
        const failed: { isin: string; reason: string }[] = [];

        const tasks = products.map(product => limit(async () => {
            const response = await mfapi_service.get_latest_nav(product.scheme_code!);

            const point = response?.data?.[0];
            if (!point?.nav || !point?.date) {
                failed.push({ isin: product.isin, reason: "no NAV data in response" });
                return;
            }

            const nav_date = this.parse_mfapi_date(point.date);
            if (!nav_date) {
                failed.push({ isin: product.isin, reason: `unparseable date "${point.date}"` });
                return;
            }

            const nav = parseFloat(point.nav);
            if (isNaN(nav)) {
                failed.push({ isin: product.isin, reason: `unparseable nav "${point.nav}"` });
                return;
            }

            await db.mfProduct.update({
                where: { id: product.id },
                data: { latest_nav: nav, latest_nav_date: nav_date },
            });
            updated++;

            // createMany + skipDuplicates so re-running the same day is a no-op on the unique
            // (mf_product_id, nav_date) pair instead of throwing.
            const inserted = await db.mfNavHistory.createMany({
                data: [{ mf_product_id: product.id, nav, nav_date }],
                skipDuplicates: true,
            });
            history_inserted += inserted.count;
        }));

        await Promise.allSettled(tasks);

        logger.info(`NAV refresh done - updated: ${updated}, history rows added: ${history_inserted}, failed: ${failed.length}`);
        if (failed.length > 0) {
            logger.warn(`NAV fetch failures: ${failed.slice(0, 10).map(f => `${f.isin} (${f.reason})`).join(", ")}`);
        }

        return { total: products.length, updated, history_inserted, failed_count: failed.length, failed };
    }

    calculate_all_mf_metrics = async () => {
        logger.info("Starting MF Metrics calculation job...");
        try {
            let cursor: string | null = null;
            const BATCH_SIZE = 500;
            let totalProcessed = 0;

            while (true) {
                const products = await db.mfProduct.findMany({
                    take: BATCH_SIZE,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    where: { latest_nav: { not: null }, latest_nav_date: { not: null } },
                    select: { id: true, latest_nav: true, latest_nav_date: true },
                    orderBy: { id: 'asc' }
                });

                if (products.length === 0) break;

                const productIds = products.map(p => p.id);

                // Fetch required nav points efficiently using Postgres LATERAL join
                const query = Prisma.sql`
                    WITH TargetDates AS (
                        SELECT 
                            id AS product_id,
                            latest_nav,
                            latest_nav_date,
                            latest_nav_date - INTERVAL '1 month' AS date_1m,
                            latest_nav_date - INTERVAL '3 months' AS date_3m,
                            latest_nav_date - INTERVAL '6 months' AS date_6m,
                            latest_nav_date - INTERVAL '1 year' AS date_1y,
                            latest_nav_date - INTERVAL '3 years' AS date_3y,
                            latest_nav_date - INTERVAL '5 years' AS date_5y
                        FROM "MfProduct"
                        WHERE id = ANY(ARRAY[${Prisma.join(productIds)}]::text[])
                    )
                    SELECT 
                        t.product_id,
                        t.latest_nav as latest_nav,
                        n_1d.nav AS nav_1d,
                        n_1m.nav AS nav_1m,
                        n_3m.nav AS nav_3m,
                        n_6m.nav AS nav_6m,
                        n_1y.nav AS nav_1y,
                        n_3y.nav AS nav_3y,
                        n_5y.nav AS nav_5y
                    FROM TargetDates t
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date < t.latest_nav_date ORDER BY nav_date DESC LIMIT 1
                    ) n_1d ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_1m ORDER BY nav_date DESC LIMIT 1
                    ) n_1m ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_3m ORDER BY nav_date DESC LIMIT 1
                    ) n_3m ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_6m ORDER BY nav_date DESC LIMIT 1
                    ) n_6m ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_1y ORDER BY nav_date DESC LIMIT 1
                    ) n_1y ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_3y ORDER BY nav_date DESC LIMIT 1
                    ) n_3y ON true
                    LEFT JOIN LATERAL (
                        SELECT nav FROM "MfNavHistory" WHERE mf_product_id = t.product_id AND nav_date <= t.date_5y ORDER BY nav_date DESC LIMIT 1
                    ) n_5y ON true;
                `;

                const results: any[] = await db.$queryRaw(query);

                const absReturn = (latest: number, past: number | null) => past ? Math.round(((latest / past) - 1) * 100 * 1000) / 1000 : null;
                const cagrReturn = (latest: number, past: number | null, years: number) => past ? Math.round((((Math.pow((latest / past), (1 / years))) - 1) * 100) * 1000) / 1000 : null;

                const metricsValues = results.map(row => {
                    const latest = parseFloat(row.latest_nav);
                    const nav1d = row.nav_1d ? parseFloat(row.nav_1d) : null;
                    const nav1m = row.nav_1m ? parseFloat(row.nav_1m) : null;
                    const nav3m = row.nav_3m ? parseFloat(row.nav_3m) : null;
                    const nav6m = row.nav_6m ? parseFloat(row.nav_6m) : null;
                    const nav1y = row.nav_1y ? parseFloat(row.nav_1y) : null;
                    const nav3y = row.nav_3y ? parseFloat(row.nav_3y) : null;
                    const nav5y = row.nav_5y ? parseFloat(row.nav_5y) : null;

                    return Prisma.sql`(
                        ${cuid()}, 
                        ${row.product_id}, 
                        ${absReturn(latest, nav1d)}, 
                        ${absReturn(latest, nav1m)}, 
                        ${absReturn(latest, nav3m)}, 
                        ${absReturn(latest, nav6m)}, 
                        ${absReturn(latest, nav1y)}, 
                        ${cagrReturn(latest, nav3y, 3)}, 
                        ${cagrReturn(latest, nav5y, 5)}, 
                        NOW()
                    )`;
                });

                if (metricsValues.length > 0) {
                    await db.$executeRaw`
                        INSERT INTO "MfMetrics" (id, mf_product_id, nav_change_pct, return_30d, return_90d, return_6m, return_1y, return_3y, return_5y, "updatedAt")
                        VALUES ${Prisma.join(metricsValues)}
                        ON CONFLICT (mf_product_id) DO UPDATE SET
                            nav_change_pct = EXCLUDED.nav_change_pct,
                            return_30d = EXCLUDED.return_30d,
                            return_90d = EXCLUDED.return_90d,
                            return_6m = EXCLUDED.return_6m,
                            return_1y = EXCLUDED.return_1y,
                            return_3y = EXCLUDED.return_3y,
                            return_5y = EXCLUDED.return_5y,
                            "updatedAt" = NOW();
                    `;
                }

                totalProcessed += products.length;
                cursor = products[products.length - 1].id;
                logger.info(`[MF METRICS] Processed batch of ${products.length}. Total so far: ${totalProcessed}`);
            }
            logger.info("MF Metrics calculation job completed successfully.");
        } catch (error) {
            logger.error("Error in calculate_all_mf_metrics:", error);
            throw error;
        }
    }















    /**
     * One-time-ish historical NAV backfill: pulls each fund's WHOLE NAV history from mfapi into
     * MfNavHistory. mf_nav_daily_job only appends one point per day going forward, so without this
     * seed the metrics job has nothing to look back at and every return_* stays null.
     *
     * Keyed off MfProduct.scheme_code (resolved by mf_scheme_code_sync_job) - funds without one
     * are skipped, since there's nothing to call mfapi with.
     *
     * NOTE: this currently re-downloads history for every fund on each run. Fine while it's a
     * pre-go-live seed; add a "skip funds that already have history" guard before making it
     * routine, otherwise re-running to pick up newly-imported funds refetches the whole catalogue.
     */
    nav_history_job = async () => {
        let cursor: string | null = null;
        const BATCH_SIZE = 100;
        const limit = pLimit(2); // whole-history payloads are heavy and mfapi is a free public API

        let processed = 0;
        let inserted_total = 0;

        while (true) {
            // Cursor pagination so the whole catalogue never sits in memory at once.
            const products = await db.mfProduct.findMany({
                take: BATCH_SIZE,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                where: { scheme_code: { not: null } },
                select: { id: true, isin: true, scheme_code: true },
                orderBy: { id: "asc" },
            });

            if (products.length === 0) break;

            const results = await Promise.allSettled(
                products.map(product => limit(() => this.process_nav_history(product)))
            );

            for (const result of results) {
                if (result.status === "fulfilled") inserted_total += result.value;
            }
            processed += products.length;
            logger.info(`[NAV HISTORY] Processed ${processed} funds, ${inserted_total} points inserted so far`);

            cursor = products[products.length - 1].id;
        }

        const result = { total: processed, points_inserted: inserted_total };
        logger.info("[NAV HISTORY] Backfill completed", result);
        return result;
    }

    /**
     * Fetches and stores one fund's full NAV history. Returns how many rows were actually written -
     * skipDuplicates means a re-run inserts 0 rather than throwing on the
     * @@unique([mf_product_id, nav_date]) pair.
     *
     * Never throws: a fund that fails is logged and reported as 0 so it can't abort the batch.
     */
    process_nav_history = async (product: { id: string; isin: string; scheme_code: number | null }): Promise<number> => {
        if (!product.scheme_code) return 0;

        try {
            const response = await mfapi_service.get_full_history(product.scheme_code);
            const points = response?.data ?? [];

            if (points.length === 0) {
                logger.warn(`[NAV HISTORY] No history returned for ${product.isin} (scheme_code ${product.scheme_code})`);
                return 0;
            }

            const to_insert = points.flatMap(point => {
                const nav_date = this.parse_mfapi_date(point.date);
                const nav = parseFloat(point.nav);

                // Drop unparseable points rather than writing a bad row - mfapi occasionally
                // carries blank NAVs on non-trading days.
                if (!nav_date || isNaN(nav)) return [];
                return [{ mf_product_id: product.id, nav, nav_date }];
            });

            let inserted = 0;
            const CHUNK = 1000;
            for (let i = 0; i < to_insert.length; i += CHUNK) {
                const chunk = await db.mfNavHistory.createMany({
                    data: to_insert.slice(i, i + CHUNK),
                    skipDuplicates: true,
                });
                inserted += chunk.count;
            }

            logger.info(`[NAV HISTORY] ${product.isin}: ${inserted} new points (of ${to_insert.length} fetched)`);
            return inserted;
        } catch (error) {
            logger.error(`[NAV HISTORY] Failed for ${product.isin} (scheme_code ${product.scheme_code})`, error);
            return 0;
        }
    }

}

export const job_service = new JobServiceClass();