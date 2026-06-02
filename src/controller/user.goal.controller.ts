import { NextFunction, Request, Response } from "express";
import { goal_map_res, goal_map_zod_schema, GoalMapInput, user_goal_zod_schema, UserGoalInput } from "../lib/zod-schemas/goal.schema.js";
import logger from "../middleware/logger.js";
import { user_goal_service } from "../services/onboarding/user.goal.service.js";
import AppError from "../middleware/error.middleware.js";
import { user_finnsys_service } from "../services/user.finnsys.service.js";

class UserGoalControllerClass {

    onboarding_create = async (req: Request) => {
        const user = req.user!;
        const data = req.body;

        logger.debug(`Processing onboarding goal for User ID: ${user.id}`);

        // verify goal data here using zod schema
        const user_goal_data: UserGoalInput = user_goal_zod_schema.parse(data);
        return await user_goal_service.createGoal(user, user_goal_data);
    }

    create = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const data = req.body;

            const user_goal_data: UserGoalInput = user_goal_zod_schema.parse(data);
            const result = await user_goal_service.createGoal(user, user_goal_data);

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

    update = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const goal_record_id = req.params.goal_id as string;
            const data = req.body;

            if (!goal_record_id) {
                throw new AppError("goal_id is required for updating a goal", 400, "GOAL_ID_REQUIRED");
            }

            // verify goal data using existing zod schema
            const user_goal_data: UserGoalInput = user_goal_zod_schema.parse(data);

            const result = await user_goal_service.updateGoal(user, goal_record_id, user_goal_data);

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
            const goal_record_id = req.params.goal_id as string;
            logger.info(`Received request to delete goal for User ID: ${user.id} with goal_id: ${goal_record_id}`);

            if (!goal_record_id) {
                logger.warn("goal_id is missing in delete_goal request");
                throw new AppError("goal_id is required for deleting a goal", 400);
            }

            const result = await user_goal_service.delete_goal(user, goal_record_id);

            const finnsys_goal_id = result?.goal_id;

            if (finnsys_goal_id) {
                const finnsys_res = await user_finnsys_service.delete_user_finnsys_goal(user.log!, user.pwd!, finnsys_goal_id);
                logger.debug(`FinSys delete goal response for goal_id ${goal_record_id} ==> `, finnsys_res);

                if (String(finnsys_res.code) !== "1") {
                    logger.warn(`FinSys failed to delete goal with goal_id ${goal_record_id}. Response ==> `, finnsys_res);
                    throw new AppError("Failed to delete goal from FinSys", 500, "FINNSYS_DELETE_GOAL_FAILED");
                }
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

    map_goal = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            const goal_map_data: GoalMapInput = goal_map_zod_schema.parse(req.body);

            logger.debug(`Mapping scheme to goal for User ID: ${user.id} with data ==> `, goal_map_data);
            const { goal_id, map_data } = goal_map_data;

            const goal_res: goal_map_res[] = [];

            for (const mapping of map_data) {
                logger.debug(`Mapping scheme_id ${mapping.scheme_id} with folio ${mapping.folio} to goal_id ${goal_id} for user ${user.id}`);
                const result = await user_goal_service.map_scheme_to_goal(user.log!, user.pwd!, goal_map_data.goal_id, "ADD", {
                    folio: mapping.folio,
                    scheme_id: mapping.scheme_id
                });

                if (result.code === 0) {
                    logger.warn(`Scheme ${mapping.scheme_id} already mapped`)
                    goal_res.push({
                        code: 0,
                        message: `Scheme ${mapping.scheme_id} already mapped`,
                        folio: mapping.folio,
                        scheme_id: mapping.scheme_id
                    })
                }
                else if (result.code === 1) {
                    logger.info(`Scheme ${mapping.scheme_id} mapped successfully`)
                    goal_res.push({
                        code: 1,
                        message: `Scheme ${mapping.scheme_id} mapped successfully`,
                        folio: mapping.folio,
                        scheme_id: mapping.scheme_id
                    })
                } else {
                    logger.error(`Failed to map scheme ${mapping.scheme_id}. Response from FinSys ==> `, result);
                    throw new AppError(`Failed to map scheme ${mapping.scheme_id} to goal`, 500, "GOAL_MAPPING_FAILED", result);
                }
            }

            res.status(200).json({
                success: true,
                message: "Goal mapped successfully",
                data: goal_res
            });
            return;

        } catch (error) {
            logger.error("Error in Map goal api:", error);
            next(error);
        }
    }

    remove_goal_mapping = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user!;
            const { goal_id } = req.body;
            logger.debug(`Removing scheme mapping for User ID: ${user.id} with data ==> `, goal_id);

            const result = await user_goal_service.map_scheme_to_goal(user.log!, user.pwd!, Number(goal_id), "DEL");

            if (result.code != 0 && result.code != 1) {
                logger.error("Error while removing the mapping on goal ==> ", result)
                throw new AppError("Failed to remove goal mapping", 500, "GOAL_MAPPING_FAILED", result);
            }

            res.status(200).json({
                success: true,
                message: "Goal unmapped successfully",
                data: result
            });
            return;

        } catch (error) {
            logger.error("Error in Remove goal mapping api:", error);
            next(error);
        }
    }

    calculate_corpus_value = (currentMonthlyExpense: number, inflationRate: number, returnRate: number, yearsToRetirement: number, yearsPostRetirement: number): number => {
        if (yearsToRetirement <= 0 || yearsPostRetirement <= 0) {
            return 0;
        }

        const annualExpenseNow = currentMonthlyExpense * 12;

        const expenseAtRetirement =
            annualExpenseNow * Math.pow(1 + inflationRate, yearsToRetirement);

        const r = returnRate;
        const g = inflationRate;
        const n = yearsPostRetirement;

        if (Math.abs(r - g) < 1e-9) {
            const pv = expenseAtRetirement * (n / (1 + r));
            return pv * (1 + r);
        } else {
            const growthFactor = (1 + g) / (1 + r);
            const pv =
                expenseAtRetirement *
                (1 - Math.pow(growthFactor, n)) /
                (r - g);
            return pv * (1 + r);
        }
    }

    get_goal_by_id = async (req: Request, res: Response, next: NextFunction) => {
        try {

            const user = req.user!;
            const goal_id = req.params.id as string;

            logger.debug(`Getting goal details for User ID: ${user.id} with goal_id ==> ${goal_id}`);

            const goal = await user_goal_service.get_goal_by_id(user, goal_id);

            const goal_schemes = await user_goal_service.get_goal_scheme_mappings(user.log!, user.pwd!, Number(goal.goal_id));

            let schemes = [];

            if (goal_schemes && (goal_schemes.code != 1 && goal_schemes.code != 0)) {
                logger.error(`Failed to get goal scheme mappings for goal_id ${goal_id}. Response from FinSys ==> `, goal_schemes);
                throw new AppError(`Failed to get goal scheme mappings for goal_id ${goal_id}`, 500, "GET_GOAL_SCHEMES_FAILED", goal_schemes);
            }

            schemes = goal_schemes?.results?.map((scheme: any) => ({
                scheme_id: scheme.schemeid,
                folio: scheme.folio,
                actualfolio: scheme.actualfolio,
                scheme_name: scheme.schemename,
                bal_units: scheme.balunits,
                nav: scheme.nav,
                current_val: scheme.currval,
            }));

            const response: any = {
                ...goal,
                schemes: schemes ?? []
            }

            // For retirement goals (goal_type_id === 3), compute and append corpus value
            if (goal.goal_type_id === 3) {
                const years_to_retirement = (goal.retirement_age ?? 0) - (goal.current_age ?? 0);
                const years_post_retirement = (goal.life_expectancy ?? 0) - (goal.retirement_age ?? 0);

                const corpus_value = this.calculate_corpus_value(
                    Number(goal.current_monthly_expense ?? 0),
                    Number(goal.inflation_rate ?? 0) / 100,       // stored as % (e.g. 7), formula needs 0.07
                    Number(goal.post_retirement_return ?? 0) / 100, // stored as % (e.g. 6), formula needs 0.06
                    years_to_retirement,
                    years_post_retirement
                );

                response.current_goal_cost = Math.round(corpus_value * 100) / 100;
                logger.debug(`Computed corpus value for retirement goal ${goal_id}: ${corpus_value}`);
            }

            res.status(200).json({
                success: true,
                message: "Goal mapped successfully",
                data: response
            });
            return;

        } catch (error) {
            logger.error("Error in Map goal api:", error);
            next(error);
        }
    }
}

export const user_goal_controller = new UserGoalControllerClass();