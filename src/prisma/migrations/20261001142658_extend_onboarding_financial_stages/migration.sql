-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OnboardingStage" ADD VALUE 'FINANCE_DETAILS';
ALTER TYPE "OnboardingStage" ADD VALUE 'ASSET_DETAILS';
ALTER TYPE "OnboardingStage" ADD VALUE 'LOAN_DETAILS';
ALTER TYPE "OnboardingStage" ADD VALUE 'INSURANCE_DETAILS';
ALTER TYPE "OnboardingStage" ADD VALUE 'GOAL_DETAILS';

-- AlterTable
ALTER TABLE "UserOnboarding" ADD COLUMN     "assets_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "finance_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "goals_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "insurance_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "loan_status" "StageStatus" NOT NULL DEFAULT 'PENDING';
