-- AlterTable
ALTER TABLE "MfHolding" ADD COLUMN "user_goal_id" TEXT;

-- CreateIndex
CREATE INDEX "MfHolding_user_goal_id_idx" ON "MfHolding"("user_goal_id");

-- AddForeignKey
ALTER TABLE "MfHolding" ADD CONSTRAINT "MfHolding_user_goal_id_fkey" FOREIGN KEY ("user_goal_id") REFERENCES "user_goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
