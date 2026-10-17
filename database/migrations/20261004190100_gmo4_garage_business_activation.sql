-- +migrate Up
-- OC-5E GMO-4 (ported from PR #209 6dcf5945 20260906150000, with its 20260906200000 grants) — canonical
-- garage business activation. The one place in CarUp where a garage workspace comes into existence.
--
--   ATOMIC       tenant, founding membership and the application's claim commit together, or not at
--                all; a half-activated garage (a tenant nobody can reach, an application pointing at a
--                tenant with no members) cannot be observed.
--   SERIALIZED   FOR UPDATE on the application row: two concurrent activations queue; the second sees
--                the first's work and returns it — it never builds a second tenant.
--   IDEMPOTENT   calling it again returns the same tenant and membership with created=false.
--   DERIVED      every value written comes from the approved application row. There is no parameter
--                for tenant, name, user or role, so no caller — and therefore no browser — can choose
--                who becomes the founder of what.
--
-- PO-1: the founding role is the tenant-scoped `admin` (inside OC-5A's tenant-role catalogue). The
-- person's platform role is NOT touched; this function never writes `users`.
--
-- OC-5E, beyond #209: SECURITY INVOKER and the search_path are explicit (#209 relied on defaults), and
-- only service_role may execute it. The RETURNS TABLE shape is #209's unchanged, so CREATE OR REPLACE
-- applies over an environment that already ran the #209 lineage. Whether the applicant's identity is
-- still approved is checked by the service before this runs (identity is another domain's answer).

DO $$
BEGIN
  IF to_regclass('public.garage_applications') IS NULL OR to_regclass('public.tenant_users') IS NULL OR to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'GMO-4 requires garage_applications (20260918090000), tenants and tenant_users';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.activate_garage_application(
  p_application_id UUID,
  p_actor_user_id  TEXT DEFAULT NULL
)
RETURNS TABLE (
  tenant_id       UUID,
  membership_id   UUID,
  founder_user_id TEXT,
  founding_role   TEXT,
  created         BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app        public.garage_applications%ROWTYPE;
  v_tenant_id  UUID;
  v_member_id  UUID;
  v_name       TEXT;
  v_role       TEXT;
BEGIN
  -- The row lock is the race guard. A second concurrent activation of this application blocks
  -- here until the first commits, then observes activated_tenant_id already set.
  SELECT * INTO v_app
  FROM public.garage_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- Only an approved application may become a workspace.
  IF v_app.status <> 'approved' THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_NOT_APPROVED:%', v_app.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Already activated: return what exists — the SAME membership, never a second one.
  IF v_app.activated_tenant_id IS NOT NULL THEN
    SELECT tu.id, tu.role INTO v_member_id, v_role
    FROM public.tenant_users tu
    WHERE tu.tenant_id = v_app.activated_tenant_id
      AND tu.user_id = v_app.applicant_user_id;

    RETURN QUERY SELECT v_app.activated_tenant_id, v_member_id, v_app.applicant_user_id, v_role, FALSE;
    RETURN;
  END IF;

  -- Every value below is derived from the approved application. Nothing is supplied by a caller.
  v_name := NULLIF(BTRIM(COALESCE(v_app.trading_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_HAS_NO_NAME' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tenants (name, type, status)
  VALUES (v_name, 'garage', 'active')
  RETURNING id INTO v_tenant_id;

  -- PO-1: tenant-scoped `admin`. The founder is the APPLICANT, never the actor who ran this. No ON
  -- CONFLICT: the tenant is two statements old, so no membership can exist for it (and an ON CONFLICT
  -- on (tenant_id, user_id) would be ambiguous with this function's output columns).
  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_app.applicant_user_id, 'admin')
  RETURNING id, role INTO v_member_id, v_role;

  -- The claim is GUARDED on activated_tenant_id still being NULL, and a claim that wins no rows aborts
  -- the whole transaction — rolling back the tenant and membership created above. Correct even if the
  -- lock were removed: a loser rolls back completely and leaves no orphan tenant.
  UPDATE public.garage_applications
  SET activated_tenant_id = v_tenant_id,
      activated_at        = NOW(),
      updated_at          = NOW()
  WHERE id = p_application_id
    AND activated_tenant_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_ALREADY_ACTIVATED' USING ERRCODE = 'unique_violation';
  END IF;

  -- The role is returned rather than assumed, so the audit records what the database actually wrote.
  RETURN QUERY SELECT v_tenant_id, v_member_id, v_app.applicant_user_id, v_role, TRUE;
END;
$$;

COMMENT ON FUNCTION public.activate_garage_application(UUID, TEXT) IS
  'GMO-4 canonical garage activation (OC-5E). Atomic, serialized by FOR UPDATE, idempotent, and derived '
  'entirely from the approved application row — no parameter lets a caller choose the tenant, the founder '
  'or the role. Founding role is the tenant-scoped admin (PO-1); the platform role is never modified.';

REVOKE ALL ON FUNCTION public.activate_garage_application(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_garage_application(UUID, TEXT) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.activate_garage_application(UUID, TEXT);
