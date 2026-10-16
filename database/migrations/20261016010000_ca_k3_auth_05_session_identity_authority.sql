-- +migrate Up
-- CA-K3-AUTH-05 — separate interactive session authority from the ordinary Supabase service_role.
--
-- SECURITY INVARIANT:
-- Possession of ordinary service_role alone must not mint, extend, reactivate, step-up,
-- enumerate bearer-token material, or execute a governed Corporate mutation as another user.
--
-- carup_session_authority is NOLOGIN. Infrastructure must create a distinct LOGIN role,
-- grant it membership in this role, and expose only that login via SESSION_AUTH_DATABASE_URL.
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
  IF to_regclass('public.auth_action_tokens') IS NULL THEN
    RAISE EXCEPTION 'CA-K3-AUTH-05 requires public.auth_action_tokens';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_sessions'
          AND column_name IN ('id','user_id','active_role','active_organization_id','token','is_valid',
                              'created_at','expires_at','auth_method','step_up_at','step_up_method')) <> 11 THEN
    RAISE EXCEPTION 'CA-K3-AUTH-05 requires the complete O2-X3 user_sessions contract';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users' AND column_name='password_hash'
  ) THEN
    RAISE EXCEPTION 'CA-K3-AUTH-05 requires public.users.password_hash';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO carup_session_authority;

-- Exact-token resolver for ordinary application reads. It never returns bearer-token material
-- and exposes no enumeration path: the presented high-entropy token is the lookup capability.
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
    'user_agent', s.user_agent
  ) END
  FROM (
    SELECT * FROM public.user_sessions
     WHERE token = p_token
       AND p_token IS NOT NULL
       AND btrim(p_token) <> ''
     LIMIT 1
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_resolve_assurance(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', s.id,
    'user_id', s.user_id,
    'is_valid', s.is_valid,
    'created_at', s.created_at,
    'expires_at', s.expires_at,
    'auth_method', s.auth_method,
    'step_up_at', s.step_up_at,
    'step_up_method', s.step_up_method
  ) END
  FROM (
    SELECT * FROM public.user_sessions
     WHERE token = p_token
       AND p_token IS NOT NULL
       AND btrim(p_token) <> ''
     LIMIT 1
  ) s;
$$;

-- Display-only inventory. Token values are never returned.
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

-- Session issuance is server-clocked and database-tokened. Only the dedicated authority may call it.
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
  IF p_user_id IS NULL OR btrim(p_user_id) = ''
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/USER_INVALID';
  END IF;
  IF p_active_role IS NULL OR btrim(p_active_role) = '' THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/ACTIVE_ROLE_INVALID';
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

  RETURN jsonb_build_object(
    'id',v_id,'token',v_token,'user_id',p_user_id,
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
  SELECT id, active_organization_id
    INTO v_id, v_previous
    FROM public.user_sessions
   WHERE token = p_token
     AND user_id = p_user_id
     AND is_valid = true
     AND expires_at::timestamptz > clock_timestamp()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/SESSION_INVALID';
  END IF;

  UPDATE public.user_sessions
     SET active_organization_id = p_active_organization_id
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'id',v_id,
    'previous_active_organization_id',v_previous,
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
     SET is_valid = false
   WHERE token = p_token
     AND user_id = p_user_id
     AND is_valid = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('revoked_count',v_count);
END;
$$;

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
  IF p_scope = 'one' AND (p_session_id IS NULL OR btrim(p_session_id) = '') THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/SESSION_ID_REQUIRED';
  END IF;
  IF p_scope = 'others' AND (p_presenting_token IS NULL OR btrim(p_presenting_token) = '') THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/PRESENTING_TOKEN_REQUIRED';
  END IF;

  WITH targets AS (
    SELECT id
      FROM public.user_sessions
     WHERE user_id = p_user_id
       AND is_valid = true
       AND (
         p_scope = 'all'
         OR (p_scope = 'one' AND id = p_session_id)
         OR (p_scope = 'others' AND token IS DISTINCT FROM p_presenting_token)
       )
     FOR UPDATE
  ), changed AS (
    UPDATE public.user_sessions s
       SET is_valid = false
      FROM targets t
     WHERE s.id = t.id
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
     SET step_up_at = v_stamp::text,
         step_up_method = 'password_reauth'
   WHERE token = p_token
     AND user_id = p_user_id
     AND is_valid = true
     AND expires_at::timestamptz > v_stamp
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/SESSION_INVALID';
  END IF;

  RETURN jsonb_build_object(
    'id',v_id,'step_up_at',v_stamp,'method','password_reauth');
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
     SET step_up_at = NULL,
         step_up_method = NULL
   WHERE id = p_session_id
     AND step_up_at = p_expected_step_up_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('cleared_count',v_count);
END;
$$;

-- Password reset is part of the same independent authentication authority. If service_role could
-- replace a governor's password_hash it could ask the legitimate issuer to create the impersonated session.
CREATE OR REPLACE FUNCTION public.session_authority_set_password_hash(
  p_user_id text,
  p_password_hash text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/USER_INVALID';
  END IF;
  IF p_password_hash IS NULL
     OR p_password_hash !~ '^scrypt:[0-9a-f]+:[0-9a-f]+$' THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/PASSWORD_HASH_INVALID';
  END IF;

  UPDATE public.users
     SET password_hash = p_password_hash
   WHERE id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/USER_INVALID';
  END IF;

  RETURN jsonb_build_object('updated',true,'user_id',p_user_id);
END;
$$;

-- Registration compensation may remove only a just-created account with no session or Corporate membership.
CREATE OR REPLACE FUNCTION public.session_authority_delete_unestablished_user(
  p_user_id text,
  p_expected_email text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = ''
     OR p_expected_email IS NULL OR btrim(p_expected_email) = '' THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/USER_INVALID';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_sessions WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.corporate_memberships WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/ESTABLISHED_USER_DELETE_DENIED';
  END IF;

  DELETE FROM public.users
   WHERE id = p_user_id
     AND lower(email) = lower(p_expected_email);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('deleted_count',v_count);
END;
$$;

-- Auth-action tokens are credential-proof state. Ordinary service_role may not manufacture them.
CREATE OR REPLACE FUNCTION public.session_authority_auth_token_insert(
  p_user_id text,
  p_purpose text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_requested_ip text,
  p_user_agent text,
  p_metadata jsonb,
  p_created_by text,
  p_source text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.auth_action_tokens%ROWTYPE;
BEGIN
  IF p_purpose NOT IN ('password_reset','email_verification','email_change','reauthentication')
     OR p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL
     OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '7 days' THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/AUTH_TOKEN_INVALID';
  END IF;

  UPDATE public.auth_action_tokens
     SET revoked_at = clock_timestamp()
   WHERE user_id = p_user_id
     AND purpose = p_purpose
     AND used_at IS NULL
     AND revoked_at IS NULL;

  INSERT INTO public.auth_action_tokens
    (user_id,purpose,token_hash,expires_at,requested_ip,user_agent,metadata,created_by,source)
  VALUES
    (p_user_id,p_purpose,p_token_hash,p_expires_at,p_requested_ip,p_user_agent,
     COALESCE(p_metadata,'{}'::jsonb),p_created_by,COALESCE(NULLIF(p_source,''),'api'))
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id',v_row.id,
    'user_id',v_row.user_id,
    'purpose',v_row.purpose,
    'expires_at',v_row.expires_at,
    'created_at',v_row.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_auth_token_consume(
  p_token_hash text,
  p_purpose text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.auth_action_tokens%ROWTYPE;
  v_existing public.auth_action_tokens%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_purpose NOT IN ('password_reset','email_verification','email_change','reauthentication') THEN
    RETURN jsonb_build_object('ok',false,'reason','malformed_token');
  END IF;

  UPDATE public.auth_action_tokens
     SET used_at = clock_timestamp()
   WHERE token_hash = p_token_hash
     AND purpose = p_purpose
     AND used_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp()
   RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',true,
      'token',jsonb_build_object(
        'id',v_row.id,
        'user_id',v_row.user_id,
        'purpose',v_row.purpose,
        'metadata',v_row.metadata,
        'expires_at',v_row.expires_at,
        'created_at',v_row.created_at));
  END IF;

  SELECT * INTO v_existing
    FROM public.auth_action_tokens
   WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','unknown_token');
  END IF;
  IF v_existing.purpose IS DISTINCT FROM p_purpose THEN
    RETURN jsonb_build_object('ok',false,'reason','wrong_purpose');
  END IF;
  IF v_existing.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','revoked');
  END IF;
  IF v_existing.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','already_used');
  END IF;
  RETURN jsonb_build_object('ok',false,'reason','expired');
END;
$$;

CREATE OR REPLACE FUNCTION public.session_authority_auth_token_revoke(
  p_user_id text,
  p_purpose text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.auth_action_tokens
     SET revoked_at = clock_timestamp()
   WHERE user_id = p_user_id
     AND (p_purpose IS NULL OR purpose = p_purpose)
     AND used_at IS NULL
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('revoked_count',v_count);
END;
$$;

-- Cutover containment: sessions minted before this boundary cannot be distinguished cryptographically
-- from legitimate sessions. Invalidate them once so forged legacy state cannot survive the cutover.
UPDATE public.user_sessions
   SET is_valid = false,
       step_up_at = NULL,
       step_up_method = NULL
 WHERE is_valid = true
    OR step_up_at IS NOT NULL
    OR step_up_method IS NOT NULL;

-- BYPASSRLS is irrelevant once ordinary service_role has no table privilege.
REVOKE ALL ON TABLE public.user_sessions
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

-- Protect credential state that feeds the legitimate issuer. Preserve non-credential profile updates
-- through explicit column grants while excluding immutable identity and password material.
REVOKE UPDATE, DELETE ON TABLE public.users FROM PUBLIC, service_role;
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'users'
     AND column_name NOT IN ('id','email','password_hash');

  IF v_cols IS NOT NULL THEN
    EXECUTE 'GRANT UPDATE (' || v_cols || ') ON TABLE public.users TO service_role';
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.auth_action_tokens
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

-- New functions default to PUBLIC EXECUTE in PostgreSQL. Revoke first, then grant only the required boundaries.
REVOKE ALL ON FUNCTION public.session_authority_resolve_token(text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_resolve_assurance(text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_list_user_sessions(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_issue(text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_set_active_organization(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_current(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_scope(text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_record_password_reauth(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_clear_password_reauth(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_set_password_hash(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_delete_unestablished_user(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_auth_token_insert(text,text,text,timestamptz,text,text,jsonb,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_auth_token_consume(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_auth_token_revoke(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

-- Ordinary runtime can validate an exact bearer token but cannot enumerate token material or mutate session state.
GRANT EXECUTE ON FUNCTION public.session_authority_resolve_token(text)
  TO service_role, carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_resolve_assurance(text)
  TO service_role, carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_list_user_sessions(text,text)
  TO service_role, carup_session_authority;

-- Only the independently-held session authority can mutate session/credential proof state.
GRANT EXECUTE ON FUNCTION public.session_authority_issue(text,text,text,text,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_set_active_organization(text,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_revoke_current(text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_revoke_scope(text,text,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_record_password_reauth(text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_clear_password_reauth(text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_set_password_hash(text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_delete_unestablished_user(text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_auth_token_insert(text,text,text,timestamptz,text,text,jsonb,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_auth_token_consume(text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_auth_token_revoke(text,text)
  TO carup_session_authority;

-- Direct invocation of a Phase-C write wrapper with a stolen actor/session id is also impersonation.
-- Move only EXECUTE custody; the accepted Phase-C migration and authority semantics remain byte-identical.
REVOKE EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_submit(text,uuid,text,text,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid,text,text,text,text,text,uuid,text,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid,text,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid,text,text,text)
  FROM service_role;

GRANT EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_submit(text,uuid,text,text,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid,text,text,text,text,text,uuid,text,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid,text,text,text)
  TO carup_session_authority;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid,text,text,text)
  TO carup_session_authority;

-- +migrate Down
-- Restore the pre-AUTH-05 privilege posture. The NOLOGIN role is retained because an
-- infrastructure-created runtime LOGIN may hold membership in it.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_sessions TO service_role;
GRANT UPDATE, DELETE ON TABLE public.users TO service_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.auth_action_tokens TO service_role;

GRANT EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_submit(text,uuid,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid,text,text,text,text,text,uuid,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid,text,text,text)
  TO service_role;

REVOKE ALL ON FUNCTION public.session_authority_auth_token_revoke(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_auth_token_consume(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_auth_token_insert(text,text,text,timestamptz,text,text,jsonb,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_delete_unestablished_user(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_set_password_hash(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_clear_password_reauth(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_record_password_reauth(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_scope(text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_revoke_current(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_set_active_organization(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_issue(text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_list_user_sessions(text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_resolve_assurance(text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
REVOKE ALL ON FUNCTION public.session_authority_resolve_token(text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;

DROP FUNCTION IF EXISTS public.session_authority_auth_token_revoke(text,text);
DROP FUNCTION IF EXISTS public.session_authority_auth_token_consume(text,text);
DROP FUNCTION IF EXISTS public.session_authority_auth_token_insert(text,text,text,timestamptz,text,text,jsonb,text,text);
DROP FUNCTION IF EXISTS public.session_authority_delete_unestablished_user(text,text);
DROP FUNCTION IF EXISTS public.session_authority_set_password_hash(text,text);
DROP FUNCTION IF EXISTS public.session_authority_clear_password_reauth(text,text);
DROP FUNCTION IF EXISTS public.session_authority_record_password_reauth(text,text);
DROP FUNCTION IF EXISTS public.session_authority_revoke_scope(text,text,text,text);
DROP FUNCTION IF EXISTS public.session_authority_revoke_current(text,text);
DROP FUNCTION IF EXISTS public.session_authority_set_active_organization(text,text,text);
DROP FUNCTION IF EXISTS public.session_authority_issue(text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.session_authority_list_user_sessions(text,text);
DROP FUNCTION IF EXISTS public.session_authority_resolve_assurance(text);
DROP FUNCTION IF EXISTS public.session_authority_resolve_token(text);

REVOKE USAGE ON SCHEMA public FROM carup_session_authority;
