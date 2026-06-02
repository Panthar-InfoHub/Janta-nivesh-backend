import { Router } from "express";
import { data_migrate } from "../controller/migration.js";

export const migration_router = Router();

migration_router.post("/min", data_migrate)