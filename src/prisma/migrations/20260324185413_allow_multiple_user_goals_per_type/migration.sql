-- DropIndex
DROP INDEX "UserGoals_user_id_goal_type_id_key";

-- CreateIndex
CREATE INDEX "user_goal_type_idx" ON "UserGoals"("user_id", "goal_type_id");
