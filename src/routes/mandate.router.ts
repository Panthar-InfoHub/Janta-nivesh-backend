import { Router } from "express";
import { mandate_controller } from "../controller/mandate.controller.js";
import { login_require } from "../middleware/session.middleware.js";

export const mandate_router = Router();

mandate_router.post("/", login_require, mandate_controller.create_and_authorize_mandate);
mandate_router.get("/", login_require, mandate_controller.get_mandates);
mandate_router.get("/:mandate_id", login_require, mandate_controller.fetch_mandate);
