/*
  Warnings:

  - You are about to drop the column `nse_client_code` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[investor_profile]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[investment_account]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_nse_client_code_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "nse_client_code",
ADD COLUMN     "investment_account" TEXT,
ADD COLUMN     "investor_profile" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_investor_profile_key" ON "User"("investor_profile");

-- CreateIndex
CREATE UNIQUE INDEX "User_investment_account_key" ON "User"("investment_account");
