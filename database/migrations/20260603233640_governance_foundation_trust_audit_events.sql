-- Governance Foundation: central trust audit events
-- Postgres/Supabase-safe immutable audit trail for governed trust facts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trust_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  vin TEXT,
  vehicle_id TEXT,
  trust_fact TEXT,
  previous_value JSONB,
  new_value JSONB,
  actor_user_id TEXT,
  actor_role TEXT,
  actor_tenant_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  source_dashboard TEXT,
  source_route TEXT,
  evidence_ids TEXT[] DEFAULT '{}',
  partsentry_log_ids TEXT[] DEFAULT '{}',
  registry_verification_id TEXT,
  safepay_transaction_id TEXT,
  reason TEXT,
  decision_notes TEXT,
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_audit_events_event_type ON trust_audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_trust_audit_events_vin ON trust_audit_events(vin);
CREATE INDEX IF NOT EXISTS idx_trust_audit_events_trust_fact ON trust_audit_events(trust_fact);
CREATE INDEX IF NOT EXISTS idx_trust_audit_events_actor_user_id ON trust_audit_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_trust_audit_events_created_at ON trust_audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_trust_audit_events_request_id ON trust_audit_events(request_id);

ALTER TABLE trust_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE trust_audit_events FROM anon;
REVOKE ALL ON TABLE trust_audit_events FROM authenticated;
GRANT ALL ON TABLE trust_audit_events TO service_role;
