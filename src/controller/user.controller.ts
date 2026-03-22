import { NextFunction, Request, Response } from "express";
import logger from "../middleware/logger.js";
import { user_service } from "../services/user.service.js";
import AppError from "../middleware/error.middleware.js";

class UserFinanceControllerClass {
    async onboarding_create(req: Request) {
        const user = req.user!;
        const { current_step, ...data }: any = req.body;

        logger.debug(`Processing onboarding finance for User ID: ${user.id} with current_step: ${current_step}`);

        // const validated_data: UserFinanceInput = user_finance_zod_schema.parse(data);
        return await user_service.update_user(user.id, data);
    }


    async get_user(req: Request, res: Response, next: NextFunction) {
        try {

            const user_id: string = req.user!.id;
            logger.info(`Fetching user data for User ID: ${user_id}`);

            const data = await user_service.get_all_user_data(user_id, {
                user_goals: true,
                user_insurance: true,
                user_loan: true,
                user_assets: true,
                user_finance: true
            });

            logger.debug(`User data fetched successfully ==> `, data);

            res.status(200).json({
                code: 200,
                message: "User data fetched successfully",
                data
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
}

export const user_controller = new UserFinanceControllerClass();