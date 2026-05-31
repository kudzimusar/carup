-- =============================================================
-- Phase 1 Migration: Multi-Tenancy & Auth Operations
-- Applies Agent 1 (Tenants) and Agent 2 (Auth) requirements
-- =============================================================

-- =============================================================
-- AGENT 1: MULTI-TENANT CORE
-- =============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- e.g., 'dealership', 'garage', 'government', 'finance'
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- e.g. 'admin', 'manager', 'member'
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  default_currency TEXT DEFAULT 'USD',
  timezone TEXT DEFAULT 'Africa/Harare',
  require_approval_workflows BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#000000',
  secondary_color TEXT DEFAULT '#ffffff',
  custom_domain TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enable_ai_agents BOOLEAN DEFAULT true,
  enable_custom_roles BOOLEAN DEFAULT false,
  enable_api_access BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_tier TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  billing_email TEXT,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

-- =============================================================
-- ALTER EXISTING TABLES TO BE TENANT-SCOPED
-- =============================================================

-- Safely add tenant_id to existing tables
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE safepay_escrows ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE partsentry_logs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE blockchain_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE finance_applications ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE insurance_records ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Create indexes for performance on the new tenant mappings
CREATE INDEX IF NOT EXISTS idx_organizations_tenant ON organizations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_safepay_escrows_tenant ON safepay_escrows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_partsentry_logs_tenant ON partsentry_logs(tenant_id);

-- =============================================================
-- AGENT 2: AUTHENTICATION & IDENTITY
-- =============================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT,
  success BOOLEAN NOT NULL,
  method TEXT NOT NULL, -- e.g., 'password', 'whatsapp_otp', 'email_otp'
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  is_revoked BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  trusted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- e.g., 'national_id', 'passport', 'driver_license'
  document_url TEXT NOT NULL,
  verification_status TEXT DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS kyc_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  national_id_number TEXT UNIQUE,
  address_line1 TEXT,
  city TEXT,
  country TEXT DEFAULT 'Zimbabwe',
  overall_status TEXT DEFAULT 'incomplete',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- ROW LEVEL SECURITY (TENANT ISOLATION)
-- =============================================================
-- In Supabase, standard multi-tenant RLS extracts the tenant ID 
-- from the JWT token or a custom setting passed by the client.
-- Example: current_setting('request.jwt.claims', true)::json->>'tenant_id'
-- We will write policies that enforce this strict isolation.

-- Enable RLS on new tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's active tenant from session variable
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- Example Tenant RLS: Users can only see their own tenant's vehicles
-- (Unless the vehicle is public, which is handled by an OR clause)
DROP POLICY IF EXISTS "tenant_vehicles_isolation" ON vehicles;
CREATE POLICY "tenant_vehicles_isolation" ON vehicles
  FOR ALL
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_tenant_id());

-- Users can only read tenants they belong to
DROP POLICY IF EXISTS "tenant_isolation" ON tenants;
CREATE POLICY "tenant_isolation" ON tenants
  FOR SELECT
  USING (id IN (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()::text
  ));

-- =============================================================
-- SEED DATA (MIGRATING ORGANIZATIONS TO TENANTS)
-- =============================================================
-- Create a default tenant for the seeded Croco Motors organization
INSERT INTO tenants (id, name, type)
VALUES ('00000000-0000-0000-0000-000000000001', 'Croco Motors Holdings', 'dealership')
ON CONFLICT DO NOTHING;

-- Map Croco Motors organization to the tenant
UPDATE organizations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE id = 'org_croco';
UPDATE vehicles SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE vin = 'VIN74329849204928';

-- Map u3 (Croco Dealer) to the tenant
INSERT INTO tenant_users (tenant_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'u3', 'admin')
ON CONFLICT DO NOTHING;
