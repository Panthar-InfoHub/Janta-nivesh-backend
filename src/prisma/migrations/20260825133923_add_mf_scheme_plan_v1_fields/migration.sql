-- AlterTable
ALTER TABLE "MfSchemePlan" ADD COLUMN     "amfi_code" TEXT,
ADD COLUMN     "close_ended" BOOLEAN,
ADD COLUMN     "fund_category" TEXT,
ADD COLUMN     "instant_redemption_allowed" BOOLEAN,
ADD COLUMN     "lock_in" BOOLEAN,
ADD COLUMN     "lock_in_period" INTEGER,
ADD COLUMN     "purchase_allowed_v1" BOOLEAN,
ADD COLUMN     "raw_response_v1" JSONB,
ADD COLUMN     "redemption_allowed_v1" BOOLEAN,
ADD COLUMN     "sip_allowed" BOOLEAN,
ADD COLUMN     "sip_frequency_data" JSONB,
ADD COLUMN     "stp_frequency_data" JSONB,
ADD COLUMN     "stp_in_allowed" BOOLEAN,
ADD COLUMN     "stp_out_allowed" BOOLEAN,
ADD COLUMN     "sub_category" TEXT,
ADD COLUMN     "switch_in_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "switch_in_amount_min" DECIMAL(14,2),
ADD COLUMN     "switch_in_amount_multiples" DECIMAL(14,2),
ADD COLUMN     "switch_out_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "switch_out_amount_min" DECIMAL(14,2),
ADD COLUMN     "switch_out_amount_multiples" DECIMAL(14,2),
ADD COLUMN     "switch_out_unit_multiples" DECIMAL(18,4),
ADD COLUMN     "switch_out_units_min" DECIMAL(18,4),
ADD COLUMN     "v1_synced_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MfSchemePlan_fund_category_idx" ON "MfSchemePlan"("fund_category");
