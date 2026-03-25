/*
  Warnings:

  - You are about to drop the column `refresh_tokn` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "refresh_tokn",
ADD COLUMN     "refresh_token" TEXT;
