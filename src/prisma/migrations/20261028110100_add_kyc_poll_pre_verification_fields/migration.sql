-- AlterTable
ALTER TABLE "KycProfile" ADD COLUMN     "kyc_poll_pre_verification_id" TEXT,
ADD COLUMN     "kyc_poll_response" JSONB,
ADD COLUMN     "kyc_poll_status" TEXT,
ADD COLUMN     "kyc_poll_submitted_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_kyc_poll_pre_verification_id_key" ON "KycProfile"("kyc_poll_pre_verification_id");

