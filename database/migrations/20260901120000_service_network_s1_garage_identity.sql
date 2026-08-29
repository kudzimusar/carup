-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — S1: Governed Garage Identity
-- & Publication (docs/service-network-foundation, S0 freeze §4.1)
-- =============================================================
-- Garage identity anchors on the ACTIVE tenants universe (002,
-- UUID ids). The legacy organizations/* universe is deliberately
-- untouched (S0 authority verdict a). These are sibling projection
-- tables: `tenants` itself is not widened.
--
-- Publication is governed and truthful:
--   * no ratings, no invented hours/phones/verified badges;
--   * verification_dimensions is written only by governed
--     workflows (none exist yet — so nothing renders "verified");
--   * a draft profile is invisible to every public surface.
--
-- RLS posture (S0 template): backend runs as service_role and the
-- runtime tenant boundary is app-level .eq('tenant_id', verified
-- context) — so these tables are service-role-only, default-deny,
-- ZERO client policies (the tenant_vehicles_isolation NULL-branch
-- idiom is deliberately NOT copied).

-- +migrate Up

CREATE TABLE IF NOT EXISTS garage_public_profiles (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  publication_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','published','unpublished')),
  description TEXT,
  location_city TEXT,
  location_province TEXT,
  contact_policy TEXT NOT NULL DEFAULT 'in_app_only'
    CHECK (contact_policy IN ('in_app_only','phone_public')),
  public_phone TEXT,
  service_categories TEXT[] NOT NULL DEFAULT '{}',
  -- Governed verification facts only ({} = nothing verified, rendered as
  -- unverified — never fabricated). Foundation ships no writer for this.
  verification_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_media JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garage_public_profiles_status
  ON garage_public_profiles(publication_status);

CREATE TABLE IF NOT EXISTS garage_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_city TEXT,
  location_province TEXT,
  address_public TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_garage_branches_tenant
  ON garage_branches(tenant_id);

-- Service-role-only posture; zero client policies (default deny).
ALTER TABLE garage_public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_public_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE garage_public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE garage_public_profiles TO service_role;

ALTER TABLE garage_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_branches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE garage_branches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE garage_branches TO service_role;

-- +migrate Down
DROP TABLE IF EXISTS garage_branches;
DROP TABLE IF EXISTS garage_public_profiles;
