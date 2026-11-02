-- +migrate Up
-- OC-5E GMO-7 (ported from PR #209 6ea23bd8, made atomic) — who works in a garage.
--
-- Removing someone ends what they can do NEXT; it never touches what they already did (assignments and
-- service records name who did the work, not who is employed now — nothing here writes them).
--
-- #209 guarded "the last administrator" by COUNTING admins and then deleting or demoting in a second
-- call. Two administrators demoting each other at the same moment each counted two, each proceeded,
-- and the garage was left with nobody who can invite, assign or manage — a state no product path
-- restores. Here every change to a garage's memberships first locks the GARAGE'S tenant row, so
-- changes to one garage are serialized and the count is read under the lock. (Locking the membership
-- rows would not do: the two demotions touch different rows.)
--
-- The functions decide only what must be decided under the lock; who may call them (an admin of the
-- garage the person selected and the server verified) is the route's and the service's question.

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL OR to_regclass('public.tenant_users') IS NULL THEN
    RAISE EXCEPTION 'GMO-7 requires tenants and tenant_users';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.remove_garage_member(
  p_tenant_id     UUID,
  p_user_id       TEXT,
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
  -- Serialize every membership change in this garage.
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.type IS DISTINCT FROM 'garage' THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_NOT_A_GARAGE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_member FROM public.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF LOWER(v_member.role) = 'admin' THEN
    SELECT count(*) INTO v_admins FROM public.tenant_users WHERE tenant_id = p_tenant_id AND LOWER(role) = 'admin';
    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'GARAGE_MEMBERSHIP_LAST_ADMIN' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.tenant_users WHERE id = v_member.id;

  RETURN jsonb_build_object('membership_id', v_member.id, 'tenant_id', p_tenant_id, 'user_id', p_user_id,
    'previous_role', v_member.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.change_garage_member_role(
  p_tenant_id     UUID,
  p_user_id       TEXT,
  p_role          TEXT,
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
  v_role   TEXT := LOWER(BTRIM(COALESCE(p_role, '')));
  v_admins INTEGER;
BEGIN
  IF p_actor_user_id IS NULL OR BTRIM(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_ACTOR_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The two roles a garage gives (the workspace roles of the Service Network gates).
  IF v_role NOT IN ('admin', 'mechanic') THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_ROLE_INVALID:%', v_role USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.type IS DISTINCT FROM 'garage' THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_NOT_A_GARAGE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_member FROM public.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF LOWER(v_member.role) = v_role THEN
    RETURN jsonb_build_object('membership_id', v_member.id, 'changed', FALSE, 'role', v_member.role, 'previous_role', v_member.role);
  END IF;

  -- Demoting the last administrator leaves the garage unmanageable, exactly as removing them would.
  IF LOWER(v_member.role) = 'admin' THEN
    SELECT count(*) INTO v_admins FROM public.tenant_users WHERE tenant_id = p_tenant_id AND LOWER(role) = 'admin';
    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'GARAGE_MEMBERSHIP_LAST_ADMIN' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.tenant_users SET role = v_role WHERE id = v_member.id;

  RETURN jsonb_build_object('membership_id', v_member.id, 'changed', TRUE, 'role', v_role, 'previous_role', v_member.role);
END;
$$;

COMMENT ON FUNCTION public.remove_garage_member(UUID, TEXT, TEXT) IS
  'OC-5E GMO-7: remove a garage member under a lock on the garage, refusing the last administrator.';
COMMENT ON FUNCTION public.change_garage_member_role(UUID, TEXT, TEXT, TEXT) IS
  'OC-5E GMO-7: change a garage member''s role (admin|mechanic) under a lock on the garage, refusing to demote the last administrator.';

REVOKE ALL ON FUNCTION public.remove_garage_member(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_garage_member(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.change_garage_member_role(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_garage_member_role(UUID, TEXT, TEXT, TEXT) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.change_garage_member_role(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.remove_garage_member(UUID, TEXT, TEXT);
