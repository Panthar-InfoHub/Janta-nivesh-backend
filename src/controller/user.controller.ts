import { NextFunction, Request, Response } from "express";
import { user_patch_schema, verify_mpin_schema } from "../lib/zod-schemas/user.schema.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import { fire_report_service } from "../services/fire.report.service.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";
import { user_savings_service } from "../services/user.savings.service.js";
import { user_service } from "../services/user.service.js";

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

            // const fire_number_inc = (total_expenses_inc + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;

            res.status(200).json({
                code: 200,
                message: "User data fetched successfully",
                data: {
                    ...data,
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

            if (user_cart_res.code != 1) {
                logger.warn(`Failed to fetch user cart from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_cart_res.code}`);
                throw new AppError("Failed to fetch user cart from Finnsys", 502, "FINNSYS_CART_FETCH_FAILED");
            }

            const { sip_items, lump_sum_items } = this.extract_cart_items(user_cart_res);

            res.status(200).json({
                code: 200,
                message: "User cart fetched successfully",
                data: {
                    sip_items,
                    lump_sum_items
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


    get_user_portfolio = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            logger.info(`Fetching user portfolio for User ID: ${user.id} user ${user.log} pwd ${user.pwd}`);

            const user_portfolio_finnsys_res = await user_finnsys_service.get_user_portfolio_finnsys(user.log!, user.pwd!)

            logger.debug(`User portfolio fetched from Finnsys successfully ==> `, user_portfolio_finnsys_res);

            if (user_portfolio_finnsys_res.code != 1 && user_portfolio_finnsys_res.code != 0) {
                logger.warn(`Failed to fetch user portfolio from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_portfolio_finnsys_res.code}`);
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
            logger.debug(`Calculated user investment data ==> `, investment_data);

            const mf_investment_items = user_mf_data.length > 0 ? user_mf_data.map((item: any) => ({
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
                folio: item.actualfolio,
                balance_units: item.balunits
            })) : [];

            logger.debug("Mapped user mututal fund now proceeding to user fd transactions...");
            const user_fd_transactions = await user_service.get_user_fd_data({ user_id: user.id, order: { fd_issued_at: 'desc' } });

            res.status(200).json({
                code: 200,
                message: "User portfolio fetched successfully",
                data: {
                    investment_data,
                    mutual_funds: mf_investment_items,
                    user_fd: user_fd_transactions
                }
            });
            return;
        } catch (error) {
            logger.error(`Error in getting user portfolio: `, error);
            next(error);
            return;
        }
    }

    get_investment_rate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            logger.info(`Fetching investment rate data for User ID: ${user.id}`);

            // Step 1: Fetch portfolio data (reuse existing portfolio logic)
            const user_portfolio_finnsys_res = await user_finnsys_service.get_user_portfolio_finnsys(
                user.log!,
                user.pwd!
            );

            logger.debug(`User portfolio fetched from Finnsys successfully`);

            if (user_portfolio_finnsys_res.code != 1 && user_portfolio_finnsys_res.code != 0) {
                logger.warn(
                    `Failed to fetch user portfolio from Finnsys for User ID: ${user.id}. Finnsys response code: ${user_portfolio_finnsys_res.code}`
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

            // Fetch FD transactions
            const user_fd_transactions = await user_service.get_user_fd_data({
                user_id: user.id,
                order: { fd_issued_at: "desc" },
            });

            // Build portfolio data structure for savings service
            const portfolio_data = {
                investment_data,
                mutual_funds: mf_investment_items,
                user_fd: user_fd_transactions,
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
        finnsys_cart_response.results.map((item: any) => {
            if (item.sub_txn_type === "S") {
                sip_items.push(item);
            } else {
                lump_sum_items.push(item);
            }
        })
        return { sip_items, lump_sum_items };
    }


    private calculate_kyc_progress = (kyc_types: { status: string, kyc_type: string }[]): number => {
        const total = 2;
        const completed = kyc_types.filter((kyc) => kyc.status === "verified").length;
        return total > 0 ? Math.round((completed / total) * 100) : 0;
    }
}
export const user_controller = new UserFinanceControllerClass();