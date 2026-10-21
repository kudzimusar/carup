-- +migrate Up
-- GARAGE-1.0-OPS01 — multi-site + staff operations foundation.
--
-- Authority rules:
--   * garage_branches remains the canonical site authority;
--   * tenant_users remains the canonical membership / operating-access authority;
--   * the tables below add operating metadata and durable history only;
--   * no staff profile, department, skill, certificate or branch assignment grants access by itself.

ALTER TABLE public.garage_branches
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS manager_user_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'garage_branches_code_shape'
      AND conrelid = 'public.garage_branches'::regclass
  ) THEN
    ALTER TABLE public.garage_branches
      ADD CONSTRAINT garage_branches_code_shape
      CHECK (code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'garage_branches_manager_membership_fk'
      AND conrelid = 'public.garage_branches'::regclass
  ) THEN
    ALTER TABLE public.garage_branches
      ADD CONSTRAINT garage_branches_manager_membership_fk
      FOREIGN KEY (tenant_id, manager_user_id)
      REFERENCES public.tenant_users(tenant_id, user_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_branches_tenant_code
  ON public.garage_branches(tenant_id, code)
  WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.garage_branch_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  slot_no SMALLINT NOT NULL DEFAULT 1 CHECK (slot_no BETWEEN 1 AND 4),
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  opens_at TIME,
  closes_at TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_branch_hours_branch_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES public.garage_branches(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT garage_branch_hours_shape CHECK (
    (is_closed = TRUE AND opens_at IS NULL AND closes_at IS NULL)
    OR
    (is_closed = FALSE AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
  ),
  UNIQUE(branch_id, weekday, slot_no)
);

CREATE TABLE IF NOT EXISTS public.garage_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  name TEXT NOT NULL CHECK (BTRIM(name) <> '' AND length(name) <= 120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code),
  UNIQUE(id, tenant_id)
);

CREATE TABLE IF NOT EXISTS public.garage_staff_profiles (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employee_code TEXT,
  job_title TEXT,
  department_id UUID,
  employment_type TEXT CHECK (
    employment_type IS NULL OR employment_type IN ('owner','employee','contractor','apprentice')
  ),
  work_phone TEXT,
  started_on DATE,
  created_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT garage_staff_profiles_department_fk
    FOREIGN KEY (department_id, tenant_id)
    REFERENCES public.garage_departments(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_staff_profiles_employee_code
  ON public.garage_staff_profiles(tenant_id, employee_code)
  WHERE employee_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.garage_staff_branch_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_by_user_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_staff_branch_assignment_branch_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES public.garage_branches(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT garage_staff_branch_assignment_end_coherent CHECK (
    (ended_at IS NULL AND ended_by_user_id IS NULL)
    OR
    (ended_at IS NOT NULL AND ended_by_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_staff_branch_assignment_live
  ON public.garage_staff_branch_assignments(tenant_id, user_id, branch_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_staff_primary_branch_live
  ON public.garage_staff_branch_assignments(tenant_id, user_id)
  WHERE ended_at IS NULL AND is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_garage_staff_branch_assignments_branch
  ON public.garage_staff_branch_assignments(tenant_id, branch_id)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS public.garage_staff_skills (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  skill_code TEXT NOT NULL CHECK (skill_code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  skill_name TEXT NOT NULL CHECK (BTRIM(skill_name) <> '' AND length(skill_name) <= 120),
  recorded_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, skill_code)
);

CREATE TABLE IF NOT EXISTS public.garage_staff_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (BTRIM(name) <> '' AND length(name) <= 160),
  issuer TEXT,
  credential_ref TEXT,
  issued_on DATE,
  expires_on DATE,
  recorded_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_staff_certification_dates CHECK (
    expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on
  )
);

CREATE INDEX IF NOT EXISTS idx_garage_staff_certifications_staff
  ON public.garage_staff_certifications(tenant_id, user_id);

-- Service-role-only posture. Browser/client roles never access these tables directly.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'garage_branch_hours',
    'garage_departments',
    'garage_staff_profiles',
    'garage_staff_branch_assignments',
    'garage_staff_skills',
    'garage_staff_certifications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- Atomic branch-hours replacement. A malformed replacement changes nothing.
CREATE OR REPLACE FUNCTION public.replace_garage_branch_hours(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_hours JSONB,
  p_actor_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch public.garage_branches%ROWTYPE;
  v_item JSONB;
  v_weekday INTEGER;
  v_slot INTEGER;
  v_closed BOOLEAN;
  v_open TIME;
  v_close TIME;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND user_id = p_actor_user_id AND LOWER(role) = 'admin'
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS_ADMIN_REQUIRED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_branch
  FROM public.garage_branches
  WHERE id = p_branch_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_BRANCH_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF jsonb_typeof(COALESCE(p_hours, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'GARAGE_BRANCH_HOURS_ARRAY_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM public.garage_branch_hours
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb))
  LOOP
    v_weekday := (v_item->>'weekday')::INTEGER;
    v_slot := COALESCE((v_item->>'slot_no')::INTEGER, 1);
    v_closed := COALESCE((v_item->>'is_closed')::BOOLEAN, FALSE);
    v_open := NULLIF(v_item->>'opens_at', '')::TIME;
    v_close := NULLIF(v_item->>'closes_at', '')::TIME;

    INSERT INTO public.garage_branch_hours
      (tenant_id, branch_id, weekday, slot_no, is_closed, opens_at, closes_at)
    VALUES
      (p_tenant_id, p_branch_id, v_weekday, v_slot, v_closed, v_open, v_close);
  END LOOP;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'replaced', TRUE,
    'count', jsonb_array_length(COALESCE(p_hours, '[]'::jsonb))
  );
END;
$$;

-- Atomic staff-to-branch assignment. Membership remains the authority; this is operating placement only.
CREATE OR REPLACE FUNCTION public.assign_garage_staff_branch(
  p_tenant_id UUID,
  p_user_id TEXT,
  p_branch_id UUID,
  p_is_primary BOOLEAN,
  p_actor_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_branch public.garage_branches%ROWTYPE;
  v_assignment public.garage_staff_branch_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.type IS DISTINCT FROM 'garage' THEN
    RAISE EXCEPTION 'GARAGE_OPS_NOT_A_GARAGE' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND user_id = p_actor_user_id AND LOWER(role) = 'admin'
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS_ADMIN_REQUIRED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS_MEMBER_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_branch
  FROM public.garage_branches
  WHERE id = p_branch_id AND tenant_id = p_tenant_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_BRANCH_NOT_ACTIVE' USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(p_is_primary, FALSE) THEN
    UPDATE public.garage_staff_branch_assignments
       SET is_primary = FALSE
     WHERE tenant_id = p_tenant_id
       AND user_id = p_user_id
       AND ended_at IS NULL
       AND is_primary = TRUE;
  END IF;

  SELECT * INTO v_assignment
  FROM public.garage_staff_branch_assignments
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND branch_id = p_branch_id
    AND ended_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.garage_staff_branch_assignments
       SET is_primary = COALESCE(p_is_primary, FALSE)
     WHERE id = v_assignment.id
     RETURNING * INTO v_assignment;

    RETURN jsonb_build_object(
      'assignment_id', v_assignment.id,
      'created', FALSE,
      'is_primary', v_assignment.is_primary
    );
  END IF;

  INSERT INTO public.garage_staff_branch_assignments
    (tenant_id, user_id, branch_id, is_primary, assigned_by_user_id)
  VALUES
    (p_tenant_id, p_user_id, p_branch_id, COALESCE(p_is_primary, FALSE), p_actor_user_id)
  RETURNING * INTO v_assignment;

  RETURN jsonb_build_object(
    'assignment_id', v_assignment.id,
    'created', TRUE,
    'is_primary', v_assignment.is_primary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.end_garage_staff_branch_assignment(
  p_tenant_id UUID,
  p_assignment_id UUID,
  p_actor_user_id TEXT,
  p_reason TEXT DEFAULT 'reassigned'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment public.garage_staff_branch_assignments%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND user_id = p_actor_user_id AND LOWER(role) = 'admin'
  ) THEN
    RAISE EXCEPTION 'GARAGE_OPS_ADMIN_REQUIRED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.garage_staff_branch_assignments
     SET ended_at = NOW(),
         ended_by_user_id = p_actor_user_id,
         end_reason = NULLIF(BTRIM(COALESCE(p_reason, '')), '')
   WHERE id = p_assignment_id
     AND tenant_id = p_tenant_id
     AND ended_at IS NULL
  RETURNING * INTO v_assignment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_STAFF_ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', v_assignment.id,
    'user_id', v_assignment.user_id,
    'branch_id', v_assignment.branch_id,
    'ended', TRUE
  );
END;
$$;

-- OPS01 membership removal extends GMO-7 without weakening it:
-- branch managers must be reassigned explicitly, and live branch placements close in the same transaction.
CREATE OR REPLACE FUNCTION public.remove_garage_member_ops01(
  p_tenant_id UUID,
  p_user_id TEXT,
  p_actor_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_member public.tenant_users%ROWTYPE;
  v_admins INTEGER;
BEGIN
  IF p_actor_user_id IS NULL OR BTRIM(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_ACTOR_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.type IS DISTINCT FROM 'garage' THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_NOT_A_GARAGE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_member
  FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF LOWER(v_member.role) = 'admin' THEN
    SELECT count(*) INTO v_admins
    FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND LOWER(role) = 'admin';

    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'GARAGE_MEMBERSHIP_LAST_ADMIN' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.garage_branches
    WHERE tenant_id = p_tenant_id AND manager_user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_BRANCH_MANAGER' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.garage_staff_branch_assignments
     SET ended_at = NOW(),
         ended_by_user_id = p_actor_user_id,
         end_reason = 'membership_removed'
   WHERE tenant_id = p_tenant_id
     AND user_id = p_user_id
     AND ended_at IS NULL;

  DELETE FROM public.tenant_users WHERE id = v_member.id;

  RETURN jsonb_build_object(
    'membership_id', v_member.id,
    'tenant_id', p_tenant_id,
    'user_id', p_user_id,
    'previous_role', v_member.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_garage_branch_hours(UUID, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_garage_branch_hours(UUID, UUID, JSONB, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.assign_garage_staff_branch(UUID, TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_garage_staff_branch(UUID, TEXT, UUID, BOOLEAN, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.end_garage_staff_branch_assignment(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_garage_staff_branch_assignment(UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.remove_garage_member_ops01(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_garage_member_ops01(UUID, TEXT, TEXT) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.remove_garage_member_ops01(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.end_garage_staff_branch_assignment(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.assign_garage_staff_branch(UUID, TEXT, UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.replace_garage_branch_hours(UUID, UUID, JSONB, TEXT);

DROP TABLE IF EXISTS public.garage_staff_certifications;
DROP TABLE IF EXISTS public.garage_staff_skills;
DROP TABLE IF EXISTS public.garage_staff_branch_assignments;
DROP TABLE IF EXISTS public.garage_staff_profiles;
DROP TABLE IF EXISTS public.garage_departments;
DROP TABLE IF EXISTS public.garage_branch_hours;

ALTER TABLE public.garage_branches DROP CONSTRAINT IF EXISTS garage_branches_manager_membership_fk;
DROP INDEX IF EXISTS public.uq_garage_branches_tenant_code;
ALTER TABLE public.garage_branches DROP CONSTRAINT IF EXISTS garage_branches_code_shape;
ALTER TABLE public.garage_branches
  DROP COLUMN IF EXISTS manager_user_id,
  DROP COLUMN IF EXISTS contact_email,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS code;
