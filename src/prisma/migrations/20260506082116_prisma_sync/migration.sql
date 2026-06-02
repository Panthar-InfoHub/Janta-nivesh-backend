CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "mf_amc_name_trgm_idx" ON "MfProduct" USING GIST ("amc_name" gist_trgm_ops);

-- CreateIndex
CREATE INDEX "mf_scheme_name_trgm_idx" ON "MfProduct" USING GIST ("scheme_name" gist_trgm_ops);