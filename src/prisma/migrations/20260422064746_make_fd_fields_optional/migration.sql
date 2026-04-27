-- AlterTable
ALTER TABLE "FdInterestRate" ALTER COLUMN "is_tax_saver" DROP NOT NULL,
ALTER COLUMN "is_tax_saver" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FdIssuer" ALTER COLUMN "rating_text" DROP NOT NULL,
ALTER COLUMN "operating_since" DROP NOT NULL;
