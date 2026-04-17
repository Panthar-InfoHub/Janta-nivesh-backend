-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "bundle_name" TEXT NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleProduct" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "mf_product_id" TEXT NOT NULL,
    "allocation_percentage" DOUBLE PRECISION NOT NULL,
    "min_amount" DECIMAL(12,4),

    CONSTRAINT "BundleProduct_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BundleProduct" ADD CONSTRAINT "BundleProduct_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleProduct" ADD CONSTRAINT "BundleProduct_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
