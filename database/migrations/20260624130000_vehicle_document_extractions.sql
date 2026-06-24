-- +migrate Up
-- =====================================================================================
-- Phase 3 — Vehicle Document Extractions (Strict OCR/Field-Level Contract)
--
-- ai_observations (M3) stores generic JSONB observations and does not satisfy the
-- field-level extraction contract required by the Vehicle Trust OS MVP:
--   - no typed field_name, raw_value, normalized_value columns
--   - no VIN column (linked only via evidence_id → job_id)
--   - no document_type column
--   - no compared_vehicle_field, expected_value, match_status columns
--   - no mismatch_reason, review_status, reviewed_by, reviewed_at columns
--
-- This migration adds an ADDITIVE table: vehicle_document_extractions.
-- ai_observations is preserved unchanged for AI internal state.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS vehicle_document_extractions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id             UUID NOT NULL REFERENCES vehicle_evidence(id) ON DELETE RESTRICT,
  vin                     TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  document_type           TEXT NOT NULL,
  field_name              TEXT NOT NULL,
  raw_value               TEXT,
  normalized_value        TEXT,
  confidence              NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  compared_vehicle_field  TEXT,
  expected_value          TEXT,
  match_status            TEXT NOT NULL DEFAULT 'inconclusive'
                            CHECK (match_status IN ('match', 'mismatch', 'missing_reference', 'inconclusive')),
  mismatch_reason         TEXT,
  review_status           TEXT NOT NULL DEFAULT 'pending'
                            CHECK (review_status IN ('pending', 'confirmed', 'rejected', 'amended', 'waived')),
  reviewed_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  source_model            TEXT,
  ai_job_id               UUID REFERENCES ai_analysis_jobs(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vde_evidence ON vehicle_document_extractions(evidence_id);
CREATE INDEX IF NOT EXISTS idx_vde_vin ON vehicle_document_extractions(vin, document_type);
CREATE INDEX IF NOT EXISTS idx_vde_match_status ON vehicle_document_extractions(match_status) WHERE match_status IN ('mismatch', 'inconclusive');
CREATE INDEX IF NOT EXISTS idx_vde_review_status ON vehicle_document_extractions(review_status) WHERE review_status = 'pending';

-- Append-only for the content fields: extracted values and match decisions cannot be
-- silently overwritten. Corrections must set review_status='amended' on the old row
-- and insert a new row. Only review_status, reviewed_by, reviewed_at and updated_at
-- may be updated after creation.
CREATE OR REPLACE FUNCTION carup_extraction_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
     OR NEW.vin IS DISTINCT FROM OLD.vin
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.field_name IS DISTINCT FROM OLD.field_name
     OR NEW.raw_value IS DISTINCT FROM OLD.raw_value
     OR NEW.normalized_value IS DISTINCT FROM OLD.normalized_value
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.compared_vehicle_field IS DISTINCT FROM OLD.compared_vehicle_field
     OR NEW.expected_value IS DISTINCT FROM OLD.expected_value
     OR NEW.match_status IS DISTINCT FROM OLD.match_status
     OR NEW.mismatch_reason IS DISTINCT FROM OLD.mismatch_reason
     OR NEW.source_model IS DISTINCT FROM OLD.source_model
     OR NEW.ai_job_id IS DISTINCT FROM OLD.ai_job_id THEN
    RAISE EXCEPTION 'vehicle_document_extractions content is immutable; create a new row for corrections and set the old row review_status=''amended''';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_extraction_no_content_update ON vehicle_document_extractions;
CREATE TRIGGER trg_extraction_no_content_update
  BEFORE UPDATE ON vehicle_document_extractions
  FOR EACH ROW EXECUTE FUNCTION carup_extraction_guard();

-- RLS: admin/reviewer can read all; owner/dealer can read extractions for their vehicle.
ALTER TABLE vehicle_document_extractions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE vehicle_document_extractions FROM anon;
GRANT ALL ON TABLE vehicle_document_extractions TO service_role;

DROP POLICY IF EXISTS "extractions admin or reviewer read" ON vehicle_document_extractions;
CREATE POLICY "extractions admin or reviewer read"
  ON vehicle_document_extractions FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

DROP POLICY IF EXISTS "extractions uploader read" ON vehicle_document_extractions;
CREATE POLICY "extractions uploader read"
  ON vehicle_document_extractions FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM vehicle_evidence ve
      WHERE ve.id = vehicle_document_extractions.evidence_id
        AND ve.uploaded_by = auth.uid()::text
    )
  );

GRANT SELECT ON TABLE vehicle_document_extractions TO authenticated;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_extraction_no_content_update ON vehicle_document_extractions;
DROP FUNCTION IF EXISTS carup_extraction_guard();
DROP TABLE IF EXISTS vehicle_document_extractions;
