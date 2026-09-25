-- Update any rows where current_stage is REVERSE_PENNY_VERIFICATION to PENNY_DROP_VERIFICATION
UPDATE "UserOnboarding" SET "current_stage" = 'PENNY_DROP_VERIFICATION' WHERE "current_stage"::text = 'REVERSE_PENNY_VERIFICATION';

-- Recreate OnboardingStage enum without REVERSE_PENNY_VERIFICATION
CREATE TYPE "OnboardingStage_new" AS ENUM ('BASIC_DETAILS', 'PAN_VERIFICATION', 'KYC_VERIFICATION', 'PENNY_DROP_VERIFICATION', 'EMAIL_VERIFICATION', 'INVESTOR_PROFILE', 'NOMINEE_ADDITION', 'COMPLETED');

ALTER TABLE "UserOnboarding" ALTER COLUMN "current_stage" DROP DEFAULT;
ALTER TABLE "UserOnboarding" ALTER COLUMN "current_stage" TYPE "OnboardingStage_new" USING ("current_stage"::text::"OnboardingStage_new");
ALTER TYPE "OnboardingStage" RENAME TO "OnboardingStage_old";
ALTER TYPE "OnboardingStage_new" RENAME TO "OnboardingStage";
DROP TYPE "public"."OnboardingStage_old";
ALTER TABLE "UserOnboarding" ALTER COLUMN "current_stage" SET DEFAULT 'BASIC_DETAILS';
