import { NextFunction, Request, Response } from "express";
import { user_goal_zod_schema, UserGoalInput } from "../lib/zod-schemas/goal.schema.js";
import logger from "../middleware/logger.js";
import { user_goal_service } from "../services/onboarding/user.goal.service.js";
import AppError from "../middleware/error.middleware.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";

class UserGoalControllerClass {
    async onboarding_create(req: Request) {
        const user = req.user!;
        const data = req.body;

        logger.debug(`Processing onboarding goal for User ID: ${user.id}`);

        // verify goal data here using zod schema
        const user_goal_data: UserGoalInput = user_goal_zod_schema.parse(data);
        return await user_goal_service.createGoal(user, user_goal_data);
    }

    async create(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await this.onboarding_create(req);

            res.status(200).json({
                success: true,
                message: "Goal created successfully",
                data: result
            });
            return;


        } catch (error) {
            logger.error("Error in createGoal:", error);
            next(error);
            return;
        }
    }

    async update(req: Request, res: Response, next: NextFunction) {
        try {
            const user = req.user!;
            const goal_id = req.params.goal_id as string;
            const data = req.body;

            if (!data.goal_type_id || !goal_id) {
                throw new AppError("goal_type_id and goal_id are required for updating a goal", 400);
            }

            // In this project we verify goal_id manually as it comes from params
            const gid = parseInt(goal_id);

            // verify goal data using existing zod schema
            const user_goal_data: UserGoalInput = user_goal_zod_schema.parse(data);

            const result = await user_goal_service.updateGoal(user, gid, user_goal_data);

            res.status(200).json({
                success: true,
                message: "Goal updated successfully",
                data: result
            });
            return;

        } catch (error) {
            logger.error("Error in updateGoal:", error);
            next(error);
        }
    }


    delete_goal = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const goal_id = req.params.goal_id as string;
            logger.info(`Received request to delete goal for User ID: ${user.id} with goal_id: ${goal_id}`);

            if (!goal_id) {
                logger.warn("goal_id is missing in delete_goal request");
                throw new AppError("goal_id is required for deleting a goal", 400);
            }

            const result = await user_goal_service.delete_goal(user, goal_id);

            const finnsys_goal_id = result?.goal_id;

            const finnsys_res = await user_finnsys_service.delete_user_finnsys_goal(user.log!, user.pwd!, finnsys_goal_id!);
            logger.debug(`FinSys delete goal response for goal_id ${goal_id} ==> `, finnsys_res);


            if (finnsys_res.code != "1") {
                logger.warn(`FinSys failed to delete goal with goal_id ${goal_id}. Response ==> `, finnsys_res);
                throw new AppError("Failed to delete goal from FinSys", 500, "FINNSYS_DELETE_GOAL_FAILED");
            }

            res.status(200).json({
                success: true,
                message: "Goal deleted successfully",
                data: result
            });
            return;

        } catch (error) {
            logger.error("Error in Delete goal api:", error);
            next(error);
        }
    }
}

export const user_goal_controller = new UserGoalControllerClass();