-- +migrate Up
-- Phase 7C: admin / manual-review fields for identity verification sessions.
--
-- Additive and idempotent. `reviewed_by` and `reviewed_at` already exist from
-- 20260605042424_verification_sessions_phase7b.sql; this migration adds the
-- reviewer decision record and the retry-request channel, and extends the
-- status CHECK to allow the new `retry_requested` state.
--
-- `liveness_status` is added now for forward compatibility only. Phase 7C does
-- NOT perform real biometric liveness; the column defaults to NULL and the
-- backend never sets it to 'verified'. It exists so a future liveness phase is
-- a value change, not a schema migration.
--
-- Safe to run once in the Supabase SQL editor or via
-- `psql "$SUPABASE_DB_URL" -f <this file>`.

ALTER TABLE verification_sessions
  ADD COLUMN IF NOT EXISTS review_decision TEXT,
  ADD COLUMN IF NOT EXISTS retry_reason TEXT,
  ADD COLUMN IF NOT EXISTS liveness_status TEXT;

-- Constrain review_decision to the supported reviewer actions (NULL until reviewed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'verification_sessions'
      AND constraint_name = 'verification_sessions_review_decision_check'
  ) THEN
    ALTER TABLE verification_sessions
      ADD CONSTRAINT verification_sessions_review_decision_check
      CHECK (review_decision IS NULL OR review_decision IN ('approve', 'reject', 'request_retry'));
  END IF;
END
$$;

-- Extend the status CHECK to allow the reviewer-driven `retry_requested` state.
ALTER TABLE verification_sessions DROP CONSTRAINT IF EXISTS verification_sessions_status_check;
ALTER TABLE verification_sessions
  ADD CONSTRAINT verification_sessions_status_check CHECK (
    status IN (
      'draft',
      'captured',
      'uploaded',
      'ocr_pending',
      'ocr_failed',
      'pending_manual_review',
      'retry_requested',
      'verified',
      'rejected'
    )
  );

CREATE INDEX IF NOT EXISTS idx_verification_sessions_reviewed_by ON verification_sessions(reviewed_by);
