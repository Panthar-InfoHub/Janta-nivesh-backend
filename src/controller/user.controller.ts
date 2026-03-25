import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { user_service } from "../services/user.service.js";
import AppError from "../middleware/error.middleware.js";
import { fire_report_service } from "../services/fire.report.service.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";

class UserFinanceControllerClass {
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

            const { fire_number, net_worth, total_expenses } = await fire_report_service.get_current_fire_number(user_id);

            // const fire_number_inc = (total_expenses_inc + goal_commitment_annual) * FIRE_CONSTANTS.fire_factor;

            res.status(200).json({
                code: 200,
                message: "User data fetched successfully",
                data: {
                    ...data,
                    kyc_progress: this.calculate_kyc_progress(data?.kyc_types || []),
                    user_home_data: {
                        fire_number,
                        net_worth,
                        total_expenses
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
        const total = kyc_types.length;
        const completed = kyc_types.filter((kyc) => kyc.status === "verified").length;
        return total > 0 ? Math.round((completed / total) * 100) : 0;
    }
}
export const user_controller = new UserFinanceControllerClass();