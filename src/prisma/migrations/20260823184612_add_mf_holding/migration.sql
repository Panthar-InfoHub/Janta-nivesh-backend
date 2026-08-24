-- CreateTable
CREATE TABLE "MfHolding" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mf_investment_account" TEXT NOT NULL,
    "folio_number" TEXT NOT NULL,
    "isin" TEXT NOT NULL,
    "fund_name" TEXT,
    "mf_product_id" TEXT,
    "units" DECIMAL(18,4) NOT NULL,
    "redeemable_units" DECIMAL(18,4),
    "nav" DECIMAL(12,4),
    "nav_as_on" TIMESTAMP(3),
    "invested_amount" DECIMAL(14,2) NOT NULL,
    "current_value" DECIMAL(14,2) NOT NULL,
    "unrealized_gain" DECIMAL(14,2),
    "absolute_return" DECIMAL(8,4),
    "avg_nav" DECIMAL(12,4),
    "xirr" DECIMAL(8,4),
    "raw_response" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfHolding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MfHolding_user_id_idx" ON "MfHolding"("user_id");

-- CreateIndex
CREATE INDEX "MfHolding_mf_product_id_idx" ON "MfHolding"("mf_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "MfHolding_mf_investment_account_folio_number_isin_key" ON "MfHolding"("mf_investment_account", "folio_number", "isin");

-- AddForeignKey
ALTER TABLE "MfHolding" ADD CONSTRAINT "MfHolding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfHolding" ADD CONSTRAINT "MfHolding_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
