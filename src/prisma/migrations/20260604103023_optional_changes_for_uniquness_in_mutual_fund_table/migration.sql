/*
  Warnings:

  - Made the column `isin` on table `MfProduct` required. This step will fail if there are existing NULL values in that column.
  - Made the column `nse_scheme_code` on table `MfProduct` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MfProduct" ALTER COLUMN "isin" SET NOT NULL,
ALTER COLUMN "isin" SET DEFAULT '',
ALTER COLUMN "nse_scheme_code" SET NOT NULL,
ALTER COLUMN "nse_scheme_code" SET DEFAULT '';
