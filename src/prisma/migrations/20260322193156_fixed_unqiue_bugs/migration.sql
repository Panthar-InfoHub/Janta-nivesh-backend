-- DropIndex
DROP INDEX "MfKycIdentity_pan_no_key";

-- AddForeignKey
ALTER TABLE "FdTransaction" ADD CONSTRAINT "FdTransaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
