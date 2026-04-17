import { Router } from "express";
import { bundle_controller } from "../controller/bundle.controller.js";

export const bundle_router = Router();

bundle_router.get("/", bundle_controller.get_bundles);
bundle_router.get("/:id", bundle_controller.get_bundle_by_id);
bundle_router.post("/", bundle_controller.create_bundle);
bundle_router.delete("/:id", bundle_controller.delete_bundle);
