-- CreateTable
CREATE TABLE "UserBankDetails" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_no" TEXT NOT NULL,
    "ifsc_code" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_type" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBankDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserBankDetails_user_id_account_no_key" ON "UserBankDetails"("user_id", "account_no");

-- AddForeignKey
ALTER TABLE "UserBankDetails" ADD CONSTRAINT "UserBankDetails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
