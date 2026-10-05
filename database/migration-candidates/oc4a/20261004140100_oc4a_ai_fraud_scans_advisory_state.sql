-- +migrate Up
-- =====================================================================================================
-- OC-4A CANDIDATE — NOT APPLIED ANYWHERE (outside database/migrations; see 20261004140000).
--
-- ai_fraud_scans holds ADVISORY machine output: a generic language model read a VIN, a price and a
-- title. Two facts make this candidate necessary:
--   1. The table has NO PostgreSQL definition in this repository. Its only DDL is the SQLite
--      004_add_tamper_proofing.sql, which never parsed here — yet aiServiceBus.runFraudAnalysis writes
--      it. A fresh PostgreSQL environment therefore has no such table, and every write fails.
--   2. Nothing in a row said what it was. Before OC-3E-W1 every row carried risk_score 0 and no
--      provenance; a reader could not tell an executed analysis from a legacy filler.
--
-- (1) The table is declared WHERE ABSENT, in the shape the runtime writes (IF NOT EXISTS: an existing
--     table is never recreated or retyped).
-- (2) The truthfulness columns are GENERATED from what each row's writer recorded — the advisory
--     envelope aiServiceBus writes as the leading keys of reasons_json — never from a default:
--       analysis_status  'completed' for an envelope row; 'legacy_unverified' for anything else
--       execution        the envelope's execution ('provider_executed' for an OC-3E-W1 envelope, which
--                        persisted only after a provider-executed verdict); 'unknown' for legacy rows
--       provider         the envelope's provider, or NULL when it was not recorded
--       model            model_version (the model that actually ran, OC-3B)
--       advisory         always true (CHECK): there is no binding fraud finding in this table
--     Generated columns cannot be written, so no caller can promote a legacy row to 'completed', and
--     existing rows are classified when the columns are added — no backfill, no guess.
-- (3) risk_score and confidence lose NOT NULL: an analysis without a stated index or confidence must
--     be storable without a filler (the runtime currently skips persistence without an index, and
--     records confidence_reported in the envelope).
-- The runtime is unchanged by this file; it is compatible with the table before and after it.
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS public.ai_fraud_scans (
  id                TEXT PRIMARY KEY,
  vin               TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE CASCADE,
  model_version     TEXT NOT NULL,
  risk_score        REAL,
  risk_rating       TEXT NOT NULL CHECK (risk_rating IN ('Low', 'Medium', 'High', 'Critical')),
  reasons_json      TEXT NOT NULL,
  confidence        REAL,
  is_flagged        BOOLEAN DEFAULT false,
  moderation_status TEXT DEFAULT 'None' CHECK (moderation_status IN ('None', 'Pending_Review', 'Cleared', 'Blocked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_fraud_scans_vin ON public.ai_fraud_scans (vin);

ALTER TABLE public.ai_fraud_scans ALTER COLUMN risk_score DROP NOT NULL;
ALTER TABLE public.ai_fraud_scans ALTER COLUMN confidence DROP NOT NULL;

ALTER TABLE public.ai_fraud_scans
  ADD COLUMN IF NOT EXISTS advisory BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS analysis_status TEXT GENERATED ALWAYS AS (
    CASE WHEN reasons_json LIKE '{"advisory":true,"machine_output":true,"binding":false,"source":"generic_llm"%'
         THEN 'completed' ELSE 'legacy_unverified' END) STORED,
  ADD COLUMN IF NOT EXISTS execution TEXT GENERATED ALWAYS AS (
    CASE WHEN reasons_json LIKE '{"advisory":true,"machine_output":true,"binding":false,"source":"generic_llm"%'
         THEN COALESCE(substring(reasons_json FROM '^\{[^\[]*?"execution":"([a-z_]+)"'), 'provider_executed')
         ELSE 'unknown' END) STORED,
  ADD COLUMN IF NOT EXISTS provider TEXT GENERATED ALWAYS AS (
    CASE WHEN reasons_json LIKE '{"advisory":true,"machine_output":true,"binding":false,"source":"generic_llm"%'
         THEN substring(reasons_json FROM '^\{[^\[]*?"provider":"([A-Za-z0-9._:/-]+)"')
         END) STORED,
  ADD COLUMN IF NOT EXISTS model TEXT GENERATED ALWAYS AS (model_version) STORED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_fraud_scans'::regclass AND conname = 'ai_fraud_scans_advisory_only') THEN
    ALTER TABLE public.ai_fraud_scans ADD CONSTRAINT ai_fraud_scans_advisory_only CHECK (advisory);
  END IF;
END $$;

-- +migrate Down
-- Removes what this candidate added. It does NOT drop the table (it may have existed before Up, and
-- this file cannot know), and it does NOT restore NOT NULL on risk_score / confidence: rows written
-- after Up may legitimately hold NULL there, and a rollback must not guess a filler for them.
ALTER TABLE public.ai_fraud_scans DROP CONSTRAINT IF EXISTS ai_fraud_scans_advisory_only;
ALTER TABLE public.ai_fraud_scans
  DROP COLUMN IF EXISTS model,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS execution,
  DROP COLUMN IF EXISTS analysis_status,
  DROP COLUMN IF EXISTS advisory;
