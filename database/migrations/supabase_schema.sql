-- =============================================================
-- CarUp OS — Full PostgreSQL Schema for Supabase
-- Migrated from SQLite (backend/db/database.js)
-- Applied to Project: vhmnajoeicasaigiophh
-- =============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- USERS TABLE
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'dealer', 'mechanic', 'insurance', 'government', 'bank', 'admin')),
  phone TEXT,
  location TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  subscription TEXT DEFAULT 'Free' CHECK (subscription IN ('Free', 'Premium', 'Enterprise', 'System')),
  join_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- STAKEHOLDER PROFILES
-- =============================================================
CREATE TABLE IF NOT EXISTS stakeholder_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stakeholder_type TEXT NOT NULL,
  organization_name TEXT,
  status TEXT DEFAULT 'Active',
  kyc_status TEXT DEFAULT 'Pending',
  trust_score REAL DEFAULT 50.0
);

-- =============================================================
-- VEHICLES TABLE
-- =============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  vin TEXT PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  generation TEXT,
  trim TEXT,
  year INTEGER NOT NULL,
  color TEXT,
  mileage INTEGER NOT NULL,
  fuel_type TEXT,
  drivetrain TEXT,
  transmission TEXT,
  import_source TEXT,
  duty_paid BOOLEAN DEFAULT FALSE,
  police_verified BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'Available',
  trust_score REAL DEFAULT 80.0,
  price REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- BLOCKCHAIN EVENTS (Immutable ledger)
-- =============================================================
CREATE TABLE IF NOT EXISTS blockchain_events (
  id BIGSERIAL PRIMARY KEY,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp TEXT NOT NULL,
  signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- SAFEPAY ESCROWS
-- =============================================================
CREATE TABLE IF NOT EXISTS safepay_escrows (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  buyer_id TEXT NOT NULL REFERENCES users(id),
  seller_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Escrowed', 'Inspecting', 'Completed', 'Disputed', 'Refunded')),
  fee_split_zimra REAL NOT NULL,
  fee_split_escrow REAL NOT NULL,
  current_stage INTEGER DEFAULT 1,
  dispute_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- =============================================================
-- PARTSENTRY REPAIR LOGS
-- =============================================================
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

-- =============================================================
-- VEHICLE OWNERSHIP HISTORY
-- =============================================================
CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
  id BIGSERIAL PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  previous_owner_id TEXT REFERENCES users(id),
  new_owner_id TEXT NOT NULL REFERENCES users(id),
  transfer_date TEXT NOT NULL,
  transfer_hash TEXT NOT NULL
);

-- =============================================================
-- INSURANCE RECORDS
-- =============================================================
CREATE TABLE IF NOT EXISTS insurance_records (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  insurer_id TEXT NOT NULL REFERENCES users(id),
  policy_number TEXT NOT NULL UNIQUE,
  coverage_details TEXT,
  premium_amount REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  risk_score REAL DEFAULT 50.0
);

-- =============================================================
-- FINANCE APPLICATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS finance_applications (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  bank_id TEXT NOT NULL REFERENCES users(id),
  requested_amount REAL NOT NULL,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Under Review', 'Approved', 'Rejected', 'Disbursed')),
  monthly_payment REAL NOT NULL,
  apr REAL NOT NULL,
  created_at TEXT NOT NULL
);

-- =============================================================
-- ORGANIZATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('dealership', 'garage', 'insurance', 'bank', 'fleet', 'import', 'government')),
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS organization_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tax_id TEXT,
  license_number TEXT,
  phone TEXT,
  address TEXT,
  location TEXT,
  trust_score REAL DEFAULT 50.0,
  logo TEXT
);

CREATE TABLE IF NOT EXISTS organization_roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS organization_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
  department_id TEXT,
  branch_id TEXT,
  status TEXT DEFAULT 'active',
  joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_branches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS organization_departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manager_id TEXT
);

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  details TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_ai_agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pricing_copilot', 'diagnostics_copilot', 'risk_copilot', 'fraud_copilot', 'compliance_copilot')),
  status TEXT DEFAULT 'active',
  last_active TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(organization_id, key)
);

-- =============================================================
-- MIGRATIONS TABLE (from existing migration files)
-- =============================================================
CREATE TABLE IF NOT EXISTS financial_ledger (
  id BIGSERIAL PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  transaction_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  reference_id TEXT,
  description TEXT,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_queue (
  id BIGSERIAL PRIMARY KEY,
  recipient_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_role TEXT NOT NULL,
  active_organization_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS role_switch_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  previous_role TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  organization_id TEXT,
  timestamp TEXT NOT NULL,
  success BOOLEAN DEFAULT TRUE
);

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================
-- Enable RLS on all tables (server-side service_role bypasses this)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE safepay_escrows ENABLE ROW LEVEL SECURITY;
ALTER TABLE partsentry_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_audit_logs ENABLE ROW LEVEL SECURITY;

-- Public read access for vehicles (marketplace)
DROP POLICY IF EXISTS "vehicles_public_read" ON vehicles;
CREATE POLICY "vehicles_public_read" ON vehicles
  FOR SELECT USING (true);

-- Public read access for organizations directory
DROP POLICY IF EXISTS "organizations_public_read" ON organizations;
CREATE POLICY "organizations_public_read" ON organizations
  FOR SELECT USING (true);

-- =============================================================
-- SEED DATA
-- =============================================================

-- Seed Users
INSERT INTO users (id, name, email, avatar, role, phone, location, is_verified, subscription, join_date)
VALUES 
  ('u1', 'Tendai Moyo', 'tendai@email.co.zw', '/images/avatars/owner-1.jpg', 'owner', '+263 773 345 678', 'Harare', TRUE, 'Premium', '2024-03-15'),
  ('u2', 'Simbisa Garages', 'contact@simbisa.co.zw', '/images/avatars/mechanic-1.jpg', 'mechanic', '+263 772 111 222', 'Bulawayo', TRUE, 'Enterprise', '2023-08-10'),
  ('u3', 'Croco Motors', 'sales@crocomotors.co.zw', '/images/avatars/dealer-1.jpg', 'dealer', '+263 774 444 555', 'Harare', TRUE, 'Enterprise', '2022-01-05'),
  ('u4', 'Old Mutual Insurance', 'insurance@oldmutual.co.zw', '/images/avatars/insurance-1.jpg', 'insurance', '+263 771 999 888', 'Harare', TRUE, 'Enterprise', '2021-06-20'),
  ('u5', 'ZIMRA Registry', 'registry@zimra.co.zw', '/images/avatars/government-1.jpg', 'government', '+263 242 758 891', 'Harare', TRUE, 'System', '2020-01-01')
ON CONFLICT (id) DO NOTHING;

-- Seed Stakeholder Profiles
INSERT INTO stakeholder_profiles (id, user_id, stakeholder_type, organization_name, status, kyc_status, trust_score)
VALUES 
  ('sp1', 'u1', 'Buyer', 'Individual', 'Active', 'Verified', 92.5),
  ('sp2', 'u2', 'Mechanic', 'Simbisa Garages Ltd', 'Active', 'Verified', 95.0),
  ('sp3', 'u3', 'Dealer', 'Croco Motors Group', 'Active', 'Verified', 98.2),
  ('sp4', 'u4', 'Insurer', 'Old Mutual Zimbabwe', 'Active', 'Verified', 99.0),
  ('sp5', 'u5', 'Government', 'Zimbabwe Revenue Authority', 'Active', 'Verified', 100.0)
ON CONFLICT (id) DO NOTHING;

-- Seed Vehicles
INSERT INTO vehicles (vin, make, model, generation, trim, year, color, mileage, fuel_type, drivetrain, transmission, import_source, duty_paid, police_verified, status, trust_score, price, currency)
VALUES 
  ('VIN74329849204928', 'Toyota', 'Hilux', 'GD-6', 'Double Cab Legend 50', 2021, 'White', 48500, 'Diesel', '4WD', 'Automatic', 'South Africa', TRUE, TRUE, 'Available', 96.8, 42000.0, 'USD'),
  ('VIN89230489201948', 'Mercedes-Benz', 'C-Class', 'W205', 'C200 AMG Line', 2019, 'Grey', 72000, 'Petrol', 'RWD', 'Automatic', 'United Kingdom', TRUE, TRUE, 'Available', 91.2, 28500.0, 'USD'),
  ('VIN38492049281048', 'Mazda', 'Demio', '4th Gen', 'SkyActiv-G', 2017, 'Blue', 112000, 'Petrol', 'FWD', 'Automatic', 'Japan', TRUE, TRUE, 'Available', 84.5, 7500.0, 'USD')
ON CONFLICT (vin) DO NOTHING;

-- Seed Organizations
INSERT INTO organizations (id, name, type, created_at, status)
VALUES
  ('org_croco', 'Croco Motors Group', 'dealership', '2022-01-05', 'active'),
  ('org_simbisa', 'Simbisa Garages Ltd', 'garage', '2023-08-10', 'active'),
  ('org_oldmutual', 'Old Mutual Zimbabwe', 'insurance', '2021-06-20', 'active'),
  ('org_cbz', 'CBZ Bank Limited', 'bank', '2019-03-12', 'active'),
  ('org_zimra', 'Zimbabwe Revenue Authority', 'government', '2020-01-01', 'active')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization Profiles
INSERT INTO organization_profiles (id, organization_id, tax_id, license_number, phone, address, location, trust_score, logo)
VALUES
  ('prof_croco', 'org_croco', 'TIN-928392-D', 'LIC-DEALER-452', '+263 774 444 555', '100 Leopold Takawira St, Harare', 'Harare', 98.2, '/images/logos/croco.jpg'),
  ('prof_simbisa', 'org_simbisa', 'TIN-112233-G', 'LIC-GARAGE-882', '+263 772 111 222', '12 Robert Mugabe Way, Bulawayo', 'Bulawayo', 95.0, '/images/logos/simbisa.jpg'),
  ('prof_oldmutual', 'org_oldmutual', 'TIN-999888-I', 'LIC-INS-332', '+263 771 999 888', '100 Mutual Gardens, Harare', 'Harare', 99.0, '/images/logos/oldmutual.jpg'),
  ('prof_cbz', 'org_cbz', 'TIN-888777-B', 'LIC-BANK-110', '+263 867 700 2000', '60 Kwame Nkrumah Ave, Harare', 'Harare', 97.5, '/images/logos/cbz.jpg'),
  ('prof_zimra', 'org_zimra', 'TIN-000001-G', 'LIC-GOV-001', '+263 242 758 891', 'Kurima House, Nelson Mandela Ave, Harare', 'Harare', 100.0, '/images/logos/zimra.jpg')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization Roles
INSERT INTO organization_roles (id, organization_id, name, level, description)
VALUES
  ('role_croco_owner', 'org_croco', 'Owner', 2, 'Full ownership of Croco Motors dealership'),
  ('role_croco_admin', 'org_croco', 'Administrator', 3, 'Branch management and inventory approval'),
  ('role_croco_staff', 'org_croco', 'Sales Agent', 4, 'Upload inventory and view leads'),
  ('role_simbisa_mechanic', 'org_simbisa', 'Certified Mechanic', 4, 'Append and sign service history logs'),
  ('role_oldmutual_underwriter', 'org_oldmutual', 'Risk Analyst', 4, 'Policy underwriting and claims review'),
  ('role_cbz_officer', 'org_cbz', 'Loan Officer', 4, 'Assess financing applications'),
  ('role_zimra_officer', 'org_zimra', 'Customs Officer', 4, 'Verify ZIMRA declarations')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization Branches
INSERT INTO organization_branches (id, organization_id, name, location, phone)
VALUES
  ('branch_croco_hre', 'org_croco', 'Harare Central Branch', 'Harare', '+263 774 444 555'),
  ('branch_croco_byo', 'org_croco', 'Bulawayo Showroom', 'Bulawayo', '+263 9 77889'),
  ('branch_simbisa_byo', 'org_simbisa', 'Bulawayo Main Workshop', 'Bulawayo', '+263 772 111 222'),
  ('branch_oldmutual_hre', 'org_oldmutual', 'Harare HQ Office', 'Harare', '+263 771 999 888')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization Users
INSERT INTO organization_users (id, organization_id, user_id, role_id, department_id, branch_id, status, joined_at)
VALUES
  ('ou_simbisa_u2', 'org_simbisa', 'u2', 'role_simbisa_mechanic', NULL, 'branch_simbisa_byo', 'active', '2023-08-10'),
  ('ou_croco_u3', 'org_croco', 'u3', 'role_croco_owner', NULL, 'branch_croco_hre', 'active', '2022-01-05'),
  ('ou_oldmutual_u4', 'org_oldmutual', 'u4', 'role_oldmutual_underwriter', NULL, 'branch_oldmutual_hre', 'active', '2021-06-20'),
  ('ou_zimra_u5', 'org_zimra', 'u5', 'role_zimra_officer', NULL, NULL, 'active', '2020-01-01')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization Departments
INSERT INTO organization_departments (id, organization_id, name, manager_id)
VALUES
  ('dept_croco_sales', 'org_croco', 'Sales & Marketing', 'u3'),
  ('dept_croco_inv', 'org_croco', 'Inventory & Operations', 'u3')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization AI Agents
INSERT INTO organization_ai_agents (id, organization_id, name, type, status, last_active)
VALUES
  ('ai_croco_pricing', 'org_croco', 'Dealer Pricing Advisor', 'pricing_copilot', 'active', '2026-05-26T16:00:00Z'),
  ('ai_simbisa_diag', 'org_simbisa', 'Gutu Repair Diagnostician', 'diagnostics_copilot', 'active', '2026-05-26T16:00:00Z'),
  ('ai_oldmutual_risk', 'org_oldmutual', 'Risk Analyzer Agent', 'risk_copilot', 'active', '2026-05-26T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Seed Organization Settings
INSERT INTO organization_settings (id, organization_id, key, value)
VALUES
  ('set_croco_currency', 'org_croco', 'default_currency', 'USD'),
  ('set_simbisa_approval', 'org_simbisa', 'require_client_approval', 'true')
ON CONFLICT (organization_id, key) DO NOTHING;

-- Seed Audit Logs
INSERT INTO organization_audit_logs (organization_id, user_id, action, resource, details, timestamp, ip_address)
VALUES
  ('org_croco', 'u3', 'CREATE_LISTING', 'inventory', 'Created listing for Toyota Hilux VIN74329849204928', '2026-05-26T12:05:00Z', '192.168.1.10'),
  ('org_simbisa', 'u2', 'ADD_REPAIR_LOG', 'partsentry', 'Appended partsentry log for suspension replacement', '2026-05-26T14:15:00Z', '192.168.1.15');

-- Seed Blockchain Events
INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature)
VALUES
  (
    '0000000000000000000000000000000000000000000000000000000000000000',
    encode(digest('0000000000000000000000000000000000000000000000000000000000000000' || 'VIN74329849204928' || 'Registry Verification' || '2026-05-26T12:00:00Z' || '{"owner":"Tendai Moyo","cvr_registered":true,"zimra_duty_status":"Cleared"}', 'sha256'), 'hex'),
    'VIN74329849204928',
    'Registry Verification',
    '{"owner":"Tendai Moyo","cvr_registered":true,"zimra_duty_status":"Cleared"}',
    '2026-05-26T12:00:00Z',
    'SYSTEM_SIGNATURE'
  );
