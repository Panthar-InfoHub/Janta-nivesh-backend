import { Router } from "express";
import { amount_data_migration, data_migrate } from "../controller/migration.js";

export const migration_router = Router();

migration_router.post("/min", data_migrate)
migration_router.post("/amount", amount_data_migration)