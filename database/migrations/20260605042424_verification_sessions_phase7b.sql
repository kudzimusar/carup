-- Phase 7B: backend verification sessions for mobile OCR persistence.
-- Raw images stay in the private Supabase Storage bucket (`ocr-documents`);
-- this table stores only secure storage paths, status, and sanitized OCR output.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS verification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  double_sided BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'captured',
      'uploaded',
      'ocr_pending',
      'ocr_failed',
      'pending_manual_review',
      'verified',
      'rejected'
    )
  ),
  front_storage_path TEXT,
  front_mime_type TEXT,
  back_storage_path TEXT,
  back_mime_type TEXT,
  selfie_storage_path TEXT,
  selfie_mime_type TEXT,
  ocr_document_id TEXT REFERENCES ocr_documents(id),
  ocr_result JSONB,
  confidence_score NUMERIC(5, 4),
  failure_reason TEXT,
  review_notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  ocr_started_at TIMESTAMPTZ,
  ocr_completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_sessions_user_id ON verification_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_status ON verification_sessions(status);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_document_type ON verification_sessions(document_type);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_ocr_document_id ON verification_sessions(ocr_document_id);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_created_at ON verification_sessions(created_at);

ALTER TABLE verification_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE verification_sessions FROM anon;
REVOKE ALL ON TABLE verification_sessions FROM authenticated;
GRANT ALL ON TABLE verification_sessions TO service_role;
