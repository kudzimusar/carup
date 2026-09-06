-- +migrate Up
-- GMO-4 — canonical business activation.
--
-- This is the one place in CarUp where a garage workspace comes into existence. Everything that
-- makes it safe is here rather than in application code, because the guarantees needed are
-- transactional and the Supabase client cannot express a transaction:
--
--   * ATOMIC       — tenant, founding membership and the application's claim commit together, or
--                    not at all. A half-activated garage (a tenant nobody can reach, or an
--                    application pointing at a tenant with no members) cannot be observed.
--   * SERIALIZED   — `FOR UPDATE` on the application row means two concurrent activations of the
--                    same application queue behind each other. The second sees the first's work
--                    and returns it; it never builds a second tenant.
--   * IDEMPOTENT   — calling it again returns the same tenant and the same membership, with
--                    created=false. Retrying after a dropped connection is safe.
--   * DERIVED      — every value written comes from the application row the reviewer approved.
--                    The caller supplies an application id and nothing else. There is no parameter
--                    for tenant id, tenant name, user id or role, so no caller — and therefore no
--                    browser — can choose who becomes the founder of what.
--
-- PO-1: the founding role is the tenant-scoped `admin`. The person's platform role in `users` is
-- NOT touched; this function never writes that table. A garage operator is a platform `owner` who
-- is `admin` inside one tenant, which is exactly the shape the seven authorization layers expect.

CREATE OR REPLACE FUNCTION public.activate_garage_application(
  p_application_id UUID,
  p_actor_user_id  TEXT DEFAULT NULL
)
RETURNS TABLE (
  tenant_id     UUID,
  membership_id UUID,
  founder_user_id TEXT,
  founding_role TEXT,
  created       BOOLEAN
)
LANGUAGE plpgsql
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

  -- Only an approved application may become a workspace. A pending, rejected, draft or
  -- information_required application activating is the failure this check exists to prevent.
  IF v_app.status <> 'approved' THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_NOT_APPROVED:%', v_app.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Already activated: return what exists. This is the idempotent path, and it must return the
  -- SAME membership rather than creating a second one.
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

  -- PO-1: tenant-scoped `admin`. The founder is the APPLICANT, never the actor who ran this.
  --
  -- Deliberately no ON CONFLICT: the tenant was created two statements ago with a fresh UUID, so
  -- no membership can already exist for it. An ON CONFLICT (tenant_id, user_id) here also collides
  -- with this function's RETURNS TABLE output parameters of the same names, and PostgreSQL rejects
  -- it as ambiguous — a defensive clause that can never fire and breaks the function is worse than
  -- no clause. Idempotency is provided above, by the activated_tenant_id early return.
  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_app.applicant_user_id, 'admin')
  RETURNING id, role INTO v_member_id, v_role;

  -- The claim is GUARDED on activated_tenant_id still being NULL, and a claim that wins no rows
  -- aborts the whole transaction — rolling back the tenant and membership created above.
  --
  -- Belt and braces on purpose. The FOR UPDATE lock already serializes concurrent activations of
  -- one application, but a guarantee that rests only on a lock is a guarantee that rests on timing.
  -- With this guard the function is correct even if the lock were removed: a loser rolls back
  -- completely and leaves no orphan tenant for a garage nobody can reach.
  UPDATE public.garage_applications
  SET activated_tenant_id = v_tenant_id,
      activated_at        = NOW(),
      updated_at          = NOW()
  WHERE id = p_application_id
    AND activated_tenant_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_ALREADY_ACTIVATED' USING ERRCODE = 'unique_violation';
  END IF;

  -- The role is returned rather than assumed, so an audit line records what the database actually
  -- wrote. An audit asserting 'admin' while the function wrote something else is a lie in the log.
  RETURN QUERY SELECT v_tenant_id, v_member_id, v_app.applicant_user_id, v_role, TRUE;
END;
$$;

COMMENT ON FUNCTION public.activate_garage_application(UUID, TEXT) IS
  'GMO-4 canonical garage activation. Atomic, serialized by FOR UPDATE, idempotent, and derived '
  'entirely from the approved application row — there is no parameter by which a caller can choose '
  'the tenant, the founder or the role. Founding role is the tenant-scoped admin (PO-1); the '
  'person''s platform role is never modified.';
