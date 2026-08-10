-- CreateTable
CREATE TABLE "MfPurchasePlan" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fp_purchase_plan_id" TEXT NOT NULL,
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
    "payment_method" TEXT,
    "payment_source" TEXT,
    "purpose" TEXT,
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

    CONSTRAINT "MfPurchasePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfPurchasePlan_fp_purchase_plan_id_key" ON "MfPurchasePlan"("fp_purchase_plan_id");

-- CreateIndex
CREATE INDEX "MfPurchasePlan_user_id_idx" ON "MfPurchasePlan"("user_id");

-- AddForeignKey
ALTER TABLE "MfPurchasePlan" ADD CONSTRAINT "MfPurchasePlan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
