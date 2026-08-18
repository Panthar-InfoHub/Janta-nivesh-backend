/*
  Warnings:

  - You are about to drop the column `amc_code` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `amc_id` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `amc_name` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `asset_type` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `display_name_001` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `display_name_002` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `mapping_code` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `maturity_date` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `nfo_end_date` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `nse_scheme_code` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `platform_code` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `purchase_allowed` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `redemption_allowed` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `risk_level` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `risk_name` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `scheme_id` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `scheme_name` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `scheme_type` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `sip_allowed` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `structure` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the column `switch_allowed` on the `MfProduct` table. All the data in the column will be lost.
  - You are about to drop the `MfSchemeTransactionRules` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[isin]` on the table `MfProduct` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `name` to the `MfProduct` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "OnboardingStage" ADD VALUE 'BASIC_DETAILS';

-- Postgres forbids using a new enum value in the same transaction that added it (P3018 /
-- "unsafe use of new value... must be committed before they can be used"). This COMMIT closes
-- out that transaction so BASIC_DETAILS is durable before the SET DEFAULT below references it.
-- Everything after this point runs in a fresh implicit transaction.
COMMIT;

-- DropForeignKey
ALTER TABLE "MfSchemeTransactionRules" DROP CONSTRAINT "MfSchemeTransactionRules_mf_product_id_fkey";

-- DropIndex
DROP INDEX "MfProduct_amc_code_idx";

-- DropIndex
DROP INDEX "MfProduct_risk_level_idx";

-- DropIndex
DROP INDEX "MfProduct_scheme_id_isin_nse_scheme_code_key";

-- DropIndex
DROP INDEX "MfProduct_scheme_type_idx";

-- DropIndex
DROP INDEX "mf_amc_name_trgm_idx";

-- DropIndex
DROP INDEX "mf_scheme_name_trgm_idx";

-- AlterTable
ALTER TABLE "MfProduct" DROP COLUMN "amc_code",
DROP COLUMN "amc_id",
DROP COLUMN "amc_name",
DROP COLUMN "asset_type",
DROP COLUMN "display_name_001",
DROP COLUMN "display_name_002",
DROP COLUMN "mapping_code",
DROP COLUMN "maturity_date",
DROP COLUMN "nfo_end_date",
DROP COLUMN "nse_scheme_code",
DROP COLUMN "platform_code",
DROP COLUMN "purchase_allowed",
DROP COLUMN "redemption_allowed",
DROP COLUMN "risk_level",
DROP COLUMN "risk_name",
DROP COLUMN "scheme_id",
DROP COLUMN "scheme_name",
DROP COLUMN "scheme_type",
DROP COLUMN "sip_allowed",
DROP COLUMN "structure",
DROP COLUMN "switch_allowed",
ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "isin" DROP DEFAULT,
ALTER COLUMN "img_url" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserOnboarding" ADD COLUMN     "basic_details_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "current_stage" SET DEFAULT 'BASIC_DETAILS';

-- DropTable
DROP TABLE "MfSchemeTransactionRules";

-- CreateTable
CREATE TABLE "MfSchemePlan" (
    "id" TEXT NOT NULL,
    "mf_product_id" TEXT NOT NULL,
    "isin" TEXT NOT NULL,
    "scheme_name" TEXT NOT NULL,
    "fund_name" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'cybrillapoa',
    "plan_type" TEXT NOT NULL,
    "option" TEXT NOT NULL,
    "idcw_option" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lumpsum_allowed" BOOLEAN NOT NULL DEFAULT false,
    "lumpsum_amount_min" DECIMAL(14,2),
    "lumpsum_amount_max" DECIMAL(14,2),
    "lumpsum_amount_multiples" DECIMAL(14,2),
    "lumpsum_additional_amount_min" DECIMAL(14,2),
    "withdrawal_allowed" BOOLEAN NOT NULL DEFAULT false,
    "withdrawal_amount_min" DECIMAL(14,2),
    "withdrawal_amount_max" DECIMAL(14,2),
    "withdrawal_amount_multiples" DECIMAL(14,2),
    "withdrawal_units_min" DECIMAL(18,4),
    "withdrawal_units_multiples" DECIMAL(18,4),
    "sip_daily_allowed" BOOLEAN NOT NULL DEFAULT false,
    "sip_daily_amount_min" DECIMAL(14,2),
    "sip_daily_amount_max" DECIMAL(14,2),
    "sip_daily_amount_multiples" DECIMAL(14,2),
    "sip_daily_installments_min" INTEGER,
    "sip_monthly_allowed" BOOLEAN NOT NULL DEFAULT false,
    "sip_monthly_amount_min" DECIMAL(14,2),
    "sip_monthly_amount_max" DECIMAL(14,2),
    "sip_monthly_amount_multiples" DECIMAL(14,2),
    "sip_monthly_installments_min" INTEGER,
    "sip_monthly_dates" INTEGER[],
    "raw_response" JSONB,
    "last_synced_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfSchemePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfSchemePlan_mf_product_id_key" ON "MfSchemePlan"("mf_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "MfSchemePlan_isin_key" ON "MfSchemePlan"("isin");

-- CreateIndex
CREATE INDEX "MfSchemePlan_active_idx" ON "MfSchemePlan"("active");

-- CreateIndex
CREATE UNIQUE INDEX "MfProduct_isin_key" ON "MfProduct"("isin");

-- AddForeignKey
ALTER TABLE "MfSchemePlan" ADD CONSTRAINT "MfSchemePlan_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
