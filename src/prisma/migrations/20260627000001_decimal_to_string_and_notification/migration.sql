-- Safe production migration: Decimal/Float → Text, new columns, Notification table

-- ============================================================
-- User: add email_hash, phone_hash; convert dob TIMESTAMP → TEXT
-- ============================================================
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_hash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_hash_key" ON "User"("email_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_hash_key" ON "User"("phone_hash");

-- Convert dob from TIMESTAMP(3) to TEXT (preserves date as 'YYYY-MM-DD')
ALTER TABLE "User" ALTER COLUMN "dob" TYPE TEXT USING TO_CHAR("dob", 'YYYY-MM-DD');

-- ============================================================
-- UserFinance: DECIMAL(12,2) → TEXT
-- ============================================================
ALTER TABLE "UserFinance"
  ALTER COLUMN "annual_income"          TYPE TEXT USING "annual_income"::TEXT,
  ALTER COLUMN "expense_house"          TYPE TEXT USING "expense_house"::TEXT,
  ALTER COLUMN "expense_food"           TYPE TEXT USING "expense_food"::TEXT,
  ALTER COLUMN "expense_transportation" TYPE TEXT USING "expense_transportation"::TEXT,
  ALTER COLUMN "expense_others"         TYPE TEXT USING "expense_others"::TEXT;

ALTER TABLE "UserFinance"
  ALTER COLUMN "annual_income"          SET DEFAULT '0.00',
  ALTER COLUMN "expense_house"          SET DEFAULT '0.00',
  ALTER COLUMN "expense_food"           SET DEFAULT '0.00',
  ALTER COLUMN "expense_transportation" SET DEFAULT '0.00',
  ALTER COLUMN "expense_others"         SET DEFAULT '0.00';

-- ============================================================
-- UserBankDetails: add account_no_hash column, drop old unique constraint
-- NOTE: The unique index on (user_id, account_no_hash) is intentionally
-- deferred to migration 20260627000002 — it must run AFTER the backfill
-- script populates real HMAC hashes. Adding it here would fail because
-- all existing rows get account_no_hash = '' (blank), causing duplicates
-- for users with multiple bank accounts.
-- ============================================================
ALTER TABLE "UserBankDetails" ADD COLUMN IF NOT EXISTS "account_no_hash" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "UserBankDetails_user_id_account_no_key";

-- ============================================================
-- UserAssets: DECIMAL(12,2) → TEXT
-- ============================================================
ALTER TABLE "UserAssets"
  ALTER COLUMN "stocks"       TYPE TEXT USING "stocks"::TEXT,
  ALTER COLUMN "fd"           TYPE TEXT USING "fd"::TEXT,
  ALTER COLUMN "real_estate"  TYPE TEXT USING "real_estate"::TEXT,
  ALTER COLUMN "gold"         TYPE TEXT USING "gold"::TEXT,
  ALTER COLUMN "cash_saving"  TYPE TEXT USING "cash_saving"::TEXT,
  ALTER COLUMN "mutual_funds" TYPE TEXT USING "mutual_funds"::TEXT;

ALTER TABLE "UserAssets"
  ALTER COLUMN "stocks"       SET DEFAULT '0.00',
  ALTER COLUMN "fd"           SET DEFAULT '0.00',
  ALTER COLUMN "real_estate"  SET DEFAULT '0.00',
  ALTER COLUMN "gold"         SET DEFAULT '0.00',
  ALTER COLUMN "cash_saving"  SET DEFAULT '0.00',
  ALTER COLUMN "mutual_funds" SET DEFAULT '0.00';

-- ============================================================
-- UserInsurance: DECIMAL(12,2) → TEXT
-- ============================================================
ALTER TABLE "UserInsurance"
  ALTER COLUMN "life_insurance"   TYPE TEXT USING "life_insurance"::TEXT,
  ALTER COLUMN "health_insurance" TYPE TEXT USING "health_insurance"::TEXT;

ALTER TABLE "UserInsurance"
  ALTER COLUMN "life_insurance"   SET DEFAULT '0.00',
  ALTER COLUMN "health_insurance" SET DEFAULT '0.00';

-- ============================================================
-- UserLoan: DECIMAL(12,2) → TEXT
-- ============================================================
ALTER TABLE "UserLoan"
  ALTER COLUMN "outstanding_amount" TYPE TEXT USING "outstanding_amount"::TEXT,
  ALTER COLUMN "monthly_emi"        TYPE TEXT USING "monthly_emi"::TEXT;

ALTER TABLE "UserLoan"
  ALTER COLUMN "outstanding_amount" SET DEFAULT '0.00',
  ALTER COLUMN "monthly_emi"        SET DEFAULT '0.00';

-- ============================================================
-- UserGoals: DECIMAL(12,2) → TEXT (mix of NOT NULL and nullable)
-- ============================================================
ALTER TABLE "UserGoals"
  ALTER COLUMN "current_saved_amount"    TYPE TEXT USING "current_saved_amount"::TEXT,
  ALTER COLUMN "current_goal_cost"       TYPE TEXT USING "current_goal_cost"::TEXT,
  ALTER COLUMN "current_monthly_expense" TYPE TEXT USING "current_monthly_expense"::TEXT,
  ALTER COLUMN "post_retirement_return"  TYPE TEXT USING "post_retirement_return"::TEXT;

ALTER TABLE "UserGoals"
  ALTER COLUMN "current_saved_amount" SET DEFAULT '0.00';

-- ============================================================
-- UserNetWorthSnapshot: DOUBLE PRECISION → TEXT
-- ============================================================
ALTER TABLE "UserNetWorthSnapshot"
  ALTER COLUMN "netWorth"    TYPE TEXT USING "netWorth"::TEXT,
  ALTER COLUMN "assets"      TYPE TEXT USING "assets"::TEXT,
  ALTER COLUMN "liabilities" TYPE TEXT USING "liabilities"::TEXT;

-- ============================================================
-- Notification: new enum + new table
-- ============================================================
CREATE TYPE "NotificationType" AS ENUM ('TRANSACTION', 'SECURITY', 'MARKETING', 'SYSTEM');

CREATE TABLE "Notification" (
  "id"        TEXT             NOT NULL,
  "user_id"   TEXT             NOT NULL,
  "type"      "NotificationType" NOT NULL DEFAULT 'SYSTEM',
  "title"     TEXT             NOT NULL,
  "body"      TEXT             NOT NULL,
  "payload"   JSONB,
  "is_read"   BOOLEAN          NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"    TIMESTAMP(3),

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_user_id_is_read_idx"   ON "Notification"("user_id", "is_read");
CREATE INDEX "Notification_user_id_createdAt_idx" ON "Notification"("user_id", "createdAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
