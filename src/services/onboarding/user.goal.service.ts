import axios from "axios";
import { env } from "../../lib/config-env.js";
import { UserGoalInput } from "../../lib/zod-schemas/goal.schema.js";
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

    createGoal = async (user: any, data: UserGoalInput) => {
        // Store in Database
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

        // API Params mapping based on FinSys requirements
        const params = this.extract_params(user, data);

        const res = await axios.get(this.finsys_api, { params });

        logger.debug("Finsys goal res ==> ", res.data);

        if (res.data.results[0]?.gid) {
            // Update goal_id in UserGoals table
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

    updateGoal = async (user: any, goal_id: number, data: UserGoalInput) => {
        // 1. Update in Database
        await db.userGoals.updateMany({
            where: {
                user_id: user.id,
                goal_id: goal_id
            },
            data: {
                ...data
            }
        });

        // 2. API Params mapping (same as create but with gid)
        const params: any = this.extract_params(user, data);
        params.gid = goal_id;

        const res = await axios.get(this.finsys_api, { params });
        return res.data;
    }


    delete_goal = async (user: any, goal_id: string) => {
        const user_goal = await db.userGoals.delete({
            where: {
                user_id: user.id,
                id: goal_id
            }
        });
        return user_goal;
    }

    sync_db = async (user_id: string, goals: UserGoalInput[], tx: TxClient | typeof db = db) => {
        await tx.userGoals.deleteMany({ where: { user_id } });
        if (goals.length > 0) {
            await tx.userGoals.createMany({
                data: goals.map((goal) => ({ user_id, ...goal })),
            });
        }
    }

    sync_finsys = async (user: any, goals: UserGoalInput[]) => {
        const db_goals = await db.userGoals.findMany({
            where: { user_id: user.id },
            select: { id: true, goal_type_id: true },
        });

        await Promise.all(goals.map(async (goal) => {
            const db_goal = db_goals.find((g) => g.goal_type_id === goal.goal_type_id);
            if (!db_goal) return;

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