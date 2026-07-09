-- AlterTable
ALTER TABLE "Bundle" ADD COLUMN     "hybrid_percentage" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "meta_data" JSONB;
