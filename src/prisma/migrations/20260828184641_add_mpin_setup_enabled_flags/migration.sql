-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mpin_is_setup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mpin_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing users who already have a pin set keep working - the DEFAULT false above
-- would otherwise silently turn off quick-login for everyone who already uses it.
UPDATE "User" SET "mpin_is_setup" = true, "mpin_enabled" = true WHERE "mpin" IS NOT NULL;
