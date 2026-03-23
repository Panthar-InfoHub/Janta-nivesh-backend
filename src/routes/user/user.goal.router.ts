import { Router } from "express";
import { user_goal_controller } from "../../controller/user.goal.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const user_goal_router = Router();

user_goal_router.post("/", login_require, user_goal_controller.create);
user_goal_router.patch("/:goal_id", login_require, user_goal_controller.update);
user_goal_router.delete("/:goal_id", login_require, user_goal_controller.delete_goal);