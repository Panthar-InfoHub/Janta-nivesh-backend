-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mandate_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "umrn" TEXT,
    "bank_account" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_mandate_id_key" ON "Mandate"("mandate_id");

-- CreateIndex
CREATE INDEX "Mandate_user_id_idx" ON "Mandate"("user_id");

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
