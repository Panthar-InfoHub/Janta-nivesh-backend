-- AlterTable
ALTER TABLE "Nominee" ALTER COLUMN "percentage_allocation" DROP NOT NULL,
ALTER COLUMN "percentage_allocation" SET DEFAULT 100.00,
ALTER COLUMN "dob" DROP NOT NULL,
ALTER COLUMN "document_number" DROP NOT NULL,
ALTER COLUMN "document_type" DROP NOT NULL;
