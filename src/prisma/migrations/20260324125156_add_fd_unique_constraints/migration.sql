/*
  Warnings:

  - A unique constraint covering the columns `[fd_product_id,payout_frequency,tenure_days,customer_type]` on the table `FdInterestRate` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[issuer_id,type]` on the table `FdProduct` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "FdInterestRate_fd_product_id_payout_frequency_tenure_days_c_key" ON "FdInterestRate"("fd_product_id", "payout_frequency", "tenure_days", "customer_type");

-- CreateIndex
CREATE UNIQUE INDEX "FdProduct_issuer_id_type_key" ON "FdProduct"("issuer_id", "type");
