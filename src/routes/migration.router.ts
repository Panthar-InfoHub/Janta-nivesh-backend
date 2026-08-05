import { Router } from "express";
import { amount_data_migration, bundle_logo_data_migrate, data_migrate, get_all_user_data } from "../controller/migration.js";

export const migration_router = Router();

migration_router.post("/min", data_migrate)
migration_router.post("/bundle-logo-data", bundle_logo_data_migrate)
migration_router.get("/get-all-user-data", get_all_user_data)
migration_router.post("/amount", amount_data_migration)