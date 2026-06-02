/*
  Warnings:

  - A unique constraint covering the columns `[fd_product_id,payout_frequency,tenure_label,customer_type]` on the table `FdInterestRate` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "FdInterestRate_fd_product_id_payout_frequency_tenure_days_c_key";

-- CreateIndex
CREATE UNIQUE INDEX "FdInterestRate_fd_product_id_payout_frequency_tenure_label__key" ON "FdInterestRate"("fd_product_id", "payout_frequency", "tenure_label", "customer_type");
