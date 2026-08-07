-- AlterTable
ALTER TABLE "Nominee" ADD COLUMN     "address_city" TEXT,
ADD COLUMN     "address_country" TEXT DEFAULT 'IN',
ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "address_line3" TEXT,
ADD COLUMN     "address_postal_code" TEXT,
ADD COLUMN     "address_state" TEXT,
ADD COLUMN     "email_address" TEXT,
ADD COLUMN     "identity_proof_number" TEXT,
ADD COLUMN     "identity_proof_type" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "phone_isd" TEXT,
ADD COLUMN     "phone_number" TEXT;
