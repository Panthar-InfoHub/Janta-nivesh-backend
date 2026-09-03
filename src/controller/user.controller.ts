import { NextFunction, Request, Response } from "express";
import { user_patch_schema, verify_mpin_schema } from "../lib/zod-schemas/user.schema.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
// import { fire_report_service } from "../services/fire.report.service.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";
import { user_savings_service } from "../services/user.savings.service.js";
import { user_service } from "../services/user.service.js";
import { pending_orders_service } from "../services/pending_orders.service.js";
import { wrapper_service } from "../services/wrapper.service.js";
import { Prisma, UserGoals } from "../prisma/generated/prisma/client.js";
import { user_goal_controller } from "./user.goal.controller.js";
import { redis } from "../lib/redis.js";
import { db } from "../server.js";
class UserFinanceControllerClass {


    private toNumber = (val: any) =>
        parseFloat(String(val).replace(/,/g, ""));


    async onboarding_create(req: Request) {
        const user = req.user!;
        const { current_step, ...data }: any = req.body;

        logger.debug(`Processing onboarding finance for User ID: ${user.id} with current_step: ${current_step}`);

        // const validated_data: UserFinanceInput = user_finance_zod_schema.parse(data);
        return await user_service.update_user(user.id, data);
    }


    get_user = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user_id: string = req.user!.id;
            logger.info(`Fetching user data for User ID: ${user_id}`);

            const data = await user_service.get_all_user_data(user_id, {
                user_goals: true,
                user_insurance: true,
                user_loan: true,
                user_assets: true,
                user_finance: true,
                kyc_types: true,
                onboarding: true
            });

            logger.debug(`User data fetched successfully ==> `, data);

            // const { fire_number, net_worth, total_expenses, fire_percentage } = await fire_report_service.get_current_fire_number(user_id);

            // Home-screen summary card: portfolio value split MF / FD. MF comes from MfHolding
            // (kept in sync by mf-holding-sync.service.ts), FD from the user's own FD transactions -
            // no live provider call on this path. Runs through the same
            // user_service.aggregate_portfolio_data as GET /user/portfolio so the two screens can
            // never disagree on the same number.
            const holdings = await db.mfHolding.findMany({
                where: { user_id },
                select: { isin: true, invested_amount: true, current_value: true },
            });

            const mf_current_value = holdings.reduce((sum, h) => sum + Number(h.current_value), 0);
            const mf_invested_amount = holdings.reduce((sum, h) => sum + Number(h.invested_amount), 0);

            const mf_investment_data = {
                current_value: Number(mf_current_value.toFixed(2)),
                invested_amount: Number(mf_invested_amount.toFixed(2)),
                total_returns: Number((mf_current_value - mf_invested_amount).toFixed(2)),
                return_percent: mf_invested_amount > 0
                    ? Number((((mf_current_value - mf_invested_amount) / mf_invested_amount) * 100).toFixed(2))
                    : 0,
                // One entry per distinct fund, matching how the portfolio screen groups its cards
                // (a fund held across two folios is one holding to the user, not two).
                items_count: new Set(holdings.map(h => h.isin)).size,
            };

            const fd_response = await user_service.get_user_fd_data({ user_id, order: { fd_issued_at: 'desc' } });
            const portfolio_aggregates = user_service.aggregate_portfolio_data(
                mf_investment_data,
                fd_response.fd_transactions || []
            );

            // const wrapper_user_goal = data.user_goals.length > 0 ? data.user_goals.map((goal: UserGoals, index: number) => {

            //     if (goal.goal_id) {
            //         const current_value = goalIdToCurrvalMap.get(String(goal.goal_id)) || 0;
            //         if (current_value > 0) {
            //             const total_amount = Math.abs(Number(goal.current_saved_amount || 0)) + current_value;
            //             (goal as any).current_saved_amount = new Prisma.Decimal(Math.round(total_amount));
            //         }
            //     }

            //     if (goal.goal_type_id === 3) {
            //         const years_to_retirement = (goal.retirement_age ?? 0) - (goal.current_age ?? 0);
            //         const years_post_retirement = (goal.life_expectancy ?? 0) - (goal.retirement_age ?? 0);

            //         const corpus_value = user_goal_controller.calculate_corpus_value(
            //             Number(goal.current_monthly_expense ?? 0),
            //             Number(goal.inflation_rate ?? 0) / 100,       // stored as % (e.g. 7), formula needs 0.07
            //             Number(goal.post_retirement_return ?? 0) / 100, // stored as % (e.g. 6), formula needs 0.06
            //             years_to_retirement,
            //             years_post_retirement
            //         );

            //         (goal as any).current_goal_cost = new Prisma.Decimal(Math.round(corpus_value));
            //         logger.debug(`Computed corpus value for retirement goal ${goal.goal_id}: ${corpus_value}`);
            //     }
            //     return goal;
            // }) : data.user_goals

            res.status(200).json({
                code: 200,
                message: "User data fetched successfully",
                data: {
                    ...data,
                    // `onboarding` is the full UserOnboarding row (included above). is_skip is
                    // lifted out of it as a convenience flag: basic_details_status is SKIPPED only
                    // when the user skipped the onboarding flow outright (see the column comment on
                    // UserOnboarding) - a per-stage skip like nominee_status does not set it.
                    is_skip: data?.onboarding?.basic_details_status === "SKIPPED",
                    dashboard: {
                        portfolio_value: portfolio_aggregates.total_investments.current_value,
                        mutual_funds: portfolio_aggregates.total_investments.allocation.mutual_funds.value,
                        fixed_deposits: portfolio_aggregates.total_investments.allocation.fixed_deposits.value,
                        total_returns: portfolio_aggregates.total_investments.total_returns,
                        return_percent: portfolio_aggregates.total_investments.return_percent,
                        // "+5.3% this month" on the design. Deliberately null, not 0 or a guess -
                        // there is no month-ago baseline to compute it from. UserNetWorthSnapshot is
                        // the only monthly series we keep and it can't answer this: it stores net
                        // worth (assets minus liabilities, including stocks/gold/cash/real estate),
                        // not the MF+FD portfolio value shown here, and its MF figure still comes
                        // from the retired Finnsys feed. Needs its own decision - see the PR notes.
                        month_change_percent: null,
                    },
                    // user_goals: wrapper_user_goal,
                    // kyc_types: data?.kyc_types?.reduce((acc: any, kyc: any) => {
                    //     acc[kyc.kyc_type] = {
                    //         status: kyc.status
                    //     };
                    //     return acc;
                    // }, {}) || {},
                    // kyc_progress: this.calculate_kyc_progress(data?.kyc_types || []),
                    // user_home_data: {
                    //     fire_number,
                    //     net_worth,
                    //     total_expenses,
                    //     fire_percentage
                    // }
                }
            });
            return;

        } catch (error) {
            logger.error(`Error in get_user: ${error}`);
            next(error);
            return;
        }
    }


    get_all_user = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const users = await db.user.findMany({
                select: {
                    id: true,
                    phone_no: true,
                    full_name: true,
                    email: true,
                }
            });
            res.status(200).json({
                code: 200,
                message: "User data fetched successfully",
                data: users
            });
            return;

        } catch (error) {
            logger.error(`Error in get_user: ${error}`);
            next(error);
            return;
        }
    }


    async discard_onboard(req: Request, res: Response, next: NextFunction) {
        try {

            const user_id: string = req.user!.id;
            logger.info(`Fetching user data for User ID: ${user_id}`);

            const data = await user_service.discard_user_onboarding(user_id);
            logger.debug(`User onboarding discarded successfully ==> `, data);

            res.status(200).json({
                code: 200,
                message: "User onboarding discarded successfully",
                data
            });
            return;

        } catch (error) {
            logger.error(`Error in get_user: ${error}`);
            next(error);
            return;
        }
    }

    get_user_cart = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            logger.info(`Fetching user cart for User ID: ${user.id}`);

            const user_cart_res = await user_service.get_user_cart_finnsys(user.log!, user.pwd!)

            logger.debug(`User data fetched successfully ==> `, user_cart_res);

            if (user_cart_res.code === 0) {
                logger.debug("Empty cart for User ID ==> ", user.id);
                res.status(200).json({
                    code: 200,
                    message: "User cart fetched successfully",
                    data: {
                        sip_items: [],
                        lump_sum_items: []
                    }
                });
                return;
            }

            if (user_cart_res.code != 1 && user_cart_res.code != 0) {
                logger.warn(`Failed to fetch user cart from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_cart_res.code}`);
                throw new AppError("Failed to fetch user cart from Finnsys", 502, "FINNSYS_CART_FETCH_FAILED");
            }

            const { sip_items, lump_sum_items } = this.extract_cart_items(user_cart_res);

            logger.info("Mapping logo img for funds...")

            // wrapper_service.get_logos_of_amc / get_transaction_rules_by_nse_codes queried
            // MfProduct columns (amc_name, nse_scheme_code, transaction_rules) dropped in the
            // Cybrilla/FP catalogue migration - both are commented out there. Empty maps here
            // degrade cart items to blank logo/rules rather than crashing cart fetch; a
            // v2-catalogue equivalent isn't built yet.
            const logo_map = new Map<string, string>();
            const rules_map = new Map<string, any>();

            // Enrich items with img_url and transaction_rules
            const enriched_sip_items = sip_items.map((item: any) => {
                const isTaxOrElss = /TAX|ELSS/i.test(item.prod_name || item.amc_name || "");
                const baseAmount = Number(item.sip_amt || item.txn_amount || 0);

                const min_step_up_percent = isTaxOrElss ? 0 : 10;
                const min_step_up_amt = isTaxOrElss ? 500 : (baseAmount * 0.10);

                return {
                    ...item,
                    img_url: logo_map.get(item.amc_name) || "",
                    transaction_rules: this.extract_relevant_transaction_rules(rules_map.get(item.prod_code), item.sip_freq),
                    min_step_up_percent,
                    min_step_up_amt: Math.round(min_step_up_amt)
                };
            });

            const enriched_lump_sum_items = lump_sum_items.map((item: any) => ({
                ...item,
                img_url: logo_map.get(item.amc_name) || "",
                transaction_rules: this.extract_relevant_transaction_rules(rules_map.get(item.prod_code))
            }));

            logger.info("Mapping completed of logo funds")

            res.status(200).json({
                code: 200,
                message: "User cart fetched successfully",
                data: {
                    sip_items: enriched_sip_items,
                    lump_sum_items: enriched_lump_sum_items
                }
            });
            return;

        } catch (error) {
            logger.error(`Error in getting user cart: `, error);
            next(error);
            return;
        }
    }

    get_user_fd_transactions = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user?.id! as string;
            const { page = 1, limit = 20, order = "desc", ...query } = req.query as any;

            logger.info(`Fetching FD Transactions for User ID ${user_id} with query: ${JSON.stringify(query)}, page: ${page}, limit: ${limit}, order: ${order}`);

            const data = await user_service.get_user_fd_data({ pagination: { page: parseInt(page), limit: parseInt(limit) }, user_id, order: { fd_issued_at: order }, query });

            logger.debug(`FD Transactions fetched successfully for User ID ${user_id} ==> `, data);

            res.status(200).json({
                success: true,
                message: "FD Transactions fetched successfully",
                data
            });
            return;

        } catch (error) {
            logger.error("Error in get_user_fd_transactions: ", error);
            next(error);
            return;
        }
    }

    get_user_iin = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            logger.info(`Fetching user iin for User ID: ${user.id}`);

            const user_iin_finnsys_res = await user_finnsys_service.get_user_iin_finnsys(user.log!, user.pwd!)

            logger.debug(`User iin fetched from Finnsys successfully ==> `, user_iin_finnsys_res);

            if (user_iin_finnsys_res.code != 1) {
                logger.warn(`Failed to fetch user iin from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_iin_finnsys_res.code}`);
                throw new AppError("Failed to fetch user iin from Finnsys", 502, "FINNSYS_IIN_FETCH_FAILED");
            }

            const iin_data = user_iin_finnsys_res.results[0].INV_IIN_LIST || [];

            res.status(200).json({
                code: 200,
                message: "User iin fetched successfully",
                data: iin_data
            });
            return;

        } catch (error) {
            logger.error(`Error in getting user iin: `, error);
            next(error);
            return;
        }
    }


    get_pending_orders = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const usr = req.user;
            logger.info(`Fetching pending orders for User ID: ${usr.id}`);

            const user = await user_service.get_user_by_id(usr.id);

            if (!user) {
                throw new AppError("User Finnsys credentials or client code not found", 400, "MISSING_FINNSYS_CREDENTIALS");
            }

            const data = await pending_orders_service.get_pending_orders(
                usr.log!,
                usr.pwd!,
                user.investor_profile
            );

            res.status(200).json({
                code: 200,
                message: "Pending orders fetched successfully",
                data
            });
            return;
        } catch (error) {
            logger.error(`Error in get_pending_orders: `, error);
            next(error);
            return;
        }
    }


    get_user_portfolio = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            logger.info(`Fetching user portfolio for User ID: ${user.id}`);

            // Reads MfHolding, not FP live - that table is kept in sync by mf-holding-sync.service.ts
            // (on-write, once a controller calls it, plus nightly via job.service.ts's
            // mf_holding_sync_job), so this endpoint never waits on FP.
            const holdings = await db.mfHolding.findMany({
                where: { user_id: user.id },
                include: { mf_product: { select: { id: true, name: true, img_url: true } } },
                orderBy: { current_value: "desc" },
            });

            // One card per fund, not per folio - a fund held across two folios is combined, matching
            // what the portfolio screen shows (see mf-holding.prisma for why a fund can span folios).
            const by_fund = new Map<string, any>();
            for (const h of holdings) {
                const invested = Number(h.invested_amount);
                const current = Number(h.current_value);
                const existing = by_fund.get(h.isin);

                if (!existing) {
                    by_fund.set(h.isin, {
                        id: h.mf_product_id,
                        isin: h.isin,
                        title: h.mf_product?.name ?? h.fund_name ?? "Mutual Fund",
                        img_url: h.mf_product?.img_url ?? "",
                        amount: invested,
                        current_value: current,
                        bal_units: Number(h.units),
                        folios: [h.folio_number],
                    });
                } else {
                    existing.amount += invested;
                    existing.current_value += current;
                    existing.bal_units += Number(h.units);
                    existing.folios.push(h.folio_number);
                }
            }

            const mf_investment_items = Array.from(by_fund.values()).map((f: any) => ({
                id: f.id,
                title: f.title,
                amount: Number(f.amount.toFixed(2)),
                current_value: Number(f.current_value.toFixed(2)),
                return: Number((f.current_value - f.amount).toFixed(2)),
                return_percentage: f.amount > 0
                    ? Number((((f.current_value - f.amount) / f.amount) * 100).toFixed(2)) + "%"
                    : "0.00%",
                folio: f.folios[0],
                folios: f.folios,
                bal_units: Number(f.bal_units.toFixed(4)),
                img_url: f.img_url,
            }));

            const investment_data = {
                current_value: Number(holdings.reduce((sum, h) => sum + Number(h.current_value), 0).toFixed(2)),
                invested_amount: Number(holdings.reduce((sum, h) => sum + Number(h.invested_amount), 0).toFixed(2)),
                total_returns: 0,
                return_percent: 0,
                items_count: mf_investment_items.length,
            };
            investment_data.total_returns = Number((investment_data.current_value - investment_data.invested_amount).toFixed(2));
            investment_data.return_percent = investment_data.invested_amount > 0
                ? Number(((investment_data.total_returns / investment_data.invested_amount) * 100).toFixed(2))
                : 0;
            logger.debug(`Calculated user investment data ==> `, investment_data);

            logger.debug("Mapped user mutual fund folios now proceeding to user fd transactions...");
            const user_fd_response = await user_service.get_user_fd_data({ user_id: user.id, order: { fd_issued_at: 'desc' } });
            const fd_transactions = user_fd_response.fd_transactions || [];

            // Map FD transactions to portfolio items
            const fd_investment_items = fd_transactions.map((fd: any) => ({
                id: fd.id,
                title: fd.product?.issuer?.display_name || "Fixed Deposit",
                category: "Fixed Deposit",
                amount: Number(fd.amount),
                start_date: fd.fd_issued_at,
                maturity_date: new Date(fd.maturity_date).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }),
                return: Number(fd.maturity_amount || 0) - Number(fd.amount),
                roi: Number(fd.roi_at_booking) || 0,
                tenure_days: fd.tenure_at_booking || 0,
                status: fd.status,
                maturity_amount: Number(fd.maturity_amount) || 0,
                issuer_logo: fd.product?.issuer?.logo_url
            }));

            // Aggregate portfolio data with allocation breakdown
            const portfolio_aggregates = user_service.aggregate_portfolio_data(investment_data, fd_transactions);

            res.status(200).json({
                code: 200,
                message: "User portfolio fetched successfully",
                data: {
                    ...portfolio_aggregates,
                    mutual_funds: mf_investment_items,
                    fixed_deposits: fd_investment_items
                }
            });
            return;
        } catch (error) {
            logger.error(`Error in getting user portfolio: `, error);
            next(error);
            return;
        }
    }

    private extract_relevant_transaction_rules(rules: any, sip_freq?: string) {
        if (!rules) return null;

        const clean_rules = {
            id: rules.id,
            mf_product_id: rules.mf_product_id,
            min_lump_sum_amount: Math.round(rules.min_lump_sum_amount),
            sip_allowed_dates: rules.sip_allowed_dates,
            sip_frequencies: rules.sip_frequencies,
            // Dropped in the Fintech Primitives migration - these columns no longer exist.
            // min_investment_amount: rules.min_investment_amount,
            // min_lumpsum_add_on_amount: rules.min_lumpsum_add_on_amount,
            // min_redem_qty: rules.min_redem_qty,
            // min_redem_amount: rules.min_redem_amount,
            min_sip_amount: rules.min_sip_amount // default fallback
        };

        // The per-frequency SIP minimums this switched over were dropped with the FP migration.
        // Left commented rather than rewritten - this whole path gets replaced by MfSchemePlan's
        // sip_daily_* / sip_monthly_* thresholds.
        // if (sip_freq) {
        //     switch (sip_freq) {
        //         case "DZ":
        //         case "D":
        //             clean_rules.min_sip_amount = rules.min_daily_sip_amount ?? clean_rules.min_sip_amount;
        //             break;
        //         case "OW":
        //         case "WD":
        //             clean_rules.min_sip_amount = rules.min_weekly_sip_amount ?? clean_rules.min_sip_amount;
        //             break;
        //         case "OM":
        //             clean_rules.min_sip_amount = rules.min_monthly_sip_amount ?? clean_rules.min_sip_amount;
        //             break;
        //         case "Q":
        //             clean_rules.min_sip_amount = rules.min_quarterly_sip_amount ?? clean_rules.min_sip_amount;
        //             break;
        //         case "H":
        //             clean_rules.min_sip_amount = rules.min_semi_annual_sip_amount ?? clean_rules.min_sip_amount;
        //             break;
        //         case "Y":
        //             clean_rules.min_sip_amount = rules.min_annual_sip_amount ?? clean_rules.min_sip_amount;
        //             break;
        //     }
        // }

        return clean_rules;
    }

    get_folio_details = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            let { folio_id } = req.params as unknown as { folio_id: string | string[] };
            if (Array.isArray(folio_id)) {
                folio_id = folio_id.join('/');
            }

            logger.info(`Fetching folio details for User ID: ${user.id}, Folio: ${folio_id}`);

            const holdings = await db.mfHolding.findMany({
                where: { user_id: user.id, folio_number: folio_id },
                include: { mf_product: { select: { id: true, name: true, img_url: true } } },
            });

            if (holdings.length === 0) {
                throw new AppError("Folio not found", 404, "MF_FOLIO_NOT_FOUND");
            }

            // MfTransactionPlan carries the order/SIP identity (state, next installment, SIP id) -
            // MfHolding doesn't know about any of that, it only knows current units/value. A folio
            // can have more than one plan against the same scheme (a SIP and a later lumpsum both
            // landing here), so this takes the most recently created one per scheme for the
            // identity fields shown alongside the (already-combined) holding numbers.
            const isins = holdings.map((h) => h.isin);
            const plans = await db.mfTransactionPlan.findMany({
                where: { user_id: user.id, folio_number: folio_id, scheme: { in: isins } },
                orderBy: { createdAt: "desc" },
            });
            const plan_by_isin = new Map<string, (typeof plans)[number]>();
            for (const plan of plans) {
                if (!plan_by_isin.has(plan.scheme)) plan_by_isin.set(plan.scheme, plan);
            }

            const mf_investment_items = holdings.map((h) => {
                const plan = plan_by_isin.get(h.isin);
                return {
                    id: h.mf_product_id,
                    mf_holding_id: h.id,
                    scheme_id: h.isin,
                    title: h.mf_product?.name ?? h.fund_name ?? "Mutual Fund",
                    amount: Number(h.invested_amount),
                    current_value: Number(h.current_value),
                    is_sip: plan?.systematic ?? false,
                    start_date: plan?.start_date ?? null,
                    return_percentage: h.absolute_return ? Number(h.absolute_return) : null,
                    return: h.unrealized_gain ? Number(h.unrealized_gain) : null,
                    xirr: h.xirr ? Number(h.xirr) : null,
                    current_nav: h.nav ? Number(h.nav) : null,
                    avg_nav: h.avg_nav ? Number(h.avg_nav) : null,
                    folio: h.folio_number,
                    actual_folio: h.folio_number,
                    balance_units: Number(h.units),
                    img_url: h.mf_product?.img_url || "",
                    // Plan identity - null on a holding with no matching MfTransactionPlan row
                    // (e.g. units acquired before this app tracked the order, or IDCW reinvestment).
                    fp_id: plan?.fp_id ?? null,
                    state: plan?.state ?? null,
                    frequency: plan?.frequency ?? null,
                    next_installment_date: plan?.next_installment_date ?? null,
                    synced_at: h.synced_at,
                };
            });

            logger.debug("Mf investment items ==> ", mf_investment_items)

            res.status(200).json({
                code: 200,
                message: "Folio details fetched successfully",
                data: mf_investment_items
            });
            return;
        } catch (error) {
            logger.error(`Error in getting folio details: `, error);
            next(error);
            return;
        }
    }

    get_investment_rate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Fetching investment rate data for User ID: ${user.id}`);

            // Step 1: Fetch portfolio data (reuse existing portfolio logic)
            let user_portfolio_finnsys_res = await wrapper_service.get_user_portfolio_cached(user.id, user.log!, user.pwd!);

            if (!user_portfolio_finnsys_res || (user_portfolio_finnsys_res.code != 1 && user_portfolio_finnsys_res.code != 0)) {
                logger.warn(
                    `Failed to fetch user portfolio from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_portfolio_finnsys_res?.code}`
                );
                throw new AppError("Failed to fetch user portfolio from Finnsys", 502, "FINNSYS_PORTFOLIO_FETCH_FAILED");
            }

            const user_mf_data = user_portfolio_finnsys_res.results || [];

            // Calculate investment data same as portfolio endpoint
            const investment_data = user_mf_data.length > 0
                ? user_mf_data.reduce(
                    (acc: any, item: any) => {
                        const invested = this.toNumber(item.purcost);
                        const current = this.toNumber(item.currval);
                        const pl = this.toNumber(item.pl);

                        acc.invested_amount += invested;
                        acc.current_value += current;
                        acc.total_returns += pl;
                        return acc;
                    },
                    {
                        current_value: 0,
                        invested_amount: 0,
                        total_returns: 0,
                    }
                )
                : {
                    current_value: 0,
                    invested_amount: 0,
                    total_returns: 0,
                };

            investment_data.current_value = Number(investment_data.current_value.toFixed(2));
            investment_data.invested_amount = Number(investment_data.invested_amount.toFixed(2));
            investment_data.total_returns = Number(investment_data.total_returns.toFixed(2));
            investment_data.return_percent = Number(
                ((investment_data.total_returns / investment_data.invested_amount) * 100).toFixed(2)
            );

            // Map MF data to portfolio structure
            const mf_investment_items = user_mf_data.length > 0
                ? user_mf_data.map((item: any) => ({
                    id: item.schemeid,
                    title: item.schemename,
                    category: item.schemetype,
                    amount: Number(item.purcost.replace(/,/g, "")),
                    is_sip: item.sip,
                    start_date: item.stdt,
                    return_percentage: item.abs,
                    return: this.toNumber(item.pl),
                    xirr: item.xirr,
                    current_nav: this.toNumber(item.currnav),
                    avg_nav: this.toNumber(item.avgcost),
                    folio: item.folio,
                    balance_units: item.balunits,
                }))
                : [];

            logger.debug("Investment data ==> ", investment_data);
            // Build portfolio data structure for savings service
            const portfolio_data = {
                investment_data,
                mutual_funds: mf_investment_items,
            };

            // Step 2: Call savings service with portfolio data
            const dashboard_data = await user_savings_service.calculate_monthly_metrics(
                user.id,
                portfolio_data,
                6 // last 6 months
            );

            logger.debug("Investment rate data calculated successfully", dashboard_data);

            res.status(200).json({
                code: 200,
                message: "Investment rate data fetched successfully",
                data: dashboard_data,
            });
            return;
        } catch (error) {
            logger.error(`Error in getting investment rate: `, error);
            next(error);
            return;
        }
    }

    patch_user = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            const data = user_patch_schema.parse(req.body);

            logger.info(`Patching user data for User ID: ${user_id}`);
            const updated_user = await user_service.patch_user(user_id, data);

            logger.debug("Updated user ==> ", updated_user)

            res.status(200).json({
                code: 200,
                message: "User updated successfully",
                data: updated_user
            });
            return
        } catch (error) {
            logger.error(`Error in patch_user: ${error}`);
            next(error);
            return
        }
    }

    verify_mpin = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user_id = req.user!.id;
            const { mpin } = verify_mpin_schema.parse(req.body);

            logger.info(`Verifying MPIN for User ID: ${user_id}`);
            const result = await user_service.verify_mpin(user_id, mpin);

            if (!result.is_verified) {
                logger.warn(`Invalid MPIN for User ID: ${user_id}`);
                res.status(401).json({
                    code: 401,
                    message: "Invalid MPIN",
                    data: { verified: false }
                });
                return;
            }

            logger.debug("MPIN verified for user ==> ", user_id)


            res.status(200).json({
                code: 200,
                message: "MPIN verified successfully",
                data: {
                    verified: true,
                    token: result.token,
                    refresh_token: result.refresh_token
                }
            });
            return;
        } catch (error) {
            logger.error(`Error in verify_mpin: ${error}`);
            next(error);
            return;
        }
    }










    // ================================ HELPER FUNCTIONS ================================

    private extract_cart_items = (finnsys_cart_response: any) => {
        const sip_items: any = [];
        const lump_sum_items: any = [];

        finnsys_cart_response.results.length > 0 ? finnsys_cart_response.results.map((item: any) => {
            if (item.sub_txn_type === "S") {
                sip_items.push(item);
            } else {
                lump_sum_items.push(item);
            }
        }) : null;
        return { sip_items, lump_sum_items };
    }


    private calculate_kyc_progress = (kyc_types: { status: string, kyc_type: string }[]): number => {
        const total = 2;
        const completed = kyc_types.filter((kyc) => kyc.status === "verified").length;
        return total > 0 ? Math.round((completed / total) * 100) : 0;
    }
}
export const user_controller = new UserFinanceControllerClass();