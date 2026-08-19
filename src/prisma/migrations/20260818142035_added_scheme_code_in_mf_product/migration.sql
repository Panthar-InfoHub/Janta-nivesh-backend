/*
  Warnings:

  - You are about to drop the column `scheme_id` on the `MfNavHistory` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MfNavHistory" DROP COLUMN "scheme_id";

-- AlterTable
ALTER TABLE "MfProduct" ADD COLUMN     "scheme_code" INTEGER;

-- CreateIndex
CREATE INDEX "MfProduct_scheme_code_idx" ON "MfProduct"("scheme_code");
