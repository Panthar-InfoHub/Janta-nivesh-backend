-- AlterTable
ALTER TABLE "FdTransaction" ALTER COLUMN "is_vkyc_pending" SET DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mpin" TEXT;
