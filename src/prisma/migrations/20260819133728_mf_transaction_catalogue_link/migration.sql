-- AlterTable
ALTER TABLE "MfTransactionPlan" ADD COLUMN     "allotted_nav_date" TIMESTAMP(3),
ADD COLUMN     "allotted_units" DECIMAL(18,4),
ADD COLUMN     "mf_product_id" TEXT,
ADD COLUMN     "purchased_amount" DECIMAL(14,2),
ADD COLUMN     "purchased_price" DECIMAL(12,4),
ADD COLUMN     "scheduled_on" TIMESTAMP(3),
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "succeeded_at" TIMESTAMP(3),
ADD COLUMN     "traded_on" TIMESTAMP(3),
ADD COLUMN     "units" DECIMAL(18,4),
ALTER COLUMN "amount" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "MfTransactionPlan_mf_product_id_idx" ON "MfTransactionPlan"("mf_product_id");

-- AddForeignKey
ALTER TABLE "MfTransactionPlan" ADD CONSTRAINT "MfTransactionPlan_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
