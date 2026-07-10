-- +migrate Up
-- Phase 2B.1 (ported from PR #11): governed PartSentry public-card review workflow.
--
-- Creates the partsentry_review_requests queue (pending/approved/rejected/revoked/superseded)
-- and adds reviewer-provenance columns (approved_by/approved_at) to partsentry_logs so the
-- marketplace read side (summarizePartSentry) can verify approver provenance and enforce the
-- self-approval guard. Service-role-only posture: RLS enabled, no anon/authenticated policies.
--
-- NOTE: the original source migration opened with CREATE EXTENSION IF NOT EXISTS pgcrypto.
-- That line is intentionally dropped here: gen_random_uuid() is core in PG13+ (and in the
-- PGlite harness, where the pgcrypto extension is unavailable), and production Supabase
-- already provides pgcrypto.

-- Compatibility shim for environments without the base schema (e.g. the PGlite migration
-- harness, whose bootstrap has only minimal users/vehicles). In production this is a no-op:
-- partsentry_logs already exists via supabase_schema.sql. Mirrors the production definition.
CREATE TABLE IF NOT EXISTS partsentry_logs (
  id BIGSERIAL PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  mechanic_id TEXT NOT NULL REFERENCES users(id),
  part_name TEXT NOT NULL,
  part_oem TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('Replaced', 'Repaired', 'Inspected', 'Diagnosed')),
  description TEXT,
  mileage INTEGER NOT NULL,
  signature TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Governance columns (idempotent mirror of 20260603132036_marketplace_listing_summary_infra.sql,
-- which production has applied; needed here so the harness shim matches the governed shape).
ALTER TABLE partsentry_logs
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS part_verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS suspicion_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS public_card_eligible BOOLEAN NOT NULL DEFAULT false;

-- Reviewer provenance stamped by the approval workflow. Required by main's
-- summarizePartSentry: without approved_by the read side downgrades approvals to
-- review_required (and the self-approval guard compares approved_by to mechanic_id).
ALTER TABLE partsentry_logs ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE partsentry_logs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

DO $$
BEGIN
  IF to_regclass('public.partsentry_logs') IS NOT NULL
    AND to_regclass('public.vehicles') IS NOT NULL
    AND to_regclass('public.users') IS NOT NULL
  THEN
    CREATE TABLE IF NOT EXISTS partsentry_review_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partsentry_log_id BIGINT NOT NULL REFERENCES partsentry_logs(id) ON DELETE CASCADE,
      vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
      request_type TEXT NOT NULL,
      requested_value JSONB NOT NULL,
      current_value JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT REFERENCES users(id),
      requested_by_role TEXT NOT NULL,
      requested_by_tenant_id UUID,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_by_role TEXT,
      reviewed_by_tenant_id UUID,
      evidence_ids TEXT[] NOT NULL DEFAULT '{}',
      partsentry_log_ids TEXT[] NOT NULL DEFAULT '{}',
      reason TEXT,
      decision_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT partsentry_review_requests_type_check CHECK (request_type IN (
        'public_card_eligible',
        'verification_status',
        'part_verification_status',
        'suspicion_status'
      )),
      CONSTRAINT partsentry_review_requests_status_check CHECK (status IN (
        'pending',
        'approved',
        'rejected',
        'revoked',
        'superseded'
      ))
    );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.partsentry_review_requests') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_log_id
      ON partsentry_review_requests(partsentry_log_id);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_vin
      ON partsentry_review_requests(vin);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_type
      ON partsentry_review_requests(request_type);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_status
      ON partsentry_review_requests(status);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_requested_by
      ON partsentry_review_requests(requested_by);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_reviewed_by
      ON partsentry_review_requests(reviewed_by);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_created_at
      ON partsentry_review_requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_partsentry_review_requests_vin_type_status
      ON partsentry_review_requests(vin, request_type, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_partsentry_review_requests_one_pending
      ON partsentry_review_requests(partsentry_log_id, request_type)
      WHERE status = 'pending';
  END IF;
END $$;

-- Service-role-only posture: RLS on, zero anon/authenticated policies, explicit revokes.
ALTER TABLE IF EXISTS partsentry_review_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.partsentry_review_requests') IS NOT NULL THEN
    REVOKE ALL ON TABLE partsentry_review_requests FROM anon;
    REVOKE ALL ON TABLE partsentry_review_requests FROM authenticated;
    GRANT ALL ON TABLE partsentry_review_requests TO service_role;
  END IF;
END $$;

-- +migrate Down
-- Reverse order of Up. Dropping the table removes its indexes, RLS state, and grants.
DROP TABLE IF EXISTS partsentry_review_requests;

-- Remove only the provenance columns this migration owns. The governance columns
-- (verification_status/part_verification_status/suspicion_status/public_card_eligible) are owned
-- by 20260603132036_marketplace_listing_summary_infra.sql and are left untouched, and the
-- partsentry_logs compatibility shim is NOT dropped (in production the table pre-exists this
-- migration and holds live service history).
ALTER TABLE IF EXISTS partsentry_logs DROP COLUMN IF EXISTS approved_at;
ALTER TABLE IF EXISTS partsentry_logs DROP COLUMN IF EXISTS approved_by;
