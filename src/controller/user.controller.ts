import { NextFunction, Request, Response } from "express";
import { user_patch_schema, verify_mpin_schema } from "../lib/zod-schemas/user.schema.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { fire_report_service } from "../services/fire.report.service.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";
import { user_savings_service } from "../services/user.savings.service.js";
import { user_service } from "../services/user.service.js";
import { pending_orders_service } from "../services/pending_orders.service.js";
import { wrapper_service } from "../services/wrapper.service.js";
import { Prisma, UserGoals } from "../prisma/generated/prisma/client.js";
import { user_goal_controller } from "./user.goal.controller.js";
import { redis } from "../lib/redis.js";
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
                kyc_types: true
            });

            logger.debug(`User data fetched successfully ==> `, data);

            const { fire_number, net_worth, total_expenses, fire_percentage } = await fire_report_service.get_current_fire_number(user_id);

            const user = req.user!;
            let goalIdToCurrvalMap = new Map<string, number>();
            try {
                const portfolio_res = await wrapper_service.get_user_portfolio_cached(user_id, user.log, user.pwd);
                if (portfolio_res && portfolio_res.results) {
                    portfolio_res.results.forEach((item: any) => {
                        if (item.gid) {
                            const currval = this.toNumber(item.currval);
                            const existing = goalIdToCurrvalMap.get(String(item.gid)) || 0;
                            goalIdToCurrvalMap.set(String(item.gid), existing + currval);
                        }
                    });
                }
            } catch (error) {
                logger.warn("Failed to fetch portfolio for mapping goals currval in get_user", error);
            }

            const wrapper_user_goal = data.user_goals.length > 0 ? data.user_goals.map((goal: UserGoals, index: number) => {

                if (goal.goal_id) {
                    const current_value = goalIdToCurrvalMap.get(String(goal.goal_id)) || 0;
                    if (current_value > 0) {
                        const total_amount = Math.abs(Number(goal.current_saved_amount || 0)) + current_value;
                        (goal as any).current_saved_amount = new Prisma.Decimal(Math.round(total_amount));
                    }
                }

                if (goal.goal_type_id === 3) {
                    const years_to_retirement = (goal.retirement_age ?? 0) - (goal.current_age ?? 0);
                    const years_post_retirement = (goal.life_expectancy ?? 0) - (goal.retirement_age ?? 0);

                    const corpus_value = user_goal_controller.calculate_corpus_value(
                        Number(goal.current_monthly_expense ?? 0),
                        Number(goal.inflation_rate ?? 0) / 100,       // stored as % (e.g. 7), formula needs 0.07
                        Number(goal.post_retirement_return ?? 0) / 100, // stored as % (e.g. 6), formula needs 0.06
                        years_to_retirement,
                        years_post_retirement
                    );

                    (goal as any).current_goal_cost = new Prisma.Decimal(Math.round(corpus_value));
                    logger.debug(`Computed corpus value for retirement goal ${goal.goal_id}: ${corpus_value}`);
                }
                return goal;
            }) : data.user_goals

            res.status(200).json({
                code: 200,
                message: "User data fetched successfully",
                data: {
                    ...data,
                    user_goals: wrapper_user_goal,
                    kyc_types: data?.kyc_types?.reduce((acc: any, kyc: any) => {
                        acc[kyc.kyc_type] = {
                            status: kyc.status
                        };
                        return acc;
                    }, {}) || {},
                    kyc_progress: this.calculate_kyc_progress(data?.kyc_types || []),
                    user_home_data: {
                        fire_number,
                        net_worth,
                        total_expenses,
                        fire_percentage
                    }
                }
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
            const amc_set = new Set<string>();
            sip_items.forEach((item: any) => {
                if (item.amc_name) amc_set.add(item.amc_name);
            });
            lump_sum_items.forEach((item: any) => {
                if (item.amc_name) amc_set.add(item.amc_name);
            });

            const amc_names = Array.from(amc_set);
            const logo_map = await wrapper_service.get_logos_of_amc(amc_names);

            const prod_codes: string[] = [];
            sip_items.forEach((item: any) => prod_codes.push(item.prod_code));
            lump_sum_items.forEach((item: any) => prod_codes.push(item.prod_code));

            const rules_map = await wrapper_service.get_transaction_rules_by_nse_codes(prod_codes);

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

            if (!user || !user.nse_client_code) {
                throw new AppError("User Finnsys credentials or client code not found", 400, "MISSING_FINNSYS_CREDENTIALS");
            }

            const data = await pending_orders_service.get_pending_orders(
                usr.log!,
                usr.pwd!,
                user.nse_client_code
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
            logger.info(`Fetching user portfolio for User ID: ${user.id} user ${user.log} pwd ${user.pwd}`);

            let user_portfolio_finnsys_res = await wrapper_service.get_user_portfolio_cached(user.id, user.log!, user.pwd!);

            if (!user_portfolio_finnsys_res || (user_portfolio_finnsys_res.code != 1 && user_portfolio_finnsys_res.code != 0)) {
                logger.warn(`Failed to fetch user portfolio from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_portfolio_finnsys_res?.code}`);
                throw new AppError("Failed to fetch user portfolio from Finnsys", 502, "FINNSYS_PORTFOLIO_FETCH_FAILED");
            }

            const user_mf_data = user_portfolio_finnsys_res.results || []

            const investment_data = user_mf_data.length > 0 ? user_mf_data.reduce((acc: any, item: any) => {
                const invested = this.toNumber(item.purcost);
                const current = this.toNumber(item.currval);
                const pl = this.toNumber(item.pl)

                acc.invested_amount += invested;
                acc.current_value += current;
                acc.total_returns += pl;
                return acc;
            }, {
                current_value: 0,
                invested_amount: 0,
                total_returns: 0,
            }) : {
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
            investment_data.items_count = user_mf_data.length;
            logger.debug(`Calculated user investment data ==> `, investment_data);

            // Group by actualfolio
            const foliosMap = new Map<string, any>();

            logger.debug("user mf data from finnsys --> ", user_mf_data)
            user_mf_data.forEach((item: any) => {
                const folio = item.actualfolio;
                const actual_folio = item.folio;
                if (!folio) return;

                if (!foliosMap.has(folio)) {
                    foliosMap.set(folio, {
                        folio: folio,
                        actual_folio: actual_folio,
                        first_scheme_id: item.schemeid,
                        category: item.schemetype,
                        amount: 0,
                        current_value: 0,
                        return: 0,
                        bal_units: 0,
                    });
                }

                const folioGroup = foliosMap.get(folio);
                folioGroup.amount += this.toNumber(item.purcost);
                folioGroup.current_value += this.toNumber(item.currval);
                folioGroup.return += this.toNumber(item.pl);
                folioGroup.bal_units += this.toNumber(item.balunits)
            });

            // Get AMC details for the first scheme in each folio
            const first_scheme_ids = Array.from(foliosMap.values()).map((f: any) => String(f.first_scheme_id)).filter(Boolean);
            const amc_details_map = await wrapper_service.getAmcDetailsForSchemes(first_scheme_ids);

            const mf_investment_items = Array.from(foliosMap.values()).map((f: any) => {
                const amc_details = amc_details_map.get(String(f.first_scheme_id)) || { amc_name: "Mutual Fund", img_url: "", product_id: "", transaction_rules: {} };
                logger.debug("One folio ==> ", f)
                return {
                    id: amc_details.product_id,
                    scheme_id: f.first_scheme_id,
                    title: amc_details.amc_name || "Mutual Fund",
                    category: f.category,
                    amount: Number(f.amount.toFixed(2)),
                    current_value: Number(f.current_value.toFixed(2)),
                    return: Number(f.return.toFixed(2)),
                    return_percentage: f.amount > 0 ? Number(((f.return / f.amount) * 100).toFixed(2)) + "%" : "0.00%",
                    folio: f.folio,
                    actual_folio: f.actual_folio,
                    bal_units: Number(f.bal_units.toFixed(2)),
                    img_url: amc_details.img_url,
                    transaction_rules: this.extract_relevant_transaction_rules(amc_details.transaction_rules)
                };
            });

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
            min_investment_amount: rules.min_investment_amount,
            min_lumpsum_add_on_amount: rules.min_lumpsum_add_on_amount,
            min_redem_qty: rules.min_redem_qty,
            min_redem_amount: rules.min_redem_amount,
            min_sip_amount: rules.min_sip_amount // default fallback
        };

        if (sip_freq) {
            switch (sip_freq) {
                case "DZ":
                case "D":
                    clean_rules.min_sip_amount = rules.min_daily_sip_amount ?? clean_rules.min_sip_amount;
                    break;
                case "OW":
                case "WD":
                    clean_rules.min_sip_amount = rules.min_weekly_sip_amount ?? clean_rules.min_sip_amount;
                    break;
                case "OM":
                    clean_rules.min_sip_amount = rules.min_monthly_sip_amount ?? clean_rules.min_sip_amount;
                    break;
                case "Q":
                    clean_rules.min_sip_amount = rules.min_quarterly_sip_amount ?? clean_rules.min_sip_amount;
                    break;
                case "H":
                    clean_rules.min_sip_amount = rules.min_semi_annual_sip_amount ?? clean_rules.min_sip_amount;
                    break;
                case "Y":
                    clean_rules.min_sip_amount = rules.min_annual_sip_amount ?? clean_rules.min_sip_amount;
                    break;
            }
        }

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

            let user_portfolio_finnsys_res = await wrapper_service.get_user_portfolio_cached(user.id, user.log!, user.pwd!);

            if (!user_portfolio_finnsys_res || (user_portfolio_finnsys_res.code != 1 && user_portfolio_finnsys_res.code != 0)) {
                throw new AppError("Failed to fetch user portfolio from Finnsys", 502, "FINNSYS_PORTFOLIO_FETCH_FAILED");
            }

            const user_mf_data = user_portfolio_finnsys_res.results || [];

            // Filter by folio
            const folio_items = user_mf_data.filter((item: any) => item.actualfolio === folio_id);

            const mf_scheme_ids = folio_items.map((item: any) => String(item.schemeid)).filter(Boolean);
            const amc_details_map = await wrapper_service.getAmcDetailsForSchemes(mf_scheme_ids);

            const mf_investment_items = folio_items.map((item: any) => {
                const amc_details = amc_details_map.get(String(item.schemeid));

                return {
                    id: amc_details?.product_id,
                    scheme_id: item.schemeid,
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
                    folio: item.actualfolio,
                    actual_folio: item.folio,
                    balance_units: item.balunits,
                    img_url: amc_details?.img_url || ""
                };
            });

            logger.debug("Mf investment items ==> ", mf_investment_items)
            let final_investment_items = mf_investment_items;

            // Merge xSIP details into the items if any item has a SIP
            // Finnsys portfolio API flags is_sip but doesn't return SIP registration details
            // (xsip_reg_no/order_id, sip_amount, sip_status), so we cross-reference the xSIP
            // registration report by (actual_folio, scheme_id) to fill them in.
            // NOTE: if this fetch/match fails, items silently stay un-enriched (no error surfaced).
            const has_sips = mf_investment_items.some(item => item.is_sip === true);
            if (has_sips) {
                logger.debug(`User folio funds have sip funds... Checking xSIP report for order_id (xsip reg number)`)
                const user_data = await user_service.get_user_by_id(user.id);

                logger.debug('User data --> ', user_data)
                if (user_data && user_data.nse_client_code) {
                    const xsip_report = await wrapper_service.get_xsip_registration_report_cached(user_data.nse_client_code, user.log!, user.pwd!);

                    logger.debug(`Xsip report ==> `, xsip_report)
                    if (xsip_report && (xsip_report.code == 1 || xsip_report.code == 0) && xsip_report.data && xsip_report.data.report_data) {
                        final_investment_items = mf_investment_items.map((item: any) => {
                            if (item.is_sip === true) {

                                logger.debug(`Checking ${item.folio} / ${item.scheme_id}`)
                                const matching_sip = xsip_report.data.report_data.find((sip: any) =>
                                    sip.folio_number === item.actual_folio
                                    // sip.rta_scheme_code === item.scheme_id
                                );

                                logger.debug(`matching sip found.....`, matching_sip)

                                if (matching_sip) {
                                    return {
                                        ...item,
                                        xsip_reg_no: matching_sip.xsip_registration_no,
                                        order_id: matching_sip.xsip_registration_no,
                                        sip_amount: Number(String(matching_sip.installments_amount).replace(/,/g, "")),
                                        sip_status: matching_sip.status
                                    };
                                }
                            }
                            return item;
                        });
                    }
                }
            }

            res.status(200).json({
                code: 200,
                message: "Folio details fetched successfully",
                data: final_investment_items
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