import { Router } from "express";
import { mf_scheme_controller } from "../controller/mf-scheme.controller.js";

export const mf_scheme_router = Router();

mf_scheme_router.get("/:isin", mf_scheme_controller.get_scheme_by_isin);
