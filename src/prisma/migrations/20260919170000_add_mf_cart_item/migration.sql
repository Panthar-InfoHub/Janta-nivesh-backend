-- CreateEnum
CREATE TYPE "MfCartType" AS ENUM ('LUMPSUM', 'SIP');

-- CreateEnum
CREATE TYPE "MfFrequency" AS ENUM ('MONTHLY', 'WEEKLY', 'DAILY');

-- CreateTable
CREATE TABLE "MfCartItem" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mf_product_id" TEXT NOT NULL,
    "cart_type" "MfCartType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "MfFrequency",
    "installment_day" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MfCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfCartItem_user_id_mf_product_id_cart_type_key" ON "MfCartItem"("user_id", "mf_product_id", "cart_type");

-- AddForeignKey
ALTER TABLE "MfCartItem" ADD CONSTRAINT "MfCartItem_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfCartItem" ADD CONSTRAINT "MfCartItem_mf_product_id_fkey" FOREIGN KEY ("mf_product_id") REFERENCES "MfProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
