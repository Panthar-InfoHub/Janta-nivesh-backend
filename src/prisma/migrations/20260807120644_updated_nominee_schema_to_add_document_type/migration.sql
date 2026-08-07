/*
  Warnings:

  - You are about to drop the column `identity_proof_number` on the `Nominee` table. All the data in the column will be lost.
  - You are about to drop the column `identity_proof_type` on the `Nominee` table. All the data in the column will be lost.
  - You are about to drop the column `pan` on the `Nominee` table. All the data in the column will be lost.
  - Added the required column `document_number` to the `Nominee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `document_type` to the `Nominee` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Nominee" DROP COLUMN "identity_proof_number",
DROP COLUMN "identity_proof_type",
DROP COLUMN "pan",
ADD COLUMN     "document_number" TEXT NOT NULL,
ADD COLUMN     "document_type" TEXT NOT NULL;
