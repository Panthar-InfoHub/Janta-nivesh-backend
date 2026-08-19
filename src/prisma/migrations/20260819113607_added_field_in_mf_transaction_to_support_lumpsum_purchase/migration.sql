-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MfTransactionState" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "MfTransactionState" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "MfTransactionPlan" ADD COLUMN     "fp_old_id" INTEGER,
ADD COLUMN     "fp_payment_id" TEXT;
