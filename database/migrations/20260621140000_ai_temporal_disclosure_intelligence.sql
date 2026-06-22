-- +migrate Up
-- =====================================================================================
-- Milestone 3 — Visual & Disclosure Intelligence (master plan §7, §8, §9)
--
-- Durable AI analysis jobs + typed observations, temporal component-change findings, and
-- seller-disclosure claims/conflicts. Every finding is advisory and defaults to
-- pending_review: AI never approves evidence, changes trust, or publishes accusations
-- (master plan §2.2). Additive + reversible.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) Durable AI analysis jobs — state machine (master plan §7.4)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_analysis_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id     UUID REFERENCES vehicle_evidence(id) ON DELETE CASCADE,
  vin             TEXT,
  task_type       TEXT NOT NULL CHECK (task_type IN (
                    'image_quality','viewpoint','identity_cues','plate_ocr','vin_ocr',
                    'odometer_ocr','document_extraction','component_detection',
                    'damage_detection','repair_paint_inconsistency','manipulation',
                    'near_duplicate','same_vehicle_similarity')),
  provider        TEXT,
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                    'queued','processing','succeeded','failed_retryable','failed_terminal',
                    'manual_review_required','superseded')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  latency_ms      INTEGER,
  cost_estimate   NUMERIC,
  confidence      NUMERIC,
  result          JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  safe_summary    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_evidence ON ai_analysis_jobs(evidence_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_task ON ai_analysis_jobs(task_type);

-- -------------------------------------------------------------------------------------
-- 2) Typed AI observations (per-task structured outputs) — master plan §7.3
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_observations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES ai_analysis_jobs(id) ON DELETE CASCADE,
  evidence_id     UUID REFERENCES vehicle_evidence(id) ON DELETE CASCADE,
  task_type       TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  value           JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence      NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_obs_evidence ON ai_observations(evidence_id);
CREATE INDEX IF NOT EXISTS idx_ai_obs_job ON ai_observations(job_id);

-- -------------------------------------------------------------------------------------
-- 3) Temporal component-change findings (master plan §8.6)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS temporal_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin             TEXT NOT NULL,
  finding_type    TEXT NOT NULL CHECK (finding_type IN (
                    'newly_damaged','repaired','replaced','removed_missing',
                    'repainted_colour_mismatch','worsened','improved','unchanged','unable_to_compare')),
  component       TEXT,
  earlier_set_id  UUID REFERENCES evidence_sets(id) ON DELETE SET NULL,
  later_set_id    UUID REFERENCES evidence_sets(id) ON DELETE SET NULL,
  earlier_date    DATE,
  later_date      DATE,
  supporting_asset_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  model           TEXT,
  confidence      NUMERIC,
  severity        TEXT CHECK (severity IS NULL OR severity IN ('info','low','medium','high','critical')),
  reviewer_state  TEXT NOT NULL DEFAULT 'pending_review' CHECK (reviewer_state IN (
                    'pending_review','confirmed','rejected','amended','inconclusive','superseded')),
  same_vehicle_confidence NUMERIC,
  public_summary  TEXT,
  internal_explanation TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_temporal_findings_vin ON temporal_findings(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_temporal_findings_state ON temporal_findings(reviewer_state);

-- -------------------------------------------------------------------------------------
-- 4) Seller disclosure claims (master plan §9.2)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disclosure_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin             TEXT NOT NULL,
  listing_snapshot_id UUID REFERENCES listing_snapshots(id) ON DELETE SET NULL,
  claim_type      TEXT NOT NULL CHECK (claim_type IN (
                    'no_accident_history','original_paint','no_major_repairs','genuine_mileage',
                    'single_owner','recently_inspected','never_imported','component_present',
                    'defect_disclosed','other')),
  original_text   TEXT,
  normalized_claim JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence      NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disclosure_claims_vin ON disclosure_claims(vin);

-- -------------------------------------------------------------------------------------
-- 5) Disclosure conflicts (master plan §9.3) — governed, never auto-accusatory
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disclosure_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin             TEXT NOT NULL,
  claim_id        UUID REFERENCES disclosure_claims(id) ON DELETE CASCADE,
  conflict_type   TEXT,
  classification  TEXT NOT NULL DEFAULT 'possible_conflict' CHECK (classification IN (
                    'supported','not_verifiable','possible_conflict','strong_conflict',
                    'outdated_claim','resolved_corrected')),
  evidence_ids    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  confidence      NUMERIC,
  severity        TEXT CHECK (severity IS NULL OR severity IN ('info','low','medium','high','critical')),
  reviewer_state  TEXT NOT NULL DEFAULT 'pending_review' CHECK (reviewer_state IN (
                    'pending_review','confirmed','rejected','amended','inconclusive','superseded')),
  public_summary  TEXT,
  internal_explanation TEXT,
  seller_response TEXT,
  seller_response_at TIMESTAMPTZ,
  correction_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disclosure_conflicts_vin ON disclosure_conflicts(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disclosure_conflicts_state ON disclosure_conflicts(reviewer_state);

-- -------------------------------------------------------------------------------------
-- 6) RLS + grants — intelligence outputs are never exposed to anon directly.
--    Public-safe summaries reach buyers only via the M4 report service allowlist,
--    and only for reviewer-confirmed, public-safe findings (master plan §8.9, §9.6).
-- -------------------------------------------------------------------------------------
ALTER TABLE IF EXISTS ai_analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS temporal_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS disclosure_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS disclosure_conflicts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ai_analysis_jobs FROM anon;
REVOKE ALL ON TABLE ai_observations FROM anon;
REVOKE ALL ON TABLE temporal_findings FROM anon;
REVOKE ALL ON TABLE disclosure_claims FROM anon;
REVOKE ALL ON TABLE disclosure_conflicts FROM anon;

GRANT SELECT ON TABLE ai_analysis_jobs TO authenticated;
GRANT SELECT ON TABLE ai_observations TO authenticated;
GRANT SELECT ON TABLE temporal_findings TO authenticated;
GRANT SELECT ON TABLE disclosure_claims TO authenticated;
GRANT SELECT ON TABLE disclosure_conflicts TO authenticated;

DROP POLICY IF EXISTS "ai jobs authenticated read" ON ai_analysis_jobs;
CREATE POLICY "ai jobs authenticated read" ON ai_analysis_jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ai obs authenticated read" ON ai_observations;
CREATE POLICY "ai obs authenticated read" ON ai_observations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "temporal findings authenticated read" ON temporal_findings;
CREATE POLICY "temporal findings authenticated read" ON temporal_findings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "disclosure claims authenticated read" ON disclosure_claims;
CREATE POLICY "disclosure claims authenticated read" ON disclosure_claims FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "disclosure conflicts authenticated read" ON disclosure_conflicts;
CREATE POLICY "disclosure conflicts authenticated read" ON disclosure_conflicts FOR SELECT TO authenticated USING (true);

-- +migrate Down
DROP TABLE IF EXISTS disclosure_conflicts;
DROP TABLE IF EXISTS disclosure_claims;
DROP TABLE IF EXISTS temporal_findings;
DROP TABLE IF EXISTS ai_observations;
DROP TABLE IF EXISTS ai_analysis_jobs;
