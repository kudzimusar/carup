-- Phase 2B.1: governed PartSentry public-card review workflow

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

ALTER TABLE IF EXISTS partsentry_review_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.partsentry_review_requests') IS NOT NULL THEN
    REVOKE ALL ON TABLE partsentry_review_requests FROM anon;
    REVOKE ALL ON TABLE partsentry_review_requests FROM authenticated;
    GRANT ALL ON TABLE partsentry_review_requests TO service_role;
  END IF;
END $$;
