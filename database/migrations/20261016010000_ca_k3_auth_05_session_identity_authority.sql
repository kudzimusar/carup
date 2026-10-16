-- +migrate Up
-- CA-K3-AUTH-05 — separate interactive session authority from the ordinary Supabase service_role.
--
-- SECURITY INVARIANT:
-- Possession of the ordinary service_role credential alone must not be enough to mint, extend,
-- reactivate, step-up, enumerate bearer tokens, or directly exercise a governed Corporate mutation
-- as another interactive user.
--
-- carup_session_authority is deliberately NOLOGIN. Infrastructure creates a distinct LOGIN role,
-- grants it membership in this role, and supplies only that login through SESSION_AUTH_DATABASE_URL.
-- No password/connection string is stored in this migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carup_session_authority') THEN
    CREATE ROLE carup_session_authority NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_sessions') IS NULL THEN
    RAISE EXCEPTION 'CA-K3-AUTH-05 requires public.user_sessions';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_sessions'
          AND column_name IN ('id','user_id','active_role','active_organization_id','token','is_valid',
                              'created_at','expires_at','auth_method','step_up_at','step_up_method')) <> 11 THEN
    RAISE EXCEPTION 'CA-K3-AUTH-05 requires the complete O2-X3 user_sessions contract';
  END IF;
END $$;

-- Exact-token resolver for ordinary application reads. It never returns bearer-token material and
-- offers no enumeration surface; knowing a high-entropy token is the lookup capability.
CREATE OR REPLACE FUNCTION public.session_authority_resolve_token(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', s.id,
    'user_id', s.user_id,
    'active_role', s.active_role,
    'active_organization_id', s.active_organization_id,
    'is_valid', s.is_valid,
    'created_at', s.created_at,
    'expires_at', s.expires_at,
    'auth_method', s.auth_method,
    'step_up_at', s.step_up_at,
    'step_up_method', s.step_up_method,
    'user_agent', s.user_agent
  ) END
  FROM (SELECT * FROM public.user_sessions
         WHERE token = p_token AND p_token IS NOT NULL AND btrim(p_token) <> ''
         LIMIT 1) s;
$$;

-- Display-only session inventory. Token values never leave the function.
CREATE OR REPLACE FUNCTION public.session_authority_list_user_sessions(
  p_user_id text,
  p_presenting_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'created_at', s.created_at,
    'expires_at', s.expires_at,
    'is_valid', s.is_valid,
    'user_agent', s.user_agent,
    'current', (p_presenting_token IS NOT NULL AND s.token = p_presenting_token)
  ) ORDER BY s.created_at DESC), '[]'::jsonb)
  FROM public.user_sessions s
  WHERE s.user_id = p_user_id;
$$;

-- Session issuance is server-clocked and database-tokened. The application supplies the already
-- authenticated user identity; only the dedicated session authority may call this function.
CREATE OR REPLACE FUNCTION public.session_authority_issue(
  p_user_id text,
  p_active_role text,
  p_active_organization_id text,
  p_ip_address text,
  p_user_agent text,
  p_auth_method text DEFAULT 'password')
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_token text := 'sk_live_' || replace(gen_random_uuid()::text, '-', '');
  v_created timestamptz := clock_timestamp();
  v_expires timestamptz := clock_timestamp() + interval '24 hours';
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/USER_INVALID';
  END IF;
  IF p_auth_method NOT IN ('password','session_switch') THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/AUTH_METHOD_INVALID';
  END IF;

  INSERT INTO public.user_sessions
    (id,user_id,active_role,active_organization_id,token,is_valid,ip_address,user_agent,
     created_at,expires_at,auth_method,step_up_at,step_up_method)
  VALUES
    (v_id,p_user_id,p_active_role,p_active_organization_id,v_token,true,p_ip_address,p_user_agent,
     v_created::text,v_expires::text,p_auth_method,NULL,NULL);

  RETURN jsonb_build_object('id',v_id,'token',v_token,'user_id',p_user_id,
                            'created_at',v_created,'expires_at',v_expires);
END;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_set_active_organization(
  p_token text,
  p_user_id text,
  p_active_organization_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id text;
  v_previous text;
BEGIN
  SELECT id, active_organization_id INTO v_id, v_previous
    FROM public.user_sessions
   WHERE token=p_token AND user_id=p_user_id AND is_valid=true
     AND expires_at::timestamptz > clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_AUTHORITY/SESSION_INVALID'; END IF;

  UPDATE public.user_sessions SET active_organization_id=p_active_organization_id WHERE id=v_id;
  RETURN jsonb_build_object('id',v_id,'previous_active_organization_id',v_previous,
                            'active_organization_id',p_active_organization_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_revoke_current(
  p_token text,
  p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.user_sessions
     SET is_valid=false
   WHERE token=p_token AND user_id=p_user_id AND is_valid=true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('revoked_count',v_count);
END;
$$;

-- The application decides the authorized scope first. The database performs only the bounded
-- lifecycle mutation and never returns bearer tokens.
CREATE OR REPLACE FUNCTION public.session_authority_revoke_scope(
  p_user_id text,
  p_scope text,
  p_session_id text DEFAULT NULL,
  p_presenting_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids text[];
BEGIN
  IF p_scope NOT IN ('all','others','one') THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/SCOPE_INVALID';
  END IF;
  IF p_scope='one' AND (p_session_id IS NULL OR btrim(p_session_id)='') THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/SESSION_ID_REQUIRED';
  END IF;
  IF p_scope='others' AND (p_presenting_token IS NULL OR btrim(p_presenting_token)='') THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/PRESENTING_TOKEN_REQUIRED';
  END IF;

  WITH targets AS (
    SELECT id FROM public.user_sessions
     WHERE user_id=p_user_id AND is_valid=true
       AND (p_scope='all'
         OR (p_scope='one' AND id=p_session_id)
         OR (p_scope='others' AND token IS DISTINCT FROM p_presenting_token))
     FOR UPDATE
  ), changed AS (
    UPDATE public.user_sessions s
       SET is_valid=false
      FROM targets t
     WHERE s.id=t.id
     RETURNING s.id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM changed;

  RETURN jsonb_build_object(
    'revoked_count',COALESCE(cardinality(v_ids),0),
    'revoked_session_ids',COALESCE(to_jsonb(v_ids),'[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_record_password_reauth(
  p_token text,
  p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id text;
  v_stamp timestamptz := clock_timestamp();
BEGIN
  UPDATE public.user_sessions
     SET step_up_at=v_stamp::text, step_up_method='password_reauth'
   WHERE token=p_token AND user_id=p_user_id AND is_valid=true
     AND expires_at::timestamptz > v_stamp
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'SESSION_AUTHORITY/SESSION_INVALID'; END IF;
  RETURN jsonb_build_object('id',v_id,'step_up_at',v_stamp,'method','password_reauth');
END;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_clear_password_reauth(
  p_session_id text,
  p_expected_step_up_at text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.user_sessions
     SET step_up_at=NULL, step_up_method=NULL
   WHERE id=p_session_id AND step_up_at=p_expected_step_up_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('cleared_count',v_count);
END;
$$;

-- BYPASSRLS is irrelevant once table privileges are removed. Ordinary service_role can resolve an
-- already-presented token and list display metadata, but cannot read token material or mutate rows.
REVOKE ALL ON TABLE public.user_sessions FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

REVOKE ALL ON FUNCTION public.session_authority_resolve_token(text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_list_user_sessions(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_issue(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_set_active_organization(text,text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_current(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_scope(text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_record_password_reauth(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_clear_password_reauth(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

GRANT EXECUTE ON FUNCTION public.session_authority_resolve_token(text) TO service_role, carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_list_user_sessions(text,text) TO service_role, carup_session_authority;

GRANT EXECUTE ON FUNCTION public.session_authority_issue(text,text,text,text,text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_set_active_organization(text,text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_revoke_current(text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_revoke_scope(text,text,text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_record_password_reauth(text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_clear_password_reauth(text,text) TO carup_session_authority;

-- Direct invocation of a Phase-C write wrapper with a stolen actor/session id would still be
-- impersonation even if session-table DML were closed. Move those five mutation entry points to the
-- same independently-held session authority. The accepted Phase-C migration itself remains untouched.
REVOKE EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_submit(text,uuid,text,text,text,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid,text,text,text,text,text,uuid,text,text,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid,text,text,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid,text,text,text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_submit(text,uuid,text,text,text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid,text,text,text,text,text,uuid,text,text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid,text,text,text) TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid,text,text,text) TO carup_session_authority;

-- +migrate Down
-- Restore the pre-AUTH-05 service-role posture. This rollback intentionally does not DROP the
-- NOLOGIN group role because an infrastructure-created runtime LOGIN may be a member of it.
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.user_sessions TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_submit(text,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid,text,text,text,text,text,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.session_authority_clear_password_reauth(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_record_password_reauth(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_scope(text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_current(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_set_active_organization(text,text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_issue(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_list_user_sessions(text,text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_resolve_token(text) FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

DROP FUNCTION IF EXISTS public.session_authority_clear_password_reauth(text,text);
DROP FUNCTION IF EXISTS public.session_authority_record_password_reauth(text,text);
DROP FUNCTION IF EXISTS public.session_authority_revoke_scope(text,text,text,text);
DROP FUNCTION IF EXISTS public.session_authority_revoke_current(text,text);
DROP FUNCTION IF EXISTS public.session_authority_set_active_organization(text,text,text);
DROP FUNCTION IF EXISTS public.session_authority_issue(text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.session_authority_list_user_sessions(text,text);
DROP FUNCTION IF EXISTS public.session_authority_resolve_token(text);
