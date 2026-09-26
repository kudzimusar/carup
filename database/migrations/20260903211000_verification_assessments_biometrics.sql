-- +migrate Up
-- O2-X4: biometric evidence columns on the EXISTING append-only verification_assessments.
--
-- No second assessment engine: face↔document and liveness are two more evidence dimensions on
-- the 7C assessment record, alongside classification, extraction, and the (unchanged,
-- non-biometric) name-binding `identity_binding_status`. Scores are provider-supplied evidence
-- normalised into CarUp vocabulary under a versioned, server-owned threshold policy; nothing
-- here is a decision. `selfie_check_status` keeps its legacy meaning — it is NOT renamed to
-- imply facial recognition.
--
-- Data minimisation: statuses, scores, references and hashes only. No embeddings, templates,
-- or biometric media — and deliberately no table for them anywhere.

ALTER TABLE verification_assessments
  ADD COLUMN IF NOT EXISTS face_match_status TEXT,
  ADD COLUMN IF NOT EXISTS face_match_score NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS liveness_status TEXT,
  ADD COLUMN IF NOT EXISTS liveness_score NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_state TEXT,
  ADD COLUMN IF NOT EXISTS threshold_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS consent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_assessments_face_match_status
  ON verification_assessments(face_match_status);
CREATE INDEX IF NOT EXISTS idx_assessments_liveness_status
  ON verification_assessments(liveness_status);

-- +migrate Down
ALTER TABLE verification_assessments
  DROP COLUMN IF EXISTS consent_id,
  DROP COLUMN IF EXISTS threshold_policy_version,
  DROP COLUMN IF EXISTS provider_state,
  DROP COLUMN IF EXISTS provider_reference,
  DROP COLUMN IF EXISTS liveness_score,
  DROP COLUMN IF EXISTS liveness_status,
  DROP COLUMN IF EXISTS face_match_score,
  DROP COLUMN IF EXISTS face_match_status;
