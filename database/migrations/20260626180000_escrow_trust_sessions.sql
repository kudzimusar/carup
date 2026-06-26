-- +migrate Up
-- =====================================================================================
-- Workstream F — Trust-gated Escrow Lifecycle
--
-- A governance layer ON TOP of the existing payment/escrow foundation (safepay_escrows):
-- it adds the MVP escrow state machine + trust gates + append-only transition history,
-- and links to a safepay_escrows row for the actual (sandbox) fund movement rather than
-- creating a second payment system.
--
-- Escrow fails closed unless identity is resolved, the vehicle is governed-published, no
-- critical fraud is open, the seller/dealer is not suspended, participants are authorized,
-- required documents are present, and the listing snapshot has not changed incompatibly.
-- Sandbox funds are always labelled sandbox; never represented as real money.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS escrow_trust_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                  TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  tenant_id            TEXT,
  buyer_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  seller_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Link to the existing payment escrow row for (sandbox) fund movement. Nullable until eligible.
  escrow_id            TEXT,
  status               TEXT NOT NULL DEFAULT 'not_requested'
                         CHECK (status IN ('not_requested','pending_eligibility','eligible','initiated',
                                           'funded_sandbox','inspection_pending','release_approved',
                                           'released_sandbox','disputed','refunded_sandbox','cancelled','failed')),
  listing_snapshot_hash TEXT,
  gate_reasons         JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key      TEXT UNIQUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escrow_sessions_vin ON escrow_trust_sessions(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_sessions_status ON escrow_trust_sessions(status);

-- Append-only state-transition history.
CREATE TABLE IF NOT EXISTS escrow_trust_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES escrow_trust_sessions(id) ON DELETE RESTRICT,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role   TEXT,
  reason       TEXT,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escrow_events_session ON escrow_trust_events(session_id, created_at DESC);

-- Append-only webhook audit (signature + replay verdicts).
CREATE TABLE IF NOT EXISTS escrow_trust_webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES escrow_trust_sessions(id) ON DELETE SET NULL,
  event_type      TEXT,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  replay_detected BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT UNIQUE,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS escrow_events_no_update ON escrow_trust_events;
CREATE TRIGGER escrow_events_no_update BEFORE UPDATE ON escrow_trust_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS escrow_events_no_delete ON escrow_trust_events;
CREATE TRIGGER escrow_events_no_delete BEFORE DELETE ON escrow_trust_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS escrow_wh_no_update ON escrow_trust_webhook_events;
CREATE TRIGGER escrow_wh_no_update BEFORE UPDATE ON escrow_trust_webhook_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS escrow_wh_no_delete ON escrow_trust_webhook_events;
CREATE TRIGGER escrow_wh_no_delete BEFORE DELETE ON escrow_trust_webhook_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

ALTER TABLE escrow_trust_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_trust_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_trust_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE escrow_trust_sessions, escrow_trust_events, escrow_trust_webhook_events FROM anon;
GRANT ALL ON TABLE escrow_trust_sessions, escrow_trust_events, escrow_trust_webhook_events TO service_role;
GRANT SELECT ON TABLE escrow_trust_sessions, escrow_trust_events TO authenticated;

DROP POLICY IF EXISTS "escrow privileged read" ON escrow_trust_sessions;
CREATE POLICY "escrow privileged read" ON escrow_trust_sessions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government','reviewer')));

DROP POLICY IF EXISTS "escrow participant read" ON escrow_trust_sessions;
CREATE POLICY "escrow participant read" ON escrow_trust_sessions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (buyer_id = auth.uid()::text OR seller_id = auth.uid()::text));

-- +migrate Down
DROP TRIGGER IF EXISTS escrow_events_no_update ON escrow_trust_events;
DROP TRIGGER IF EXISTS escrow_events_no_delete ON escrow_trust_events;
DROP TRIGGER IF EXISTS escrow_wh_no_update ON escrow_trust_webhook_events;
DROP TRIGGER IF EXISTS escrow_wh_no_delete ON escrow_trust_webhook_events;
DROP TABLE IF EXISTS escrow_trust_webhook_events;
DROP TABLE IF EXISTS escrow_trust_events;
DROP TABLE IF EXISTS escrow_trust_sessions;
