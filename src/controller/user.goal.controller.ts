import { NextFunction, Request, Response } from "express";
import {
    goal_calculate_schema,
    user_goal_update_zod_schema,
    user_goal_zod_schema,
    map_goal_holding_schema,
    unmap_goal_holding_schema,
    GoalCalculateInput,
    UserGoalInput,
    UserGoalUpdateInput,
    MapGoalHoldingInput,
    UnmapGoalHoldingInput
} from "../lib/zod-schemas/goal.schema.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { user_goal_service } from "../services/onboarding/user.goal.service.js";

class UserGoalControllerClass {
    /**
     * GET /api/v2/user-goal/config
     * Returns supported goal types, calculation modes, allowed tenure ranges, chips, and default rates.
     */
    get_config = async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.debug(`User goal config request..`)
            const config = await user_goal_service.getConfig();
            res.status(200).json({
                success: true,
                message: "Goal configuration fetched successfully",
                data: config,
            });
        } catch (error) {
            logger.error("Error in get_config:", error);
            next(error);
        }
    };

    /**
     * POST /api/v2/user-goal/calculate
     * Stateless calculation preview endpoint for sliders and interactive simulators.
     */
    calculate = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const input: GoalCalculateInput = goal_calculate_schema.parse(req.body);
            const result = await user_goal_service.calculate(input);

            res.status(200).json({
                success: true,
                message: "Goal projection calculated successfully",
                data: result,
            });
        } catch (error) {
            logger.error("Error in calculate goal preview:", error);
            next(error);
        }
    };

    /**
     * POST /api/v2/user-goal
     * Creates and saves a goal with computed projection snapshot.
     */
    create = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const data: UserGoalInput = user_goal_zod_schema.parse(req.body);

            const result = await user_goal_service.createGoal(user.id, data);

            res.status(201).json({
                success: true,
                message: "Goal created successfully",
                data: result,
            });
        } catch (error) {
            logger.error("Error in createGoal:", error);
            next(error);
        }
    };

    /**
     * GET /api/v2/user-goal
     * Lists all active goals for authenticated user with live progress.
     */
    get_all = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const goals = await user_goal_service.getUserGoals(user.id);

            res.status(200).json({
                success: true,
                message: "User goals fetched successfully",
                data: goals,
            });
        } catch (error) {
            logger.error("Error in get_all user goals:", error);
            next(error);
        }
    };

    /**
     * GET /api/v2/user-goal/:id
     * Returns a single goal by ID.
     */
    get_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const goal_id = req.params.id as string;

            if (!goal_id) {
                throw new AppError("Goal ID is required", 400, "GOAL_ID_REQUIRED");
            }

            const goal = await user_goal_service.getGoalById(user.id, goal_id);

            res.status(200).json({
                success: true,
                message: "Goal fetched successfully",
                data: goal,
            });
        } catch (error) {
            logger.error("Error in get_by_id:", error);
            next(error);
        }
    };

    /**
     * PATCH /api/v2/user-goal/:id
     * Updates goal inputs and recalculates projection metrics.
     */
    update = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const goal_id = req.params.id as string;

            if (!goal_id) {
                throw new AppError("Goal ID is required", 400, "GOAL_ID_REQUIRED");
            }

            const data: UserGoalUpdateInput = user_goal_update_zod_schema.parse(req.body);
            const result = await user_goal_service.updateGoal(user.id, goal_id, data);

            res.status(200).json({
                success: true,
                message: "Goal updated successfully",
                data: result,
            });
        } catch (error) {
            logger.error("Error in update goal:", error);
            next(error);
        }
    };

    /**
     * DELETE /api/v2/user-goal/:id
     * Deletes / archives a goal.
     */
    delete_goal = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const goal_id = req.params.id as string;

            if (!goal_id) {
                throw new AppError("Goal ID is required", 400, "GOAL_ID_REQUIRED");
            }

            const result = await user_goal_service.deleteGoal(user.id, goal_id);

            res.status(200).json({
                success: true,
                message: "Goal deleted successfully",
                data: result,
            });
        } catch (error) {
            logger.error("Error in delete_goal:", error);
            next(error);
        }
    };

    /**
     * POST /api/v2/user-goal/map
     * Maps one or more mutual fund holdings to a goal.
     */
    map_holdings = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const { goal_id, holding_ids } = map_goal_holding_schema.parse(req.body);

            const result = await user_goal_service.mapHoldingsToGoal(user.id, goal_id, holding_ids);

            res.status(200).json({
                success: true,
                message: "Holdings mapped to goal successfully",
                data: result,
            });
        } catch (error) {
            logger.error("Error in map_holdings:", error);
            next(error);
        }
    };

    /**
     * POST /api/v2/user-goal/unmap or /api/v2/user-goal/remove
     * DELETE /api/v2/user-goal/map or /api/v2/user-goal/remove
     * Unmaps one or more mutual fund holdings from a goal.
     */
    unmap_holdings = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const payload = {
                goal_id: req.body?.goal_id || req.query?.goal_id,
                holding_ids: req.body?.holding_ids || req.body?.holding_id || req.query?.holding_ids || req.query?.holding_id,
                holding_id: req.body?.holding_id || req.query?.holding_id,
            };
            const { goal_id, holding_ids } = unmap_goal_holding_schema.parse(payload);

            const result = await user_goal_service.unmapHoldingsFromGoal(user.id, holding_ids, goal_id);

            res.status(200).json({
                success: true,
                message: "Holdings unmapped from goal successfully",
                data: result,
            });
        } catch (error) {
            logger.error("Error in unmap_holdings:", error);
            next(error);
        }
    };

    /**
     * Onboarding helper
     */
    onboarding_create = async (req: Request) => {
        const user = req.user!;
        const data: UserGoalInput = user_goal_zod_schema.parse(req.body);
        return await user_goal_service.createGoal(user.id, data);
    };
}

export const user_goal_controller = new UserGoalControllerClass();