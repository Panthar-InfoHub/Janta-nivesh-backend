-- AlterTable
ALTER TABLE "goal_calculation_config" ADD COLUMN     "is_velvet" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_goal" ADD COLUMN     "is_velvet" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_goal_retirement_details" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "current_age" SMALLINT NOT NULL,
    "retirement_age" SMALLINT NOT NULL,
    "plan_until_age" SMALLINT NOT NULL,
    "retirement_date" DATE,
    "planning_end_date" DATE,
    "monthly_lifestyle_expense" DECIMAL(18,2) NOT NULL,
    "expense_as_of" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "existing_retirement_savings" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "savings_as_of" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_monthly_sip" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pension_monthly_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annual_pension_increase" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "pre_retirement_return" DECIMAL(7,4) NOT NULL,
    "post_retirement_return" DECIMAL(7,4) NOT NULL,
    "inflation_before_retirement" DECIMAL(7,4) NOT NULL,
    "inflation_during_retirement" DECIMAL(7,4) NOT NULL,
    "additional_corpus_buffer" DECIMAL(7,4) NOT NULL,
    "base_retirement_corpus" DECIMAL(18,2) NOT NULL,
    "target_retirement_corpus" DECIMAL(18,2) NOT NULL,
    "fv_existing_savings" DECIMAL(18,2) NOT NULL,
    "remaining_corpus_to_build" DECIMAL(18,2) NOT NULL,
    "total_monthly_sip" DECIMAL(18,2) NOT NULL,
    "extra_monthly_sip" DECIMAL(18,2) NOT NULL,
    "additional_lumpsum_today" DECIMAL(18,2) NOT NULL,
    "monthly_cost_at_retirement" DECIMAL(18,2) NOT NULL,
    "calculation_snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_goal_retirement_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_goal_retirement_details_goal_id_key" ON "user_goal_retirement_details"("goal_id");

-- CreateIndex
CREATE INDEX "user_goal_user_id_is_velvet_idx" ON "user_goal"("user_id", "is_velvet");

-- AddForeignKey
ALTER TABLE "user_goal_retirement_details" ADD CONSTRAINT "user_goal_retirement_details_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "user_goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
