/*
  Warnings:

  - You are about to drop the column `fp_plan_id` on the `MfTransactionPlan` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[fp_id]` on the table `MfTransactionPlan` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `fp_id` to the `MfTransactionPlan` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `state` on the `MfTransactionPlan` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "MfTransactionState" AS ENUM ('CREATED', 'REVIEW_COMPLETED', 'CONFIRMED', 'SUBMITTED', 'ACTIVE', 'COMPLETED', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REVERSED');

-- DropIndex
DROP INDEX "MfTransactionPlan_fp_plan_id_key";

-- AlterTable
ALTER TABLE "MfTransactionPlan" DROP COLUMN "fp_plan_id",
ADD COLUMN     "fp_id" TEXT NOT NULL,
ALTER COLUMN "frequency" DROP NOT NULL,
ALTER COLUMN "number_of_installments" DROP NOT NULL,
DROP COLUMN "state",
ADD COLUMN     "state" "MfTransactionState" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MfTransactionPlan_fp_id_key" ON "MfTransactionPlan"("fp_id");
