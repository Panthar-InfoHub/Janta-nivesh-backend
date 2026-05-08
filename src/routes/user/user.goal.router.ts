import { Router } from "express";
import { user_goal_controller } from "../../controller/user.goal.controller.js";
import { login_require } from "../../middleware/session.middleware.js";
import { require_mfKyc, require_tradingKyc } from "../../middleware/kyc.middleware.js";

export const user_goal_router = Router();

user_goal_router.post("/", login_require, user_goal_controller.create);
user_goal_router.patch("/:goal_id", login_require, user_goal_controller.update);
user_goal_router.delete("/:goal_id", login_require, user_goal_controller.delete_goal);

user_goal_router.post("/map", login_require, require_mfKyc, require_tradingKyc, user_goal_controller.map_goal);
user_goal_router.get("/:id", login_require, require_mfKyc, require_tradingKyc, user_goal_controller.get_goal_by_id);