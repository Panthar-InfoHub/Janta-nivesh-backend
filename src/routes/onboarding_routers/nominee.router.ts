import { Router } from "express";
import { nominee_controller } from "../../controller/onboarding/nominee.controller.js";
import { login_require } from "../../middleware/session.middleware.js";

export const nominee_router = Router();

nominee_router.post("/", login_require, nominee_controller.submit_nominees);
nominee_router.get("/", login_require, nominee_controller.get_nominees);
nominee_router.patch("/:id", login_require, nominee_controller.update_nominee);
nominee_router.delete("/:id", login_require, nominee_controller.delete_nominee);
