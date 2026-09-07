-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — S8: Service Link foundation
-- (docs/service-network-foundation; plan §6.8, §20, §21)
-- =============================================================
-- Service Link is a resource-link protocol, not a QR subsystem: QR and deep
-- links are transports over the same resolver, and NFC would reuse it too.
--
-- TWO DIFFERENT THINGS, deliberately kept apart:
--
--  1. service_links — PERMANENT resource links (vehicle, service case,
--     practitioner). These are addresses, NOT authority. Scanning one grants
--     nothing: the resolver returns a role-safe context and the caller still
--     has to authenticate and be authorized (plan §20: Scan → Resolve →
--     Authenticate → Authorize → Act → Record). The token carries no private
--     payload, so a permanent sticker can be photographed without leaking
--     anything.
--
--  2. service_capability_grants — TEMPORARY, revocable, purpose-scoped
--     capabilities (plan §21), following the proven SA1C auth-action-token
--     pattern: only a SHA-256 hash is persisted, redemption is a single
--     conditional UPDATE, and the grant is bound to one resource and purpose.
--     auth_action_tokens is deliberately NOT reused: its purpose CHECK is
--     closed to four auth purposes, and widening it would destabilise SA1.
--
-- Both are service-role-only, FORCE RLS, zero policies.

-- +migrate Up

CREATE TABLE IF NOT EXISTS service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Opaque, non-enumerable public identifier. Never a VIN, never a row id.
  public_token TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('vehicle', 'service_case', 'practitioner')),
  resource_id TEXT NOT NULL,
  -- A link is deactivated, not deleted; a departing tenant must not silently
  -- invalidate printed codes without an explicit decision.
  tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_service_links_resource
  ON service_links(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS service_capability_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the bearer secret. The raw secret is returned exactly once and
  -- never persisted, so a leaked database read cannot be replayed as a token.
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('service_case_participation', 'service_context_read')),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('vehicle', 'service_case')),
  resource_id TEXT NOT NULL,
  -- Who authorised this, and for whom.
  granted_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- RESTRICT preserves the audit trail of who was granted what.
  grantee_tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by_user_id TEXT REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_capability_grants_resource
  ON service_capability_grants(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_service_capability_grants_expiry
  ON service_capability_grants(expires_at) WHERE redeemed_at IS NULL AND revoked_at IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_links','service_capability_grants']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated', t);
    -- No DELETE: revocation is a state (revoked_at), and the grant history is audit.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO service_role', t);
  END LOOP;
END $$;

-- +migrate Down
DROP TABLE IF EXISTS service_capability_grants;
DROP TABLE IF EXISTS service_links;
