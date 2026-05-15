-- CreateTable
CREATE TABLE "UserNetWorthSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "netWorth" DOUBLE PRECISION NOT NULL,
    "assets" DOUBLE PRECISION NOT NULL,
    "liabilities" DOUBLE PRECISION NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNetWorthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNetWorthSnapshot_userId_month_year_key" ON "UserNetWorthSnapshot"("userId", "month", "year");

-- AddForeignKey
ALTER TABLE "UserNetWorthSnapshot" ADD CONSTRAINT "UserNetWorthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
