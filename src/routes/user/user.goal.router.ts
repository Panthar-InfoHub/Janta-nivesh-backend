import { Router } from "express";
import { user_goal_controller } from "../../controller/user.goal.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const user_goal_router = Router();

// 1. Get system config and goal metadata for frontend forms & chips
user_goal_router.get("/config", login_require, user_goal_controller.get_config);

// 2. Stateless preview simulator for interactive sliders / chips
user_goal_router.post("/calculate", login_require, user_goal_controller.calculate);

// 3. Goal CRUD operations
user_goal_router.post("/", login_require, user_goal_controller.create);
user_goal_router.get("/", login_require, user_goal_controller.get_all);
user_goal_router.get("/:id", login_require, user_goal_controller.get_by_id);
user_goal_router.patch("/:id", login_require, user_goal_controller.update);
user_goal_router.delete("/:id", login_require, user_goal_controller.delete_goal);