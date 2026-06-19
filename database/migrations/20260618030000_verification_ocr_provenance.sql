-- Phase 7C Workstream D: OCR provenance for identity verification.
--
-- Append-only audit of every automated OCR attempt behind a verification
-- session. It records WHERE an extracted identity came from — the provider, the
-- model, whether the run was a mock/seeded result, the evidence image hash, the
-- confidence, and success/failure — so a reviewer (or an auditor) can prove a
-- verified identity is backed by a real provider run on the actual uploaded
-- bytes, and can detect mock/seeded data that must never reach production.
--
-- Additive and idempotent. Does NOT alter verification_sessions. The backend
-- writes to this table best-effort (a provenance write failure never blocks the
-- verification flow), so this migration can be applied independently of a deploy.
--
-- NOT YET APPLIED to the live project — apply only with explicit owner approval
-- (same boundary as the admin-review migration). Safe to run once in the
-- Supabase SQL editor or via `psql "$SUPABASE_DB_URL" -f <this file>`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS verification_ocr_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ocr_document_id TEXT,
  -- Source of the extraction: e.g. 'gemini', 'ai_vision', 'mock', 'unknown'.
  provider TEXT NOT NULL DEFAULT 'unknown',
  model TEXT,
  -- TRUE when the result came from a test-only mock/seed. A row with is_mock =
  -- true must never be treated as production identity evidence.
  is_mock BOOLEAN NOT NULL DEFAULT false,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  confidence_score NUMERIC(5, 4),
  document_type TEXT,
  -- SHA-256 of each evidence side the system saw, for tamper / duplicate audit.
  evidence_hashes JSONB,
  failure_reason TEXT,
  -- Sanitized provider metadata (never raw document bytes or base64).
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_provenance_session_id ON verification_ocr_provenance(session_id);
CREATE INDEX IF NOT EXISTS idx_ocr_provenance_user_id ON verification_ocr_provenance(user_id);
CREATE INDEX IF NOT EXISTS idx_ocr_provenance_is_mock ON verification_ocr_provenance(is_mock);
CREATE INDEX IF NOT EXISTS idx_ocr_provenance_created_at ON verification_ocr_provenance(created_at);

ALTER TABLE verification_ocr_provenance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE verification_ocr_provenance FROM anon;
REVOKE ALL ON TABLE verification_ocr_provenance FROM authenticated;
GRANT ALL ON TABLE verification_ocr_provenance TO service_role;
