-- CreateEnum
CREATE TYPE "FdPayoutFrequency" AS ENUM ('CUMULATIVE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ON_MATURITY');

-- CreateEnum
CREATE TYPE "FdCustomerType" AS ENUM ('STANDARD', 'SENIOR_CITIZEN', 'FEMALE');

-- CreateEnum
CREATE TYPE "IssuerType" AS ENUM ('BANK', 'NBFC');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'ONBOARDING_COMPLETED', 'ONBOARDING_FAILED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'VKYC_PENDING', 'VKYC_COMPLETED', 'VKYC_FAILED', 'FD_CREATED', 'REFUNDED', 'MATURED', 'PREMATURE_WITHDRAWN', 'MATURITY_INSTRUCTION_UPDATED');

-- CreateTable
CREATE TABLE "FdIssuer" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "issuer_type" "IssuerType" NOT NULL,
    "logo_url" TEXT NOT NULL,
    "banner_url" TEXT NOT NULL,
    "rating_text" TEXT NOT NULL,
    "customer_served" TEXT NOT NULL,
    "operating_since" TEXT NOT NULL,
    "about_description" TEXT NOT NULL,
    "support_email" TEXT NOT NULL,
    "support_phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdIssuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdProduct" (
    "id" TEXT NOT NULL,
    "issuer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "min_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "max_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "min_tenure_days" INTEGER NOT NULL,
    "max_tenure_days" INTEGER NOT NULL,
    "lock_in_period_days" INTEGER NOT NULL,
    "withdrawal_message" TEXT NOT NULL,
    "premature_penalty_percent" DOUBLE PRECISION NOT NULL,
    "is_vkyc_required" BOOLEAN NOT NULL DEFAULT false,
    "min_amount_for_vkyc" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "usps" JSONB,
    "faqs" JSONB,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdInterestRate" (
    "id" TEXT NOT NULL,
    "fd_product_id" TEXT NOT NULL,
    "payout_frequency" "FdPayoutFrequency" NOT NULL,
    "customer_type" "FdCustomerType" NOT NULL,
    "tenure_days" INTEGER NOT NULL,
    "tenure_label" TEXT NOT NULL,
    "interest_rate" DECIMAL(5,2) NOT NULL,
    "annualized_yield" DECIMAL(5,2) NOT NULL,
    "is_default_selection" BOOLEAN NOT NULL DEFAULT false,
    "is_tax_saver" BOOLEAN NOT NULL DEFAULT false,
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdInterestRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdTransaction" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "issuer_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "roi_at_booking" DECIMAL(5,2),
    "tenure_at_booking" INTEGER,
    "payout_frequency" "FdPayoutFrequency" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "is_vkyc_required" BOOLEAN NOT NULL DEFAULT false,
    "is_nominee_added" BOOLEAN NOT NULL DEFAULT false,
    "payment_tx_id" TEXT,
    "bank_name_added" TEXT,
    "vkyc_failure_reason" TEXT,
    "vkyc_failed_by" TEXT,
    "fd_account_number" TEXT,
    "maturity_amount" DECIMAL(12,2),
    "maturity_date" TIMESTAMP(3),
    "maturity_instruction" TEXT,
    "onboarded_at" TIMESTAMP(3),
    "payment_completed_at" TIMESTAMP(3),
    "vkyc_completed_at" TIMESTAMP(3),
    "fd_issued_at" TIMESTAMP(3),
    "refund_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FdTransaction_payment_tx_id_key" ON "FdTransaction"("payment_tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "FdTransaction_fd_account_number_key" ON "FdTransaction"("fd_account_number");

-- AddForeignKey
ALTER TABLE "FdProduct" ADD CONSTRAINT "FdProduct_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "FdIssuer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdInterestRate" ADD CONSTRAINT "FdInterestRate_fd_product_id_fkey" FOREIGN KEY ("fd_product_id") REFERENCES "FdProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdTransaction" ADD CONSTRAINT "FdTransaction_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "FdProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
