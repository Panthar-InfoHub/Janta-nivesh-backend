-- AlterTable
ALTER TABLE "MfProduct" ADD COLUMN     "display_name_001" TEXT DEFAULT '',
ADD COLUMN     "display_name_002" TEXT DEFAULT '';

-- AlterTable
ALTER TABLE "MfSchemeTransactionRules" ADD COLUMN     "min_annual_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_daily_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_fortnightly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_lumpsum_add_on_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_monthly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_quarterly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_redem_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_redem_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_semi_annual_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "min_weekly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
