/*
  Warnings:

  - Added the required column `bundle_description` to the `Bundle` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Bundle" ADD COLUMN     "bundle_description" TEXT NOT NULL;
