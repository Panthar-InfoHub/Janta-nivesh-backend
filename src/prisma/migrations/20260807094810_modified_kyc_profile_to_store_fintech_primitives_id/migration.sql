/*
  Warnings:

  - A unique constraint covering the columns `[fp_address_id]` on the table `KycProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[fp_phone_id]` on the table `KycProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[fp_email_id]` on the table `KycProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[fp_related_party_id]` on the table `Nominee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[fp_bank_account_id]` on the table `UserBankDetails` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "KycProfile" ADD COLUMN     "fp_address_id" TEXT,
ADD COLUMN     "fp_email_id" TEXT,
ADD COLUMN     "fp_phone_id" TEXT;

-- AlterTable
ALTER TABLE "Mandate" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "fp_bank_account_id" TEXT,
ADD COLUMN     "fp_payment_id" TEXT,
ADD COLUMN     "mandate_type" TEXT NOT NULL DEFAULT 'UPI',
ADD COLUMN     "provider_name" TEXT NOT NULL DEFAULT 'CYBRILLAPOA';

-- AlterTable
ALTER TABLE "Nominee" ADD COLUMN     "fp_related_party_id" TEXT;

-- AlterTable
ALTER TABLE "UserBankDetails" ADD COLUMN     "fp_bank_account_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_fp_address_id_key" ON "KycProfile"("fp_address_id");

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_fp_phone_id_key" ON "KycProfile"("fp_phone_id");

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_fp_email_id_key" ON "KycProfile"("fp_email_id");

-- CreateIndex
CREATE UNIQUE INDEX "Nominee_fp_related_party_id_key" ON "Nominee"("fp_related_party_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserBankDetails_fp_bank_account_id_key" ON "UserBankDetails"("fp_bank_account_id");
