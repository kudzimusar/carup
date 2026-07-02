-- +migrate Up
-- =====================================================================================
-- Workstream 9 — Controlled Partner API
--
-- Approved external consumers (insurers, lenders, fleet/import partners) retrieve
-- PERMITTED, redacted trust results through a versioned, scoped, audited API. Credentials
-- are stored hashed; every request is logged append-only; scopes are least-privilege.
--
-- These are internal control-plane tables: service-role only. Partner authentication
-- happens server-side (the Express gateway holds the service-role key); the partner
-- never touches Supabase directly and never receives a raw private document or owner PII.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS partner_clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  -- SHA-256 hash of the issued API key. The plaintext key is shown once at creation and
  -- never stored. Lookup is by hash; compare is constant-time in the service layer.
  key_hash      TEXT NOT NULL UNIQUE,
  -- Least-privilege scopes, e.g. ['vehicle:identity','vehicle:trust','vehicle:sources'].
  scopes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'revoked')),
  tenant_id     TEXT,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  contact_email TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_clients_key ON partner_clients(key_hash) WHERE status = 'active';

-- Append-only request audit. Every partner call is recorded with correlation id, scope
-- used, status code and latency. Immutable (governance_block_mutation).
CREATE TABLE IF NOT EXISTS partner_api_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID REFERENCES partner_clients(id) ON DELETE RESTRICT,
  correlation_id TEXT NOT NULL,
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  scope_required TEXT,
  status_code    INTEGER NOT NULL,
  outcome        TEXT NOT NULL DEFAULT 'ok'
                   CHECK (outcome IN ('ok', 'unauthorized', 'forbidden', 'rate_limited', 'not_found', 'error')),
  latency_ms     INTEGER,
  idempotency_key TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_requests_client ON partner_api_requests(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_requests_idem ON partner_api_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS partner_requests_no_update ON partner_api_requests;
CREATE TRIGGER partner_requests_no_update
  BEFORE UPDATE ON partner_api_requests
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS partner_requests_no_delete ON partner_api_requests;
CREATE TRIGGER partner_requests_no_delete
  BEFORE DELETE ON partner_api_requests
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- Control-plane: service-role only. No anon, no authenticated direct access (the API
-- gateway mediates everything; key hashes must never be client-readable).
ALTER TABLE partner_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_api_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE partner_clients FROM anon, authenticated;
REVOKE ALL ON TABLE partner_api_requests FROM anon, authenticated;
GRANT ALL ON TABLE partner_clients TO service_role;
GRANT ALL ON TABLE partner_api_requests TO service_role;

-- +migrate Down
DROP TRIGGER IF EXISTS partner_requests_no_update ON partner_api_requests;
DROP TRIGGER IF EXISTS partner_requests_no_delete ON partner_api_requests;
DROP TABLE IF EXISTS partner_api_requests;
DROP TABLE IF EXISTS partner_clients;
