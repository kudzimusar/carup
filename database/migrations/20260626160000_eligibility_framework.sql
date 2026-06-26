-- +migrate Up
-- =====================================================================================
-- Workstreams C/D/E — Shared Eligibility Provider Framework (insurance + finance)
--
-- One capability-typed model backs every eligibility provider (insurance, finance) so
-- the request/decision/webhook lifecycle, idempotency, audit and gates are implemented
-- ONCE, not three times. Escrow (WS-F) reuses the existing escrow state machine and is
-- gated by the same trust decision.
--
-- Honesty + safety: provider `mode` is mandatory; a provider must NEVER silently fall
-- back from live to sandbox in production. Decisions are append-only. Finance applicant
-- data is private (never buyer/partner visible). Webhooks are signed + replay-protected
-- + idempotent.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS eligibility_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability        TEXT NOT NULL CHECK (capability IN ('insurance', 'finance')),
  vin               TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  tenant_id         TEXT,
  requested_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider_id       TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('live', 'sandbox', 'partner_file', 'manual_review', 'unavailable')),
  -- Idempotency: the same key never creates a duplicate request.
  idempotency_key   TEXT UNIQUE,
  correlation_id    TEXT NOT NULL,
  request_version   TEXT NOT NULL DEFAULT 'elig-req-1.0.0',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('not_requested','pending','eligible','conditionally_eligible',
                                        'potentially_eligible','manual_review','not_eligible',
                                        'unavailable','expired','failed')),
  conditions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  validity_until    TIMESTAMPTZ,
  consent_reference TEXT,
  -- Snapshot of the gate inputs (identity/fraud/publication/dealer/source) + version.
  decision_inputs   JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_reference TEXT,
  error_category    TEXT CHECK (error_category IS NULL OR error_category IN
                      ('timeout','malformed_response','unauthorized','rate_limited','provider_error','gate_failed')),
  retry_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_elig_req_vin ON eligibility_requests(vin, capability, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elig_req_status ON eligibility_requests(capability, status);
CREATE INDEX IF NOT EXISTS idx_elig_req_idem ON eligibility_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Append-only decision history: every status change is a new immutable row.
CREATE TABLE IF NOT EXISTS eligibility_decisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES eligibility_requests(id) ON DELETE RESTRICT,
  decision_version  TEXT NOT NULL DEFAULT 'elig-dec-1.0.0',
  status            TEXT NOT NULL,
  conditions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_reference TEXT,
  actor             TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_elig_dec_request ON eligibility_decisions(request_id, created_at DESC);

-- Append-only webhook audit (signature + replay verdicts retained).
CREATE TABLE IF NOT EXISTS eligibility_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID REFERENCES eligibility_requests(id) ON DELETE SET NULL,
  capability        TEXT,
  provider_id       TEXT,
  event_type        TEXT,
  signature_valid   BOOLEAN NOT NULL DEFAULT false,
  replay_detected   BOOLEAN NOT NULL DEFAULT false,
  idempotency_key   TEXT UNIQUE,
  payload           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_elig_wh_request ON eligibility_webhook_events(request_id);

-- Append-only enforcement.
DROP TRIGGER IF EXISTS elig_dec_no_update ON eligibility_decisions;
CREATE TRIGGER elig_dec_no_update BEFORE UPDATE ON eligibility_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS elig_dec_no_delete ON eligibility_decisions;
CREATE TRIGGER elig_dec_no_delete BEFORE DELETE ON eligibility_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS elig_wh_no_update ON eligibility_webhook_events;
CREATE TRIGGER elig_wh_no_update BEFORE UPDATE ON eligibility_webhook_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS elig_wh_no_delete ON eligibility_webhook_events;
CREATE TRIGGER elig_wh_no_delete BEFORE DELETE ON eligibility_webhook_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- RLS. Finance is private (no buyer/partner exposure here); both: service-role full,
-- admin/government/reviewer read all, vehicle owner + requester read own. No anon.
ALTER TABLE eligibility_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE eligibility_requests, eligibility_decisions, eligibility_webhook_events FROM anon;
GRANT ALL ON TABLE eligibility_requests, eligibility_decisions, eligibility_webhook_events TO service_role;
GRANT SELECT ON TABLE eligibility_requests, eligibility_decisions TO authenticated;

DROP POLICY IF EXISTS "elig req privileged read" ON eligibility_requests;
CREATE POLICY "elig req privileged read" ON eligibility_requests FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government','reviewer')));

DROP POLICY IF EXISTS "elig req owner read" ON eligibility_requests;
CREATE POLICY "elig req owner read" ON eligibility_requests FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (
    requested_by = auth.uid()::text OR
    EXISTS (SELECT 1 FROM vehicles v WHERE v.vin = eligibility_requests.vin AND v.owner_id = auth.uid()::text)));

-- +migrate Down
DROP TRIGGER IF EXISTS elig_dec_no_update ON eligibility_decisions;
DROP TRIGGER IF EXISTS elig_dec_no_delete ON eligibility_decisions;
DROP TRIGGER IF EXISTS elig_wh_no_update ON eligibility_webhook_events;
DROP TRIGGER IF EXISTS elig_wh_no_delete ON eligibility_webhook_events;
DROP TABLE IF EXISTS eligibility_webhook_events;
DROP TABLE IF EXISTS eligibility_decisions;
DROP TABLE IF EXISTS eligibility_requests;
