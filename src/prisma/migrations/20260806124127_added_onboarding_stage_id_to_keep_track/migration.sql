/*
  Warnings:

  - A unique constraint covering the columns `[cybrilla_pre_verification_id]` on the table `KycProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "KycProfile" ADD COLUMN     "cybrilla_pre_verification_id" TEXT,
ADD COLUMN     "cybrilla_pre_verification_status" TEXT,
ADD COLUMN     "pre_verification_response" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_cybrilla_pre_verification_id_key" ON "KycProfile"("cybrilla_pre_verification_id");
