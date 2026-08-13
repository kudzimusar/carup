-- +migrate Up
-- Phase 2A: governed trust fact request workflow

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trust_fact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  trust_fact TEXT NOT NULL,
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
  CONSTRAINT trust_fact_requests_fact_check CHECK (trust_fact IN (
    'vehicle_condition_category',
    'passport_verified',
    'inspection_ready'
  )),
  CONSTRAINT trust_fact_requests_status_check CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'revoked',
    'superseded'
  ))
);

CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_vin ON trust_fact_requests(vin);
CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_trust_fact ON trust_fact_requests(trust_fact);
CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_status ON trust_fact_requests(status);
CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_requested_by ON trust_fact_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_reviewed_by ON trust_fact_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_created_at ON trust_fact_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_trust_fact_requests_vin_fact_status ON trust_fact_requests(vin, trust_fact, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_fact_requests_one_pending
  ON trust_fact_requests(vin, trust_fact)
  WHERE status = 'pending';

ALTER TABLE trust_fact_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE trust_fact_requests FROM anon;
REVOKE ALL ON TABLE trust_fact_requests FROM authenticated;
GRANT ALL ON TABLE trust_fact_requests TO service_role;
