-- Phase 7C — Verification case management additive schema.
--
-- Extends verification_sessions with workflow phase and reason code columns.
-- Adds append-only verification_assessments and verification_decisions tables.
-- All new tables are additive and idempotent. Existing migrations are preserved.
--
-- Order: run after 20260618030000_verification_ocr_provenance.sql.
--
-- Safe additive migration:
--   - No DROP TABLE, DROP COLUMN, DELETE, TRUNCATE
--   - No irreversible UPDATE of production data
--   - No unsafe NOT NULL additions on existing tables
--   - CREATE TABLE IF NOT EXISTS for all new tables
--   - CREATE INDEX IF NOT EXISTS for all indexes
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS for new columns
--
-- Recovery: simply revert by removing new columns and dropping new tables.
--   ALTER TABLE verification_sessions DROP COLUMN IF EXISTS workflow_phase;
--   ALTER TABLE verification_sessions DROP COLUMN IF EXISTS final_disposition;
--   ALTER TABLE verification_sessions DROP COLUMN IF EXISTS primary_reason_code;
--   DROP TABLE IF EXISTS verification_decisions;
--   DROP TABLE IF EXISTS verification_assessments;

-- ============================================================
-- Extend verification_sessions with workflow phase columns
-- ============================================================
ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS workflow_phase TEXT,
  ADD COLUMN IF NOT EXISTS final_disposition TEXT,
  ADD COLUMN IF NOT EXISTS primary_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS next_actor TEXT,
  ADD COLUMN IF NOT EXISTS required_action TEXT,
  ADD COLUMN IF NOT EXISTS action_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS notification_attempted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_verification_sessions_workflow_phase
  ON verification_sessions(workflow_phase);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_next_actor
  ON verification_sessions(next_actor);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_primary_reason_code
  ON verification_sessions(primary_reason_code);

-- ============================================================
-- Append-only verification_assessments
-- Records automated and human assessment of each verification attempt.
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
  assessment_version INTEGER NOT NULL DEFAULT 1,

  -- Evidence classification
  evidence_classification TEXT,
  document_type_detected TEXT,
  document_classification_confidence NUMERIC(5, 4),
  deterministic_reasons JSONB,

  -- OCR execution
  ocr_execution_status TEXT,
  extraction_trust_status TEXT,

  -- Identity binding
  identity_binding_status TEXT,

  -- Selfie/liveness
  selfie_check_status TEXT,

  -- Risk
  risk_level TEXT,
  risk_flags JSONB,
  recommended_action TEXT,

  -- Provider provenance
  provider TEXT,
  provider_model TEXT,
  evidence_hashes JSONB,

  -- Metadata
  assessment_source TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_session_id
  ON verification_assessments(session_id);
CREATE INDEX IF NOT EXISTS idx_assessments_evidence_classification
  ON verification_assessments(evidence_classification);
CREATE INDEX IF NOT EXISTS idx_assessments_extraction_trust
  ON verification_assessments(extraction_trust_status);
CREATE INDEX IF NOT EXISTS idx_assessments_created_at
  ON verification_assessments(created_at);

ALTER TABLE verification_assessments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE verification_assessments FROM anon;
REVOKE ALL ON TABLE verification_assessments FROM authenticated;
GRANT ALL ON TABLE verification_assessments TO service_role;

-- ============================================================
-- Append-only verification_decisions
-- Immutable record of every reviewer decision.
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_decisions (
  id TEXT PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,

  -- Decision
  decision TEXT NOT NULL,
  reason_code TEXT,
  internal_note TEXT,
  applicant_message TEXT,

  -- Reviewer
  reviewer_id TEXT,
  reviewer_role TEXT,

  -- State transition
  previous_workflow_phase TEXT,
  resulting_workflow_phase TEXT,
  previous_legacy_status TEXT,
  resulting_legacy_status TEXT,
  final_disposition TEXT,

  -- Safety
  idempotency_key TEXT,
  correlation_id TEXT,

  -- Immutable timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_idempotency_key
  ON verification_decisions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decisions_session_id
  ON verification_decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_decision
  ON verification_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_decisions_reason_code
  ON verification_decisions(reason_code);
CREATE INDEX IF NOT EXISTS idx_decisions_reviewer_id
  ON verification_decisions(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at
  ON verification_decisions(created_at);

ALTER TABLE verification_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE verification_decisions FROM anon;
REVOKE ALL ON TABLE verification_decisions FROM authenticated;
GRANT ALL ON TABLE verification_decisions TO service_role;
