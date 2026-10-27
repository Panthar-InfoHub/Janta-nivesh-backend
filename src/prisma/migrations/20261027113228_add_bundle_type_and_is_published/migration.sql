-- CreateEnum
CREATE TYPE "BundleInvestmentType" AS ENUM ('DAILY_SIP', 'MONTHLY_SIP', 'LUMPSUM');

-- AlterTable
ALTER TABLE "Bundle" ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BundleType" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "investment_type" "BundleInvestmentType" NOT NULL,
    "start_amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BundleType_pkey" PRIMARY KEY ("id")
);

-- Clean up old bundle categories and slots to allow column alteration cleanly
DELETE FROM "BundleCategorySlot";
DELETE FROM "BundleCategory";

-- DropForeignKey
ALTER TABLE "BundleCategory" DROP CONSTRAINT IF EXISTS "BundleCategory_bundle_id_fkey";

-- AlterTable
ALTER TABLE "BundleCategory" DROP COLUMN IF EXISTS "bundle_id",
ADD COLUMN "bundle_type_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "BundleType_bundle_id_idx" ON "BundleType"("bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "BundleType_bundle_id_investment_type_key" ON "BundleType"("bundle_id", "investment_type");

-- CreateIndex
CREATE INDEX "BundleCategory_bundle_type_id_idx" ON "BundleCategory"("bundle_type_id");

-- AddForeignKey
ALTER TABLE "BundleType" ADD CONSTRAINT "BundleType_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleCategory" ADD CONSTRAINT "BundleCategory_bundle_type_id_fkey" FOREIGN KEY ("bundle_type_id") REFERENCES "BundleType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
