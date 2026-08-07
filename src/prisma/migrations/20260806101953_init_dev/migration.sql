CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'ONBOARDING_COMPLETED', 'ONBOARDING_FAILED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'VKYC_PENDING', 'VKYC_COMPLETED', 'VKYC_FAILED', 'FD_CREATED', 'REFUNDED', 'MATURED', 'PREMATURE_WITHDRAWN');

-- CreateEnum
CREATE TYPE "FdPayoutFrequency" AS ENUM ('CUMULATIVE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ON_MATURITY');

-- CreateEnum
CREATE TYPE "FdCustomerType" AS ENUM ('STANDARD', 'SENIOR_CITIZEN', 'FEMALE', 'SENIOR_CITIZEN_FEMALE');

-- CreateEnum
CREATE TYPE "IssuerType" AS ENUM ('BANK', 'NBFC');

-- CreateEnum
CREATE TYPE "OnboardingStage" AS ENUM ('PAN_VERIFICATION', 'KYC_VERIFICATION', 'BANK_VERIFICATION', 'INVESTOR_PROFILE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TRANSACTION', 'SECURITY', 'MARKETING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Mandate_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "bundle_name" TEXT NOT NULL,
    "bundle_description" TEXT NOT NULL,
    "equity_percentage" DOUBLE PRECISION DEFAULT 0,
    "commodity_percentage" DOUBLE PRECISION DEFAULT 0,
    "debt_percentage" DOUBLE PRECISION DEFAULT 0,
    "hybrid_percentage" DOUBLE PRECISION DEFAULT 0,
    "img_url" TEXT,
    "meta_data" JSONB,
    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleCategory" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "total_percentage" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "BundleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleCategorySlot" (
    "id" TEXT NOT NULL,
    "bundle_category_id" TEXT NOT NULL,
    "allocation_percentage" DOUBLE PRECISION NOT NULL,
    "default_rank" INTEGER NOT NULL,
    CONSTRAINT "BundleCategorySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdIssuer" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "issuer_type" "IssuerType" NOT NULL,
    "logo_url" TEXT NOT NULL,
    "banner_url" TEXT NOT NULL,
    "rating_text" TEXT,
    "customer_served" TEXT NOT NULL,
    "operating_since" TEXT,
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
    "min_deposit" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    "max_deposit" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    "min_tenure_days" INTEGER NOT NULL,
    "max_tenure_days" INTEGER NOT NULL,
    "lock_in_period_days" INTEGER NOT NULL,
    "withdrawal_message" TEXT NOT NULL,
    "premature_penalty_percent" DOUBLE PRECISION NOT NULL,
    "is_vkyc_required" BOOLEAN NOT NULL DEFAULT false,
    "min_amount_for_vkyc" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
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
    "interest_rate" DECIMAL(5, 2) NOT NULL,
    "annualized_yield" DECIMAL(5, 2) NOT NULL,
    "is_default_selection" BOOLEAN NOT NULL DEFAULT false,
    "is_tax_saver" BOOLEAN,
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
    "amount" DECIMAL(12, 2) NOT NULL,
    "roi_at_booking" DECIMAL(5, 2),
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
    "maturity_amount" DECIMAL(12, 2),
    "maturity_date" TIMESTAMP(3),
    "maturity_instruction" TEXT,
    "onboarded_at" TIMESTAMP(3),
    "payment_completed_at" TIMESTAMP(3),
    "vkyc_completed_at" TIMESTAMP(3),
    "fd_issued_at" TIMESTAMP(3),
    "refund_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "failure_reason" TEXT,
    "is_vkyc_initiated" BOOLEAN NOT NULL DEFAULT false,
    "is_vkyc_pending" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "FdTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOnboarding" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_stage" "OnboardingStage" NOT NULL DEFAULT 'PAN_VERIFICATION',
    "readiness_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "kyc_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "bank_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "profile_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable

CREATE TABLE "KycProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cybrilla_kyc_form_id" TEXT,
    "cybrilla_status" TEXT,
    "cybrilla_type" TEXT,
    "failure_reason" TEXT,
    "pan" TEXT,
    "is_readiness_verified" BOOLEAN,
    "readiness_checked_at" TIMESTAMP(3),
    "full_name" TEXT,
    "dob" TEXT,
    "gender" TEXT,
    "marital_status" TEXT,
    "residential_status" TEXT,
    "father_name" TEXT,
    "spouse_name" TEXT,
    "occupation_type" TEXT,
    "aadhaar_number" TEXT,
    "country_of_birth" TEXT,
    "place_of_birth" TEXT,
    "nationality_country" TEXT,
    "citizenship_countries" TEXT[],
    "income_slab" TEXT,
    "pep_details" TEXT,
    "tax_residency_other_than_india" BOOLEAN NOT NULL DEFAULT false,
    "non_indian_tax_residency_1" JSONB,
    "non_indian_tax_residency_2" JSONB,
    "non_indian_tax_residency_3" JSONB,
    "address" TEXT,
    "pincode" TEXT,
    "city" TEXT,
    "source_of_fund" TEXT,
    "annual_income" TEXT,
    "signature_provided" BOOLEAN NOT NULL DEFAULT false,
    "identity_proof_type" TEXT,
    "address_proof_type" TEXT,
    "proof_fetch_url" TEXT,
    "proof_status" TEXT,
    "esign_url" TEXT,
    "esign_status" TEXT,
    "geo_latitude" DOUBLE PRECISION,
    "geo_longitude" DOUBLE PRECISION,
    "fields_needed" TEXT[],
    "cybrilla_created_at" TIMESTAMP(3),
    "cybrilla_updated_at" TIMESTAMP(3),
    "review_completed_at" TIMESTAMP(3),
    "awaiting_esign_at" TIMESTAMP(3),
    "awaiting_submission_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "raw_kyc_form_response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfProduct" (
    "id" TEXT NOT NULL,
    "scheme_id" TEXT NOT NULL,
    "isin" TEXT NOT NULL DEFAULT '',
    "img_url" TEXT DEFAULT '',
    "mapping_code" TEXT NOT NULL,
    "scheme_name" TEXT NOT NULL,
    "display_name_001" TEXT DEFAULT '',
    "display_name_002" TEXT DEFAULT '',
    "amc_id" TEXT,
    "amc_code" TEXT,
    "amc_name" TEXT,
    "asset_type" TEXT,
    "scheme_type" TEXT,
    "structure" TEXT,
    "risk_name" TEXT,
    "risk_level" INTEGER,
    "latest_nav" DECIMAL(12, 4),
    "latest_nav_date" TIMESTAMP(3),
    "purchase_allowed" BOOLEAN NOT NULL DEFAULT false,
    "sip_allowed" BOOLEAN NOT NULL DEFAULT false,
    "redemption_allowed" BOOLEAN NOT NULL DEFAULT false,
    "switch_allowed" BOOLEAN NOT NULL DEFAULT false,
    "maturity_date" TIMESTAMP(3),
    "nfo_end_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nse_scheme_code" TEXT NOT NULL DEFAULT '',
    "platform_code" TEXT,
    CONSTRAINT "MfProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfNavHistory" (
    "id" TEXT NOT NULL,
    "mf_product_id" TEXT NOT NULL,
    "scheme_id" TEXT NOT NULL,
    "nav" DECIMAL(12, 4) NOT NULL,
    "nav_date" TIMESTAMP(3) NOT NULL,
    "daily_change" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfNavHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable

CREATE TABLE "MfSchemeTransactionRules" (
    "id" TEXT NOT NULL,
    "mf_product_id" TEXT NOT NULL,
    "min_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_lump_sum_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sip_allowed_dates" INTEGER[],
    "sip_frequencies" TEXT[],
    "min_investment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_lumpsum_add_on_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_redem_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_redem_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_daily_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_weekly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_fortnightly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_monthly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_quarterly_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_semi_annual_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_annual_sip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfSchemeTransactionRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfMetrics" (
    "id" TEXT NOT NULL,
    "mf_product_id" TEXT NOT NULL,
    "return_30d" DOUBLE PRECISION,
    "return_90d" DOUBLE PRECISION,
    "return_6m" DOUBLE PRECISION,
    "return_1y" DOUBLE PRECISION,
    "return_3y" DOUBLE PRECISION,
    "return_5y" DOUBLE PRECISION,
    "nav_change_pct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFinance" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "annual_income" TEXT NOT NULL DEFAULT '0.00',
    "expense_house" TEXT NOT NULL DEFAULT '0.00',
    "expense_food" TEXT NOT NULL DEFAULT '0.00',
    "expense_transportation" TEXT NOT NULL DEFAULT '0.00',
    "expense_others" TEXT NOT NULL DEFAULT '0.00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFinance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBankDetails" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_no" TEXT NOT NULL,
    "account_no_hash" TEXT NOT NULL DEFAULT '',
    "ifsc_code" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_type" TEXT,
    "account_holder_name" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "verification_method" TEXT,
    "verified_at" TIMESTAMP(3),
    "provider_reference_id" TEXT,
    "raw_verification_response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBankDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAssets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stocks" TEXT NOT NULL DEFAULT '0.00',
    "fd" TEXT NOT NULL DEFAULT '0.00',
    "real_estate" TEXT NOT NULL DEFAULT '0.00',
    "gold" TEXT NOT NULL DEFAULT '0.00',
    "cash_saving" TEXT NOT NULL DEFAULT '0.00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mutual_funds" TEXT NOT NULL DEFAULT '0.00',
    CONSTRAINT "UserAssets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInsurance" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "life_insurance" TEXT NOT NULL DEFAULT '0.00',
    "health_insurance" TEXT NOT NULL DEFAULT '0.00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLoan" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "loan_type" TEXT NOT NULL,
    "loan_name" TEXT,
    "outstanding_amount" TEXT NOT NULL DEFAULT '0.00',
    "monthly_emi" TEXT NOT NULL DEFAULT '0.00',
    "tenure_months" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGoals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "goal_id" INTEGER,
    "goal_type_id" INTEGER NOT NULL,
    "inflation_rate" INTEGER NOT NULL,
    "return_rate" INTEGER NOT NULL,
    "current_saved_amount" TEXT NOT NULL DEFAULT '0.00',
    "goal_name" TEXT,
    "goal_item_id" INTEGER,
    "goal_item_name" TEXT,
    "child_name" TEXT,
    "child_age" INTEGER,
    "years_left" INTEGER,
    "current_goal_cost" TEXT,
    "current_age" INTEGER,
    "retirement_age" INTEGER,
    "life_expectancy" INTEGER,
    "current_monthly_expense" TEXT,
    "post_retirement_return" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserGoals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "email_hash" TEXT,
    "phone_no" TEXT,
    "phone_hash" TEXT,
    "city" TEXT,
    "dob" TEXT,
    "fcm_token" TEXT,
    "meta_data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nse_client_code" TEXT,
    "refresh_token" TEXT,
    "mpin" TEXT,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNetWorthSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "netWorth" TEXT NOT NULL,
    "assets" TEXT NOT NULL,
    "liabilities" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserNetWorthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mandate_id" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "status" "Mandate_status" NOT NULL DEFAULT 'PENDING',
    "umrn" TEXT,
    "bank_account" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FdProduct_issuer_id_type_key" ON "FdProduct" ("issuer_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FdInterestRate_fd_product_id_payout_frequency_tenure_label__key" ON "FdInterestRate" (
    "fd_product_id",
    "payout_frequency",
    "tenure_label",
    "customer_type"
);

-- CreateIndex
CREATE UNIQUE INDEX "FdTransaction_payment_tx_id_key" ON "FdTransaction" ("payment_tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserOnboarding_user_id_key" ON "UserOnboarding" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_user_id_key" ON "KycProfile" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_cybrilla_kyc_form_id_key" ON "KycProfile" ("cybrilla_kyc_form_id");

-- CreateIndex
CREATE INDEX "MfProduct_amc_code_idx" ON "MfProduct" ("amc_code");

-- CreateIndex
CREATE INDEX "MfProduct_scheme_type_idx" ON "MfProduct" ("scheme_type");

-- CreateIndex
CREATE INDEX "MfProduct_latest_nav_date_idx" ON "MfProduct" ("latest_nav_date");

-- CreateIndex
CREATE INDEX "MfProduct_risk_level_idx" ON "MfProduct" ("risk_level");

-- CreateIndex
CREATE INDEX "mf_amc_name_trgm_idx" ON "MfProduct" USING GIST ("amc_name" gist_trgm_ops);

-- CreateIndex
CREATE INDEX "mf_scheme_name_trgm_idx" ON "MfProduct" USING GIST ("scheme_name" gist_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "MfProduct_scheme_id_isin_nse_scheme_code_key" ON "MfProduct" (
    "scheme_id",
    "isin",
    "nse_scheme_code"
);

-- CreateIndex
CREATE INDEX "MfNavHistory_mf_product_id_nav_date_idx" ON "MfNavHistory" ("mf_product_id", "nav_date");

-- CreateIndex
CREATE UNIQUE INDEX "MfNavHistory_mf_product_id_nav_date_key" ON "MfNavHistory" ("mf_product_id", "nav_date");

-- CreateIndex
CREATE UNIQUE INDEX "MfSchemeTransactionRules_mf_product_id_key" ON "MfSchemeTransactionRules" ("mf_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "MfMetrics_mf_product_id_key" ON "MfMetrics" ("mf_product_id");

-- CreateIndex
CREATE INDEX "MfMetrics_mf_product_id_idx" ON "MfMetrics" ("mf_product_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_is_read_idx" ON "Notification" ("user_id", "is_read");

-- CreateIndex
CREATE INDEX "Notification_user_id_createdAt_idx" ON "Notification" ("user_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_key_key" ON "Sequence" ("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserFinance_user_id_key" ON "UserFinance" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserBankDetails_user_id_account_no_hash_key" ON "UserBankDetails" ("user_id", "account_no_hash");

-- CreateIndex
CREATE UNIQUE INDEX "UserAssets_user_id_key" ON "UserAssets" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserInsurance_user_id_key" ON "UserInsurance" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserLoan_user_id_loan_type_key" ON "UserLoan" ("user_id", "loan_type");

-- CreateIndex
CREATE INDEX "user_goal_type_idx" ON "UserGoals" ("user_id", "goal_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_hash_key" ON "User" ("email_hash");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_no_key" ON "User" ("phone_no");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_hash_key" ON "User" ("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "User_nse_client_code_key" ON "User" ("nse_client_code");

-- CreateIndex
CREATE UNIQUE INDEX "UserNetWorthSnapshot_userId_month_year_key" ON "UserNetWorthSnapshot" ("userId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_mandate_id_key" ON "Mandate" ("mandate_id");

-- CreateIndex
CREATE INDEX "Mandate_user_id_idx" ON "Mandate" ("user_id");

-- AddForeignKey
ALTER TABLE "BundleCategory"
ADD CONSTRAINT "BundleCategory_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleCategorySlot"
ADD CONSTRAINT "BundleCategorySlot_bundle_category_id_fkey" FOREIGN KEY ("bundle_category_id") REFERENCES "BundleCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdProduct"
ADD CONSTRAINT "FdProduct_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "FdIssuer" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdInterestRate"
ADD CONSTRAINT "FdInterestRate_fd_product_id_fkey" FOREIGN KEY ("fd_product_id") REFERENCES "FdProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdTransaction"
ADD CONSTRAINT "FdTransaction_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "FdProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdTransaction"
ADD CONSTRAINT "FdTransaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOnboarding"
ADD CONSTRAINT "UserOnboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycProfile"
ADD CONSTRAINT "KycProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfNavHistory"
ADD CONSTRAINT "MfNavHistory_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfSchemeTransactionRules"
ADD CONSTRAINT "MfSchemeTransactionRules_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfMetrics"
ADD CONSTRAINT "MfMetrics_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFinance"
ADD CONSTRAINT "UserFinance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBankDetails"
ADD CONSTRAINT "UserBankDetails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssets"
ADD CONSTRAINT "UserAssets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInsurance"
ADD CONSTRAINT "UserInsurance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLoan"
ADD CONSTRAINT "UserLoan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGoals"
ADD CONSTRAINT "UserGoals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNetWorthSnapshot"
ADD CONSTRAINT "UserNetWorthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate"
ADD CONSTRAINT "Mandate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;