-- +migrate Up
-- =====================================================================================
-- Workstream 2 — External Government/Partner Source Verification Network
--
-- Records every query made to a Zimbabwe registry source adapter (ZIMRA, CVR, ZINARA,
-- VID, CID) as an APPEND-ONLY, provenance-bearing result. This is the durable backbone
-- of the "differentiating trust network": each row states which source was queried, in
-- which honesty MODE, what it returned, and at what confidence.
--
-- Honesty rules enforced structurally:
--   * mode is mandatory and constrained — a SANDBOX/MANUAL/UNAVAILABLE result can never
--     be silently relabelled as a LIVE government API confirmation.
--   * UNAVAILABLE and NO_RECORD are first-class result values — they are never the same
--     as MATCH/CLEAR.
--   * rows are immutable (governance_block_mutation) — a verification result cannot be
--     edited after the fact; a re-query inserts a new row.
--   * raw provider payloads live in this privileged table only; buyers never read it
--     directly (a public-safe coverage view exposes status only, no identity/PII).
--
-- Depends on: governance_block_mutation() from 20260621160000_governance_disputes_corrections.sql
-- =====================================================================================

CREATE TABLE IF NOT EXISTS source_verification_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                 TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  provider            TEXT NOT NULL
                        CHECK (provider IN ('zimra', 'cvr', 'zinara', 'vid', 'cid')),
  -- Honesty marker: how the result was produced. Never collapse these.
  mode                TEXT NOT NULL
                        CHECK (mode IN ('live', 'sandbox', 'partner_file', 'manual_verification', 'unavailable')),
  query_type          TEXT NOT NULL DEFAULT 'vin'
                        CHECK (query_type IN ('vin', 'plate', 'chassis', 'engine')),
  query_value         TEXT NOT NULL,
  -- The verification outcome. unavailable/no_record are distinct from match.
  result              TEXT NOT NULL
                        CHECK (result IN ('match', 'mismatch', 'no_record', 'unavailable', 'manual_review', 'high_risk')),
  confidence          NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source_record_id    TEXT,
  retrieved_at        TIMESTAMPTZ,
  -- Public-safe summary of what the source returned (NO private owner PII).
  identity_fields     JSONB NOT NULL DEFAULT '{}'::jsonb,
  mismatch_flags      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Error classification when result is unavailable/high_risk due to a provider problem.
  error_class         TEXT
                        CHECK (error_class IS NULL OR error_class IN
                          ('timeout', 'malformed_response', 'unauthorized', 'rate_limited', 'provider_error', 'not_contracted')),
  -- Raw provider payload retained for audit. Privileged-read only (see RLS); never public.
  raw_payload         JSONB,
  -- Manual-verification provenance (mode='manual_verification').
  manual_verified_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  manual_reason       TEXT,
  -- Which feature flag governed this query (audit/rollback).
  feature_flag        TEXT,
  legal_basis         TEXT,
  requested_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  tenant_id           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_svr_vin_provider ON source_verification_results(vin, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_svr_result ON source_verification_results(result)
  WHERE result IN ('mismatch', 'high_risk');
CREATE INDEX IF NOT EXISTS idx_svr_provider_mode ON source_verification_results(provider, mode);

-- Append-only: a verification result is a historical fact. No UPDATE, no DELETE.
DROP TRIGGER IF EXISTS svr_no_update ON source_verification_results;
CREATE TRIGGER svr_no_update
  BEFORE UPDATE ON source_verification_results
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS svr_no_delete ON source_verification_results;
CREATE TRIGGER svr_no_delete
  BEFORE DELETE ON source_verification_results
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- RLS: service-role writes; admin/government/reviewer read all; vehicle owner/dealer read
-- own vehicle's results. Buyers (anon/other authenticated) get NOTHING here — they see
-- only the public coverage view below.
ALTER TABLE source_verification_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE source_verification_results FROM anon;
GRANT ALL ON TABLE source_verification_results TO service_role;
GRANT SELECT ON TABLE source_verification_results TO authenticated;

DROP POLICY IF EXISTS "svr privileged read" ON source_verification_results;
CREATE POLICY "svr privileged read"
  ON source_verification_results FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

DROP POLICY IF EXISTS "svr owner read" ON source_verification_results;
CREATE POLICY "svr owner read"
  ON source_verification_results FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.vin = source_verification_results.vin
        AND v.owner_id = auth.uid()::text
    )
  );

-- Public-safe coverage view: latest result per (vin, provider), exposing ONLY the
-- coverage status and honesty mode — no identity fields, no raw payload, no PII.
-- This is what buyer surfaces and the partner API read from.
CREATE OR REPLACE VIEW source_verification_coverage_public AS
SELECT DISTINCT ON (vin, provider)
  vin,
  provider,
  mode,
  CASE
    WHEN result = 'match' AND mode = 'live'                 THEN 'source_connected'
    WHEN result = 'match' AND mode = 'sandbox'              THEN 'sandbox_demonstration'
    WHEN result = 'match' AND mode = 'partner_file'         THEN 'partner_file_reviewed'
    WHEN result = 'manual_review' OR mode = 'manual_verification' THEN 'carup_manual_reviewed'
    WHEN result = 'mismatch'                                THEN 'conflict_under_review'
    WHEN result = 'high_risk'                               THEN 'risk_flagged'
    WHEN result = 'no_record'                               THEN 'no_record_found'
    WHEN result = 'unavailable'                             THEN 'source_unavailable'
    ELSE 'pending'
  END AS coverage_status,
  retrieved_at,
  created_at
FROM source_verification_results
ORDER BY vin, provider, created_at DESC;

GRANT SELECT ON source_verification_coverage_public TO authenticated, service_role;

-- +migrate Down
DROP VIEW IF EXISTS source_verification_coverage_public;
DROP TRIGGER IF EXISTS svr_no_update ON source_verification_results;
DROP TRIGGER IF EXISTS svr_no_delete ON source_verification_results;
DROP TABLE IF EXISTS source_verification_results;
