/*
  Warnings:

  - The values [BANK_VERIFICATION] on the enum `OnboardingStage` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `bank_status` on the `UserOnboarding` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OnboardingStage_new" AS ENUM ('PAN_VERIFICATION', 'KYC_VERIFICATION', 'PENNY_DROP_VERIFICATION', 'INVESTOR_PROFILE', 'NOMINEE_ADDITION', 'COMPLETED');
ALTER TABLE "public"."UserOnboarding" ALTER COLUMN "current_stage" DROP DEFAULT;
ALTER TABLE "UserOnboarding" ALTER COLUMN "current_stage" TYPE "OnboardingStage_new" USING ("current_stage"::text::"OnboardingStage_new");
ALTER TYPE "OnboardingStage" RENAME TO "OnboardingStage_old";
ALTER TYPE "OnboardingStage_new" RENAME TO "OnboardingStage";
DROP TYPE "public"."OnboardingStage_old";
ALTER TABLE "UserOnboarding" ALTER COLUMN "current_stage" SET DEFAULT 'PAN_VERIFICATION';
COMMIT;

-- AlterTable
ALTER TABLE "KycProfile" ADD COLUMN     "first_tax_residency" JSONB,
ADD COLUMN     "investor_type" TEXT DEFAULT 'individual',
ADD COLUMN     "is_pep_declaration_confirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_residency_declaration_confirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "occupation" TEXT,
ADD COLUMN     "profile_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "tax_status" TEXT,
ADD COLUMN     "use_default_tax_residences" BOOLEAN DEFAULT true;

-- AlterTable
ALTER TABLE "UserOnboarding" DROP COLUMN "bank_status",
ADD COLUMN     "nominee_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "penny_drop_status" "StageStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "Nominee" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nominee_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "percentage_allocation" DECIMAL(5,2) NOT NULL,
    "dob" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nominee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Nominee_user_id_idx" ON "Nominee"("user_id");

-- AddForeignKey
ALTER TABLE "Nominee" ADD CONSTRAINT "Nominee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
