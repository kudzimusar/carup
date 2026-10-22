-- GARAGE-1.0-OPS01 — multi-site + workforce operating foundation
-- Extends the existing Service Network garage_branches authority; does not create a second branch model.
-- New workforce tables describe Garage employment/operations only. Login identity remains users,
-- operating membership remains tenant_users, and authorization remains the current active-tenant boundary.
--
-- +migrate Up

-- ── Existing branch authority: additive operational fields ──────────────────────────────────────
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS branch_code TEXT;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
-- Existing Service Network branches were already public when active. Default true preserves that
-- historical product meaning; OPS01 create/edit APIs require an explicit value for new operator-managed sites.
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE garage_branches ADD COLUMN IF NOT EXISTS manager_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_branches_code
  ON garage_branches(tenant_id, branch_code)
  WHERE branch_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_branches_primary
  ON garage_branches(tenant_id)
  WHERE is_primary = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garage_branches_code_format') THEN
    ALTER TABLE garage_branches
      ADD CONSTRAINT garage_branches_code_format
      CHECK (branch_code IS NULL OR branch_code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garage_branches_country_code_format') THEN
    ALTER TABLE garage_branches
      ADD CONSTRAINT garage_branches_country_code_format
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- Branch code is operational identity. Existing legacy rows may acquire one once; after that it is stable.
CREATE OR REPLACE FUNCTION garage_ops01_guard_branch_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.id = NEW.tenant_id
       AND t.type = 'garage'
  ) THEN
    RAISE EXCEPTION 'GARAGE_BRANCH_NOT_GARAGE_TENANT';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.branch_code IS NOT NULL
     AND NEW.branch_code IS DISTINCT FROM OLD.branch_code THEN
    RAISE EXCEPTION 'GARAGE_BRANCH_CODE_IMMUTABLE';
  END IF;

  IF NEW.manager_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_users tu
     WHERE tu.tenant_id = NEW.tenant_id
       AND tu.user_id = NEW.manager_user_id
  ) THEN
    RAISE EXCEPTION 'GARAGE_BRANCH_MANAGER_NOT_MEMBER';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops01_branch_identity ON garage_branches;
CREATE TRIGGER trg_garage_ops01_branch_identity
  BEFORE INSERT OR UPDATE OF tenant_id, branch_code, manager_user_id
  ON garage_branches
  FOR EACH ROW
  EXECUTE FUNCTION garage_ops01_guard_branch_identity();

-- ── Structured operating hours ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS garage_branch_opening_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_closed BOOLEAN NOT NULL DEFAULT false,
  opens_at TIME,
  closes_at TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_branch_hours_branch_tenant_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_branch_hours_shape
    CHECK (
      (is_closed = true AND opens_at IS NULL AND closes_at IS NULL)
      OR
      (is_closed = false AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at)
    ),
  UNIQUE(branch_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_garage_branch_hours_tenant_branch
  ON garage_branch_opening_hours(tenant_id, branch_id);

-- ── Garage-defined departments/teams; organizational metadata, not authorization ───────────────
CREATE TABLE IF NOT EXISTS garage_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_departments_name
  ON garage_departments(tenant_id, lower(name));

-- ── Workforce profile: extends, never replaces, users + tenant_users ────────────────────────────
CREATE TABLE IF NOT EXISTS garage_workforce_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  staff_code TEXT NOT NULL,
  job_title TEXT,
  employment_classification TEXT NOT NULL
    CHECK (employment_classification IN ('owner','employee','contractor','other')),
  employment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (employment_status IN ('pending','active','inactive','ended')),
  start_date DATE NOT NULL,
  end_date DATE,
  department_id UUID,
  internal_notes TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, tenant_id),
  UNIQUE(tenant_id, user_id),
  UNIQUE(tenant_id, staff_code),
  CONSTRAINT garage_workforce_department_tenant_fk
    FOREIGN KEY (department_id, tenant_id)
    REFERENCES garage_departments(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_dates_check
    CHECK (end_date IS NULL OR end_date >= start_date)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garage_workforce_staff_code_format') THEN
    ALTER TABLE garage_workforce_profiles
      ADD CONSTRAINT garage_workforce_staff_code_format
      CHECK (staff_code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_garage_workforce_tenant_status
  ON garage_workforce_profiles(tenant_id, employment_status);

CREATE INDEX IF NOT EXISTS idx_garage_workforce_user
  ON garage_workforce_profiles(user_id);

-- ── Historical staff ↔ branch assignments ──────────────────────────────────────────────────────
-- One person may have a primary branch plus additional permitted branches. Assignments are ended,
-- never deleted, so moving staff does not rewrite historical operating truth.
CREATE TABLE IF NOT EXISTS garage_workforce_branch_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ended_at TIMESTAMPTZ,
  ended_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_assignment_profile_tenant_fk
    FOREIGN KEY (workforce_profile_id, tenant_id)
    REFERENCES garage_workforce_profiles(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_assignment_branch_tenant_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_assignment_dates_check
    CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_workforce_live_branch_assignment
  ON garage_workforce_branch_assignments(tenant_id, workforce_profile_id, branch_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_workforce_live_primary
  ON garage_workforce_branch_assignments(tenant_id, workforce_profile_id)
  WHERE ended_at IS NULL AND is_primary = true;

CREATE INDEX IF NOT EXISTS idx_garage_workforce_assignments_branch
  ON garage_workforce_branch_assignments(tenant_id, branch_id)
  WHERE ended_at IS NULL;

-- A pending/active workforce profile must still be a current Garage member. Historical inactive/ended
-- profiles survive membership removal. Active mechanics additionally require one live primary site.
CREATE OR REPLACE FUNCTION garage_ops01_validate_workforce()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  membership_role TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.id = NEW.tenant_id
       AND t.type = 'garage'
  ) THEN
    RAISE EXCEPTION 'GARAGE_WORKFORCE_NOT_GARAGE_TENANT';
  END IF;

  IF NEW.employment_status IN ('pending','active') THEN
    SELECT lower(tu.role)
      INTO membership_role
      FROM tenant_users tu
     WHERE tu.tenant_id = NEW.tenant_id
       AND tu.user_id = NEW.user_id;

    IF membership_role IS NULL THEN
      RAISE EXCEPTION 'GARAGE_WORKFORCE_NOT_MEMBER';
    END IF;
  END IF;

  IF NEW.employment_status = 'active'
     AND membership_role = 'mechanic'
     AND NOT EXISTS (
       SELECT 1
         FROM garage_workforce_branch_assignments a
        WHERE a.tenant_id = NEW.tenant_id
          AND a.workforce_profile_id = NEW.id
          AND a.ended_at IS NULL
          AND a.is_primary = true
     ) THEN
    RAISE EXCEPTION 'GARAGE_WORKFORCE_PRIMARY_SITE_REQUIRED';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops01_validate_active_workforce ON garage_workforce_profiles;
DROP TRIGGER IF EXISTS trg_garage_ops01_validate_workforce ON garage_workforce_profiles;
CREATE TRIGGER trg_garage_ops01_validate_workforce
  BEFORE INSERT OR UPDATE OF tenant_id, user_id, employment_status
  ON garage_workforce_profiles
  FOR EACH ROW
  EXECUTE FUNCTION garage_ops01_validate_workforce();

-- New live assignments require a pending/active workforce member and an active branch in the same Garage.
CREATE OR REPLACE FUNCTION garage_ops01_validate_live_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  profile_status TEXT;
  branch_active BOOLEAN;
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT employment_status
    INTO profile_status
    FROM garage_workforce_profiles
   WHERE id = NEW.workforce_profile_id
     AND tenant_id = NEW.tenant_id;

  IF profile_status NOT IN ('pending','active') THEN
    RAISE EXCEPTION 'GARAGE_WORKFORCE_ASSIGNMENT_PROFILE_INACTIVE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM garage_workforce_profiles p
      JOIN tenant_users tu
        ON tu.tenant_id = p.tenant_id
       AND tu.user_id = p.user_id
     WHERE p.id = NEW.workforce_profile_id
       AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'GARAGE_WORKFORCE_ASSIGNMENT_NOT_MEMBER';
  END IF;

  SELECT is_active
    INTO branch_active
    FROM garage_branches
   WHERE id = NEW.branch_id
     AND tenant_id = NEW.tenant_id;

  IF branch_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GARAGE_WORKFORCE_ASSIGNMENT_BRANCH_INACTIVE';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops01_validate_live_assignment ON garage_workforce_branch_assignments;
CREATE TRIGGER trg_garage_ops01_validate_live_assignment
  BEFORE INSERT OR UPDATE OF tenant_id, workforce_profile_id, branch_id, ended_at
  ON garage_workforce_branch_assignments
  FOR EACH ROW
  EXECUTE FUNCTION garage_ops01_validate_live_assignment();

-- ── Structured skills and recorded certifications ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS garage_workforce_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  skill_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at TIMESTAMPTZ,
  removed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_skill_profile_tenant_fk
    FOREIGN KEY (workforce_profile_id, tenant_id)
    REFERENCES garage_workforce_profiles(id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_workforce_live_skill
  ON garage_workforce_skills(tenant_id, workforce_profile_id, lower(skill_name))
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS garage_workforce_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  name TEXT NOT NULL,
  issuer TEXT,
  reference_number TEXT,
  issue_date DATE,
  expiry_date DATE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_cert_profile_tenant_fk
    FOREIGN KEY (workforce_profile_id, tenant_id)
    REFERENCES garage_workforce_profiles(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_workforce_cert_dates_check
    CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

-- Membership removal remains the future-authority event. OPS01 closes current operational
-- responsibilities while preserving every workforce/branch-assignment row as history.
CREATE OR REPLACE FUNCTION garage_ops01_membership_removed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE garage_branches
     SET manager_user_id = NULL,
         updated_at = NOW()
   WHERE tenant_id = OLD.tenant_id
     AND manager_user_id = OLD.user_id;

  UPDATE garage_workforce_branch_assignments a
     SET ended_at = COALESCE(a.ended_at, NOW()),
         is_primary = false
    FROM garage_workforce_profiles p
   WHERE p.id = a.workforce_profile_id
     AND p.tenant_id = OLD.tenant_id
     AND p.user_id = OLD.user_id
     AND a.tenant_id = OLD.tenant_id
     AND a.ended_at IS NULL;

  UPDATE garage_workforce_profiles
     SET employment_status = 'ended',
         end_date = COALESCE(end_date, CURRENT_DATE),
         updated_at = NOW()
   WHERE tenant_id = OLD.tenant_id
     AND user_id = OLD.user_id
     AND employment_status <> 'ended';

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops01_membership_removed ON tenant_users;
CREATE TRIGGER trg_garage_ops01_membership_removed
  AFTER DELETE ON tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION garage_ops01_membership_removed();

-- Service-role-only posture, matching Service Network. The browser never talks to these tables directly.
ALTER TABLE garage_branch_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_branch_opening_hours FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_departments FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_branch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_branch_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_skills FORCE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_workforce_certifications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  garage_branch_opening_hours,
  garage_departments,
  garage_workforce_profiles,
  garage_workforce_branch_assignments,
  garage_workforce_skills,
  garage_workforce_certifications
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE garage_branch_opening_hours TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_departments TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_workforce_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_workforce_branch_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_workforce_skills TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_workforce_certifications TO service_role;

-- +migrate Down

DROP TRIGGER IF EXISTS trg_garage_ops01_membership_removed ON tenant_users;
DROP FUNCTION IF EXISTS garage_ops01_membership_removed();

DROP TRIGGER IF EXISTS trg_garage_ops01_validate_live_assignment ON garage_workforce_branch_assignments;
DROP FUNCTION IF EXISTS garage_ops01_validate_live_assignment();

DROP TRIGGER IF EXISTS trg_garage_ops01_validate_workforce ON garage_workforce_profiles;
DROP TRIGGER IF EXISTS trg_garage_ops01_validate_active_workforce ON garage_workforce_profiles;
DROP FUNCTION IF EXISTS garage_ops01_validate_workforce();
DROP FUNCTION IF EXISTS garage_ops01_validate_active_workforce();

DROP TABLE IF EXISTS garage_workforce_certifications;
DROP TABLE IF EXISTS garage_workforce_skills;
DROP TABLE IF EXISTS garage_workforce_branch_assignments;
DROP TABLE IF EXISTS garage_workforce_profiles;
DROP TABLE IF EXISTS garage_departments;
DROP TABLE IF EXISTS garage_branch_opening_hours;

DROP TRIGGER IF EXISTS trg_garage_ops01_branch_identity ON garage_branches;
DROP FUNCTION IF EXISTS garage_ops01_guard_branch_identity();

ALTER TABLE garage_branches DROP COLUMN IF EXISTS manager_user_id;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS is_public;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS is_primary;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS timezone;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS whatsapp;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS email;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS phone;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS country_code;
ALTER TABLE garage_branches DROP COLUMN IF EXISTS branch_code;
