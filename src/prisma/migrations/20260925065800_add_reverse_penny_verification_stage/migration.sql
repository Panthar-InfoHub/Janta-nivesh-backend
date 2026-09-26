-- AlterEnum
ALTER TYPE "OnboardingStage" ADD VALUE 'REVERSE_PENNY_VERIFICATION';

-- AlterTable
ALTER TABLE "UserOnboarding" ADD COLUMN "reverse_penny_status" "StageStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "UserReversePennyVerification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "decentro_txn_id" TEXT,
    "request_decentro_txn_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "status_description" TEXT,
    "response_code" TEXT,
    "response_key" TEXT,
    "error_key" TEXT,
    "provider_message" TEXT,
    "validation_link" TEXT,
    "gpay_uri" TEXT,
    "phonepe_uri" TEXT,
    "paytm_uri" TEXT,
    "bank_reference_number" TEXT,
    "npci_txn_id" TEXT,
    "payer_account_number" TEXT,
    "payer_account_ifsc" TEXT,
    "payer_account_type" TEXT,
    "payer_name" TEXT,
    "payer_vpa" TEXT,
    "transaction_auth_timestamp" TIMESTAMP(3),
    "raw_initiate_response" JSONB,
    "raw_status_response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserReversePennyVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserReversePennyVerification_reference_id_key" ON "UserReversePennyVerification"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserReversePennyVerification_decentro_txn_id_key" ON "UserReversePennyVerification"("decentro_txn_id");

-- CreateIndex
CREATE INDEX "UserReversePennyVerification_user_id_idx" ON "UserReversePennyVerification"("user_id");

-- AddForeignKey
ALTER TABLE "UserReversePennyVerification" ADD CONSTRAINT "UserReversePennyVerification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
