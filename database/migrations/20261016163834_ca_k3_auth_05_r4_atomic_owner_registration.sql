-- +migrate Up
-- R4-R1: one statement/transaction establishes the public Owner, profile and initial session.
-- Apply transactionally, as with all CarUp migrations. No accepted AUTH-05 function is replaced.
CREATE FUNCTION public.session_authority_register_owner(
  p_user jsonb, p_profile jsonb, p_ip_address text, p_user_agent text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text := 'u_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_user jsonb;
  v_session jsonb;
  v_profile public.user_registration_profiles%ROWTYPE;
BEGIN
  IF p_user IS NULL OR jsonb_typeof(p_user) <> 'object'
     OR COALESCE(p_user->>'role', '') <> 'owner'
     OR COALESCE(btrim(p_user->>'name'), '') = ''
     OR COALESCE(btrim(p_user->>'email'), '') = ''
     OR COALESCE(p_user->>'password_hash', '') !~ '^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$' THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/REGISTRATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- IDs, timestamps, roles and session assurance are never caller-controlled.
  INSERT INTO public.users (id, name, email, phone, location, role, password_hash, join_date)
  VALUES (v_id, btrim(p_user->>'name'), btrim(p_user->>'email'),
          COALESCE(p_user->>'phone', ''), p_user->>'location', 'owner',
          p_user->>'password_hash', clock_timestamp())
  RETURNING jsonb_build_object('id', id, 'name', name, 'email', email,
                              'phone', phone, 'location', location, 'role', role) INTO v_user;

  IF p_profile IS NOT NULL AND p_profile <> 'null'::jsonb THEN
    IF jsonb_typeof(p_profile) <> 'object' THEN
      RAISE EXCEPTION 'SESSION_AUTHORITY/REGISTRATION_PROFILE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_profile FROM jsonb_populate_record(NULL::public.user_registration_profiles, p_profile);
    IF COALESCE(btrim(v_profile.country_of_residence), '') = ''
       OR COALESCE(btrim(v_profile.city), '') = ''
       OR v_profile.terms_acknowledged_at IS NULL
       OR v_profile.privacy_acknowledged_at IS NULL
       OR (v_profile.account_kind = 'business' AND
           (COALESCE(btrim(v_profile.organization_name), '') = '' OR
            v_profile.onboarding_status IS DISTINCT FROM 'requested')) THEN
      RAISE EXCEPTION 'SESSION_AUTHORITY/REGISTRATION_PROFILE_INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.user_registration_profiles
      (user_id, account_kind, market_relationship, country_of_residence, city, province,
       intended_use, organization_name, business_type, onboarding_status, marketing_consent,
       terms_acknowledged_at, privacy_acknowledged_at)
    VALUES
      (v_id, v_profile.account_kind, v_profile.market_relationship, v_profile.country_of_residence,
       v_profile.city, v_profile.province, v_profile.intended_use, v_profile.organization_name,
       v_profile.business_type, v_profile.onboarding_status, COALESCE(v_profile.marketing_consent, false),
       v_profile.terms_acknowledged_at, v_profile.privacy_acknowledged_at);
  END IF;

  v_session := public.session_authority_issue(v_id, 'owner', NULL, p_ip_address, p_user_agent, 'password');
  IF v_session->>'token' IS NULL OR v_session->>'user_id' IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'SESSION_AUTHORITY/REGISTRATION_SESSION_INVALID';
  END IF;
  RETURN jsonb_build_object('user', v_user, 'token', v_session->>'token');
  -- No exception handler: any failure rolls back user, profile AND session together.
END;
$$;

-- Remove Supabase default function grants before granting the sole runtime executor.
REVOKE ALL ON FUNCTION public.session_authority_register_owner(jsonb,jsonb,text,text)
  FROM PUBLIC, anon, authenticated, service_role, carup_session_authority;
GRANT EXECUTE ON FUNCTION public.session_authority_register_owner(jsonb,jsonb,text,text)
  TO carup_session_authority;

-- +migrate Down
DROP FUNCTION public.session_authority_register_owner(jsonb,jsonb,text,text);
