-- AlterTable
ALTER TABLE "UserOnboarding" ADD COLUMN "is_fire_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fire_completed_at" TIMESTAMP(3);

