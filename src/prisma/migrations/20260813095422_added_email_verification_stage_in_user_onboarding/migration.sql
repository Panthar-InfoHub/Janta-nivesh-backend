-- AlterEnum
ALTER TYPE "OnboardingStage" ADD VALUE 'EMAIL_VERIFICATION';

-- AlterTable
ALTER TABLE "UserOnboarding" ADD COLUMN     "email_status" "StageStatus" NOT NULL DEFAULT 'PENDING';
