-- Phase 3: Add unique constraint on (user_id, account_no_hash)
-- Run ONLY after the backfill script has populated all account_no_hash values.
-- If any account_no_hash is still blank (''), this will fail — re-run the backfill first.

CREATE UNIQUE INDEX "UserBankDetails_user_id_account_no_hash_key"
  ON "UserBankDetails"("user_id", "account_no_hash");
