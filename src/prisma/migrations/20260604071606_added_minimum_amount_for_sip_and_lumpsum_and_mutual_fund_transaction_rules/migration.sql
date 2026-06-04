/*
  Warnings:

  - The `status` column on the `Mandate` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Mandate_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Mandate" DROP COLUMN "status",
ADD COLUMN     "status" "Mandate_status" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "MfSchemeTransactionRules" ADD COLUMN     "min_lump_sum_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
