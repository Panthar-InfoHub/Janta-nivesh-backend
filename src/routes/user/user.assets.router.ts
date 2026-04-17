import { Router } from "express";
import { user_assets_controller } from "../../controller/user.assets.controller.js";

export const user_assets_router = Router();

user_assets_router.post("/", user_assets_controller.create);
user_assets_router.patch("/", user_assets_controller.update);
user_assets_router.get("/", user_assets_controller.get_user_assets);
user_assets_router.delete("/", user_assets_controller.delete);