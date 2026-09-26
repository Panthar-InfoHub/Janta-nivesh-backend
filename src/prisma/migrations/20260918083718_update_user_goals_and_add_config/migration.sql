/*
  Warnings:

  - You are about to drop the `UserGoals` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GoalAssetSubtype" AS ENUM ('BIKE', 'SCOOTER', 'CAR');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'DELETED');

-- DropForeignKey
ALTER TABLE "UserGoals" DROP CONSTRAINT "UserGoals_user_id_fkey";

-- DropTable
DROP TABLE "UserGoals";

-- CreateTable
CREATE TABLE "user_goal" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "goal_type_id" SMALLINT NOT NULL,
    "goal_name" VARCHAR(60) NOT NULL,
    "child_name" VARCHAR(50),
    "child_age" SMALLINT,
    "asset_subtype" "GoalAssetSubtype",
    "years_remaining" SMALLINT NOT NULL,
    "target_date" DATE,
    "current_cost" DECIMAL(18,2),
    "target_amount" DECIMAL(18,2),
    "current_savings" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "inflation_rate" DECIMAL(7,4),
    "expected_return_rate" DECIMAL(7,4) NOT NULL,
    "future_target_amount" DECIMAL(18,2) NOT NULL,
    "fv_current_savings" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_required_corpus" DECIMAL(18,2) NOT NULL,
    "required_monthly_sip" DECIMAL(18,2) NOT NULL,
    "required_lumpsum_today" DECIMAL(18,2) NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "calculation_version" VARCHAR(20) NOT NULL DEFAULT 'v2.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_calculation_config" (
    "id" TEXT NOT NULL,
    "goal_type_id" SMALLINT NOT NULL,
    "inflation_rate" DECIMAL(7,4),
    "expected_return_rate" DECIMAL(7,4) NOT NULL,
    "min_years" SMALLINT NOT NULL,
    "max_years" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config_version" VARCHAR(20) NOT NULL DEFAULT 'v2.0',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_calculation_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_goal_user_id_status_idx" ON "user_goal"("user_id", "status");

-- CreateIndex
CREATE INDEX "user_goal_type_idx" ON "user_goal"("user_id", "goal_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_calculation_config_goal_type_id_key" ON "goal_calculation_config"("goal_type_id");

-- AddForeignKey
ALTER TABLE "user_goal" ADD CONSTRAINT "user_goal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "user_goal" ADD CONSTRAINT "chk_goal_type" CHECK ("goal_type_id" BETWEEN 1 AND 6);

-- Seed default configurations into goal_calculation_config
INSERT INTO "goal_calculation_config" ("id", "goal_type_id", "inflation_rate", "expected_return_rate", "min_years", "max_years", "active", "config_version", "effective_from", "updatedAt")
VALUES
    (gen_random_uuid()::text, 1, 0.0600, 0.1000, 1, 30, true, 'v2.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 2, 0.0600, 0.1000, 1, 30, true, 'v2.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 3, 0.0500, 0.1000, 1, 30, true, 'v2.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 4, 0.0500, 0.1000, 1, 15, true, 'v2.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 5, NULL,   0.1000, 1, 30, true, 'v2.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 6, 0.0600, 0.1000, 1, 30, true, 'v2.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("goal_type_id") DO NOTHING;
