import { NextFunction, Request, Response } from "express";
import { user_loan_zod_schema, UserLoanInput } from "../lib/zod-schemas/loan.schema.js";
import logger from "../middleware/logger.js";
import { user_loan_service } from "../services/onboarding/user.loan.service.js";
import AppError from "../middleware/error.middleware.js";

class UserLoanControllerClass {
    onboarding_create = async (req: Request) => {
        const user = req.user!;
        const data = req.body;

        logger.debug(`Processing onboarding loan for User ID: ${user.id}`);

        // verify loan data here using zod schema
        const validated_data: UserLoanInput = user_loan_zod_schema.parse(data);
        return await user_loan_service.create(user.id, validated_data);
    }

    create = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await this.onboarding_create(req);

            res.status(200).json({
                success: true,
                message: "Loan created successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in create loan:", error);
            next(error);
            return;
        }
    }

    update = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const loan_id = req.params.loan_id as string;
            const data = req.body;

            if (!loan_id) {
                throw new AppError("loan_id is required", 400);
            }

            // verify loan data here using zod schema
            const validated_data: UserLoanInput = user_loan_zod_schema.parse(data);

            const result = await user_loan_service.update(loan_id, user.id, validated_data);
            logger.debug(`Updated loan data ==> `, result);

            res.status(200).json({
                success: true,
                message: "Loan updated successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in update loan:", error);
            next(error);
            return;
        }
    }

    get_all = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const result = await user_loan_service.getAll(user.id, { page, limit });
            logger.debug(`Fetched loans for User ID: ${user.id} ==> `, result.pagination.total_loans);

            res.status(200).json({
                success: true,
                message: "Loans fetched successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in getAll loans:", error);
            next(error);
            return;
        }
    }

    get_loan_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const loan_id = req.params.loan_id as string;

            if (!loan_id) {
                throw new AppError("loan_id is required", 400);
            }

            const result = await user_loan_service.get_by_id(loan_id, user.id);
            logger.debug(`Fetched loan for User ID: ${user.id}, Loan ID: ${loan_id} ==> `, result);

            if (!result) {
                throw new AppError("Loan not found", 404);
            }

            res.status(200).json({
                success: true,
                message: "Loan fetched successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in getById loan:", error);
            next(error);
            return;
        }
    }

    delete = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const loan_id = req.params.loan_id as string;

            if (!loan_id) {
                throw new AppError("loan_id is required", 400);
            }

            await user_loan_service.delete(loan_id, user.id);
            logger.debug(`Deleted loan for User ID: ${user.id}, Loan ID: ${loan_id}`);

            res.status(200).json({
                success: true,
                message: "Loan deleted successfully"
            });
            return;
        } catch (error) {
            logger.error("Error in delete loan:", error);
            next(error);
            return;
        }
    }
}

export const user_loan_controller = new UserLoanControllerClass();