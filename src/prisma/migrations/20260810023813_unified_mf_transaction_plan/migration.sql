/*
  Warnings:

  - You are about to drop the `MfPurchasePlan` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "MfPlanType" AS ENUM ('PURCHASE', 'REDEMPTION', 'SWITCH');

-- DropForeignKey
ALTER TABLE "MfPurchasePlan" DROP CONSTRAINT "MfPurchasePlan_user_id_fkey";

-- DropTable
DROP TABLE "MfPurchasePlan";

-- CreateTable
CREATE TABLE "MfTransactionPlan" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_type" "MfPlanType" NOT NULL,
    "fp_plan_id" TEXT NOT NULL,
    "mf_investment_account" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "folio_number" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "systematic" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL,
    "installment_day" INTEGER,
    "number_of_installments" INTEGER NOT NULL,
    "remaining_installments" INTEGER,
    "requested_activation_date" TIMESTAMP(3),
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "next_installment_date" TIMESTAMP(3),
    "previous_installment_date" TIMESTAMP(3),
    "state" TEXT NOT NULL,
    "auto_generate_installments" BOOLEAN NOT NULL DEFAULT true,
    "generate_first_installment_now" BOOLEAN NOT NULL DEFAULT false,
    "payment_method" TEXT,
    "payment_source" TEXT,
    "purpose" TEXT,
    "switch_to_scheme" TEXT,
    "source_ref_id" TEXT,
    "partner" TEXT,
    "gateway" TEXT NOT NULL DEFAULT 'ondc',
    "euin" TEXT,
    "user_ip" TEXT,
    "server_ip" TEXT,
    "initiated_by" TEXT,
    "initiated_via" TEXT,
    "consent_email" TEXT,
    "consent_isd_code" TEXT,
    "consent_mobile" TEXT,
    "consent_given_at" TIMESTAMP(3),
    "fp_created_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_scheduled_on" TIMESTAMP(3),
    "cancellation_code" TEXT,
    "auto_cancelled" BOOLEAN,
    "failed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "reason" TEXT,
    "raw_response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfTransactionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfTransactionPlan_fp_plan_id_key" ON "MfTransactionPlan"("fp_plan_id");

-- CreateIndex
CREATE INDEX "MfTransactionPlan_user_id_idx" ON "MfTransactionPlan"("user_id");

-- CreateIndex
CREATE INDEX "MfTransactionPlan_user_id_plan_type_idx" ON "MfTransactionPlan"("user_id", "plan_type");

-- AddForeignKey
ALTER TABLE "MfTransactionPlan" ADD CONSTRAINT "MfTransactionPlan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
