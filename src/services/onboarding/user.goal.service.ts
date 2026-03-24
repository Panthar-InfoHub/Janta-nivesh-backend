import axios from "axios";
import { env } from "../../lib/config-env.js";
import { UserGoalInput } from "../../lib/zod-schemas/goal.schema.js";
import AppError from "../../middleware/error.middleware.js";
import logger from "../../middleware/logger.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";
import { db } from "../../server.js";

type TxClient = Prisma.TransactionClient;

class UserGoalServiceClass {
    finsys_api: string;

    constructor() {
        this.finsys_api = `${env.finsys_base_api}/finnsys/app/master.service.asp`;
    }

    private extract_params = (user: any, data: UserGoalInput) => {
        let params: any = {
            log: user.log,
            pwd: user.pwd,
            svc: "setgoal",
            gtp: data.goal_type_id,
            tojson: 1,
            "PROCEED.x": 1
        };

        if (data.goal_type_id === 1 || data.goal_type_id === 2) {
            params.C_NAME_1 = data.child_name;
            params.C_AGE_1 = data.child_age;
            params.C_YEAR_1 = data.years_left;
            params.C_COST_1 = data.current_goal_cost;
        } else if (data.goal_type_id === 3) {
            params.H_CURR_AGE_1 = data.current_age;
            params.C_RET_AGE_1 = data.retirement_age;
            params.C_LIFE_EXP_1 = data.life_expectancy;
            params.C_MONTHLY_SPENDING_1 = data.current_monthly_expense;
            params.C_RET_POST_1 = data.post_retirement_return;
        } else if (data.goal_type_id >= 4) {
            params.gtp = 4;
            params.GOAL_ITEM_1 = data.goal_item_id;
            params.GOAL_NAME_1 = data.goal_name;
            params.C_YEAR_1 = data.years_left;
            params.C_COST_1 = data.current_goal_cost;
        }

        params.C_INF_1 = data.inflation_rate;
        params.C_RET_1 = data.return_rate;
        params.C_SAVING_1 = data.current_saved_amount;

        return params;
    }

    createGoalOnboarding = async (user: any, data: UserGoalInput) => {
        const user_goal = await db.userGoals.upsert({
            where: {
                user_goal_type_idx: {
                    user_id: user.id,
                    goal_type_id: data.goal_type_id
                }
            },
            update: {
                ...data
            },
            create: {
                user_id: user.id,
                ...data
            }
        });

        const params = this.extract_params(user, data);
        const res = await axios.get(this.finsys_api, { params });

        logger.debug("Finsys goal res ==> ", res.data);

        if (res.data.results?.[0]?.gid) {
            await db.userGoals.update({
                where: {
                    id: user_goal.id
                },
                data: {
                    goal_id: parseInt(res.data.results[0]?.gid)
                }
            });
        }
        return res.data;
    }

    createGoal = async (user: any, data: UserGoalInput) => {
        const user_goal = await db.userGoals.create({
            data: {
                user_id: user.id,
                ...data
            }
        });

        const params = this.extract_params(user, data);
        const res = await axios.get(this.finsys_api, { params });

        logger.debug("Finsys goal res ==> ", res.data);

        if (res.data.results?.[0]?.gid) {
            await db.userGoals.update({
                where: {
                    id: user_goal.id
                },
                data: {
                    goal_id: parseInt(res.data.results[0]?.gid)
                }
            });
        }

        return res.data;
    }

    updateGoal = async (user: any, goal_record_id: string, data: UserGoalInput) => {
        const existing_goal = await db.userGoals.findFirst({
            where: {
                user_id: user.id,
                id: goal_record_id
            },
            select: {
                id: true,
                goal_id: true,
            }
        });

        if (!existing_goal) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        await db.userGoals.update({
            where: {
                id: existing_goal.id,
            },
            data: {
                ...data,
            },
        });

        const params: any = this.extract_params(user, data);
        if (existing_goal.goal_id) {
            params.gid = existing_goal.goal_id;
        }

        const res = await axios.get(this.finsys_api, { params });

        if (!existing_goal.goal_id && res.data.results?.[0]?.gid) {
            await db.userGoals.update({
                where: { id: existing_goal.id },
                data: { goal_id: parseInt(res.data.results[0].gid) },
            });
        }

        return res.data;
    }


    delete_goal = async (user: any, goal_record_id: string) => {
        const existing_goal = await db.userGoals.findFirst({
            where: {
                user_id: user.id,
                id: goal_record_id,
            },
        });

        if (!existing_goal) {
            throw new AppError("Goal not found", 404, "GOAL_NOT_FOUND");
        }

        const user_goal = await db.userGoals.delete({
            where: {
                id: existing_goal.id
            }
        });

        return user_goal;
    }

    sync_db = async (user_id: string, goals: UserGoalInput[], tx: TxClient | typeof db = db) => {
        const created_goals: Array<{ id: string; goal_type_id: number; }> = [];

        await tx.userGoals.deleteMany({ where: { user_id } });

        for (const goal of goals) {
            const created_goal = await tx.userGoals.create({
                data: { user_id, ...goal },
                select: { id: true, goal_type_id: true },
            });

            created_goals.push(created_goal);
        }

        return created_goals;
    }

    sync_finsys = async (user: any, goals: UserGoalInput[], db_goals?: Array<{ id: string; goal_type_id: number; }>) => {
        const fallback_db_goals = db_goals ?? await db.userGoals.findMany({
            where: { user_id: user.id },
            select: { id: true, goal_type_id: true },
            orderBy: { createdAt: "asc" },
        });

        await Promise.all(goals.map(async (goal, index) => {
            const db_goal = fallback_db_goals[index] ?? fallback_db_goals.find((g) => g.goal_type_id === goal.goal_type_id);
            if (!db_goal) {
                logger.warn(`No matching DB goal found while syncing goal_type_id ${goal.goal_type_id}`);
                return;
            }

            const params = this.extract_params(user, goal);
            try {
                const res = await axios.get(this.finsys_api, { params });
                logger.debug(`FinSys goal sync res for type ${goal.goal_type_id} ==> `, res.data);

                if (res.data.results?.[0]?.gid) {
                    await db.userGoals.update({
                        where: { id: db_goal.id },
                        data: { goal_id: parseInt(res.data.results[0].gid) },
                    });
                }
            } catch (err) {
                logger.error(`FinSys sync failed for goal_type_id ${goal.goal_type_id}:`, err);
            }
        }));
    }

    async delete_all_goals(user_id: string, tx: TxClient | typeof db = db) {
        return await tx.userGoals.deleteMany({
            where: {
                user_id: user_id,
            },
        });
    }
}



export const user_goal_service = new UserGoalServiceClass();