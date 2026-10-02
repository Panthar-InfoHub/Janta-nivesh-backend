-- AlterTable
ALTER TABLE "BundleCategorySlot" ADD COLUMN "pre_selected_product_id" TEXT;

-- CreateIndex
CREATE INDEX "BundleCategorySlot_pre_selected_product_id_idx" ON "BundleCategorySlot"("pre_selected_product_id");

-- AddForeignKey
ALTER TABLE "BundleCategorySlot" ADD CONSTRAINT "BundleCategorySlot_pre_selected_product_id_fkey" FOREIGN KEY ("pre_selected_product_id") REFERENCES "MfProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
