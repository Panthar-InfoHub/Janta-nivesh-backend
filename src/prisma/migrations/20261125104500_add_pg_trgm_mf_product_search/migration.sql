CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "MfProduct_name_trgm_idx"
  ON "MfProduct" USING gin ("name" gin_trgm_ops);
