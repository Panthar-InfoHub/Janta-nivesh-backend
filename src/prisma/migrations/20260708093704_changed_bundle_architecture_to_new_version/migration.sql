-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "bundle_name" TEXT NOT NULL,
    "equity_percentage" DOUBLE PRECISION DEFAULT 0,
    "commodity_percentage" DOUBLE PRECISION DEFAULT 0,
    "debt_percentage" DOUBLE PRECISION DEFAULT 0,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleCategory" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "total_percentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BundleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleCategorySlot" (
    "id" TEXT NOT NULL,
    "bundle_category_id" TEXT NOT NULL,
    "allocation_percentage" DOUBLE PRECISION NOT NULL,
    "default_rank" INTEGER NOT NULL,

    CONSTRAINT "BundleCategorySlot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BundleCategory" ADD CONSTRAINT "BundleCategory_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleCategorySlot" ADD CONSTRAINT "BundleCategorySlot_bundle_category_id_fkey" FOREIGN KEY ("bundle_category_id") REFERENCES "BundleCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
