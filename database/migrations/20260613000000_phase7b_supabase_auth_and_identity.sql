-- Phase 7B: missing Postgres schema for Supabase (auth sessions + identity verification).
--
-- Discovery (2026-06-13): the live Supabase project has no `user_sessions`,
-- so /api/auth/login issued tokens whose persistence silently failed and every
-- authenticated request 401'd ("Session is invalid or expired"). The
-- verification tables from 20260605042424_verification_sessions_phase7b.sql
-- were also never applied (earlier numbered migrations 002/004 are
-- SQLite-flavored and were only ever run against the local dev database).
--
-- This file is idempotent (IF NOT EXISTS / ON CONFLICT) and safe to run once
-- in the Supabase SQL editor or via `psql "$SUPABASE_DB_URL" -f <this file>`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------
-- 1. Auth: session + login bookkeeping (Postgres port of 002)
--
-- The live database already has a user_sessions table created from the
-- 003 (SQLite-flavored) schema: TEXT id/created_at/expires_at with no
-- defaults and active_role NOT NULL, later patched with token/is_valid
-- columns. /api/auth/login inserts only
-- {user_id, token, ip_address, user_agent, expires_at, is_valid}, so
-- its insert violated the legacy NOT NULL columns. The DO block below
-- backfills defaults so that insert works, without disturbing existing
-- rows or other writers. The CREATE TABLE covers fresh databases.
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE,
  active_role TEXT NOT NULL DEFAULT 'member',
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT now()::text,
  expires_at TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT true
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_sessions' AND column_name = 'id'
               AND column_default IS NULL) THEN
    ALTER TABLE user_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_sessions' AND column_name = 'active_role'
               AND column_default IS NULL) THEN
    ALTER TABLE user_sessions ALTER COLUMN active_role SET DEFAULT 'member';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_sessions' AND column_name = 'created_at'
               AND column_default IS NULL AND data_type = 'text') THEN
    ALTER TABLE user_sessions ALTER COLUMN created_at SET DEFAULT now()::text;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_sessions FROM anon;
REVOKE ALL ON TABLE user_sessions FROM authenticated;
GRANT ALL ON TABLE user_sessions TO service_role;

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT,
  success BOOLEAN NOT NULL,
  method TEXT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE login_attempts FROM anon;
REVOKE ALL ON TABLE login_attempts FROM authenticated;
GRANT ALL ON TABLE login_attempts TO service_role;

-- ---------------------------------------------------------------
-- 2. Identity: OCR documents (Postgres port of 004) — FK target
--    for verification_sessions.ocr_document_id
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ocr_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  document_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  extracted_json TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  status TEXT DEFAULT 'Pending_Verification' CHECK (
    status IN (
      'Pending_Verification',
      'Verified',
      'OCR_Provider_Unavailable',
      'Low_Confidence',
      'Poor_Image_Quality',
      'Suspected_Tampering',
      'Pending_Manual_Review'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_user ON ocr_documents(user_id);

ALTER TABLE ocr_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ocr_documents FROM anon;
REVOKE ALL ON TABLE ocr_documents FROM authenticated;
GRANT ALL ON TABLE ocr_documents TO service_role;

-- ---------------------------------------------------------------
-- 3. Identity: verification sessions
--    (verbatim from 20260605042424_verification_sessions_phase7b.sql)
-- ---------------------------------------------------------------

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

-- ---------------------------------------------------------------
-- 4. Storage: private bucket for raw verification images
-- ---------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('ocr-documents', 'ocr-documents', false)
ON CONFLICT (id) DO NOTHING;
