/*
  Warnings:

  - The values [MATURITY_INSTRUCTION_UPDATED] on the enum `TransactionStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
ALTER TYPE "FdCustomerType" ADD VALUE 'SENIOR_CITIZEN_FEMALE';

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionStatus_new" AS ENUM ('INITIATED', 'ONBOARDING_COMPLETED', 'ONBOARDING_FAILED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'VKYC_PENDING', 'VKYC_COMPLETED', 'VKYC_FAILED', 'FD_CREATED', 'REFUNDED', 'MATURED', 'PREMATURE_WITHDRAWN');
ALTER TABLE "public"."FdTransaction" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "FdTransaction" ALTER COLUMN "status" TYPE "TransactionStatus_new" USING ("status"::text::"TransactionStatus_new");
ALTER TYPE "TransactionStatus" RENAME TO "TransactionStatus_old";
ALTER TYPE "TransactionStatus_new" RENAME TO "TransactionStatus";
DROP TYPE "public"."TransactionStatus_old";
ALTER TABLE "FdTransaction" ALTER COLUMN "status" SET DEFAULT 'INITIATED';
COMMIT;

-- DropIndex
DROP INDEX "FdTransaction_fd_account_number_key";

-- AlterTable
ALTER TABLE "FdTransaction" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "is_vkyc_initiated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_vkyc_pending" BOOLEAN NOT NULL DEFAULT false;
