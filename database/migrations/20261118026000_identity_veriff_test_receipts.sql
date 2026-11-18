-- O2-X4 test transport bindings. Identity authority remains with review.
CREATE TABLE IF NOT EXISTS public.identity_veriff_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.verification_sessions(id),
  request_id uuid NOT NULL,
  consent_id uuid NOT NULL REFERENCES public.identity_biometric_consents(id),
  evidence_revision integer NOT NULL CHECK (evidence_revision > 0),
  purpose text NOT NULL CHECK (purpose IN ('face_document_match','liveness')),
  provider_session uuid UNIQUE,
  provider_attempt uuid,
  decision_status text CHECK (decision_status IN ('approved','declined','resubmission_requested','expired','abandoned','review')),
  decision_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (statement_timestamp() + interval '15 minutes'),
  UNIQUE (session_id, request_id),
  CHECK ((decision_status IS NULL AND provider_attempt IS NULL AND decision_at IS NULL) OR
         (provider_session IS NOT NULL AND decision_status IS NOT NULL AND provider_attempt IS NOT NULL AND decision_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS identity_veriff_test_attempt_scope_idx ON public.identity_veriff_test_attempts
  (session_id, consent_id, evidence_revision, purpose, expires_at);
ALTER TABLE public.identity_veriff_test_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_veriff_test_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.identity_veriff_test_attempts TO service_role;
GRANT UPDATE (provider_session, provider_attempt, decision_status, decision_at)
  ON public.identity_veriff_test_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.identity_veriff_test_registration(
  p_session uuid, p_user text, p_request uuid, p_operation text, p_revision integer,
  p_purpose text, p_provider_session uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  s public.verification_sessions%ROWTYPE;
  c public.identity_biometric_consents%ROWTYPE;
  a public.identity_veriff_test_attempts%ROWTYPE;
  registered boolean := false;
BEGIN
  SELECT * INTO s FROM public.verification_sessions WHERE id=p_session AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  SELECT * INTO c FROM public.identity_biometric_consents
    WHERE session_id=s.id AND user_id=p_user ORDER BY sequence_id DESC LIMIT 1;
  SELECT * INTO a FROM public.identity_veriff_test_attempts WHERE session_id=s.id AND request_id=p_request;
  IF NOT FOUND AND p_operation IS DISTINCT FROM 'start' THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  IF s.status NOT IN ('pending_manual_review','ocr_failed') OR s.front_storage_path IS NULL
     OR s.selfie_storage_path IS NULL OR (s.double_sided AND s.back_storage_path IS NULL)
     OR c.status IS DISTINCT FROM 'granted'
     OR (a.id IS NOT NULL AND (a.consent_id <> c.id OR a.evidence_revision <> s.version
       OR a.expires_at <= statement_timestamp() OR NOT a.purpose = ANY(c.purposes))) THEN
    RETURN jsonb_build_object('code','CONFLICT');
  END IF;

  IF p_operation = 'start' THEN
    IF p_request IS NULL OR p_revision IS DISTINCT FROM s.version OR p_purpose IS NULL
       OR NOT p_purpose = ANY(c.purposes) OR (a.id IS NOT NULL AND a.purpose <> p_purpose) THEN
      RETURN jsonb_build_object('code','CONFLICT');
    END IF;
    IF a.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.identity_veriff_test_attempts
          WHERE session_id=s.id AND consent_id=c.id AND evidence_revision=s.version AND purpose=p_purpose
            AND expires_at > statement_timestamp()) THEN RETURN jsonb_build_object('code','CONFLICT'); END IF;
      INSERT INTO public.identity_veriff_test_attempts (session_id,request_id,consent_id,evidence_revision,purpose)
        VALUES (s.id,p_request,c.id,s.version,p_purpose) RETURNING * INTO a;
      registered := true;
    END IF;
  ELSIF p_operation = 'bind' THEN
    IF p_provider_session IS NULL OR (a.provider_session IS NOT NULL AND a.provider_session <> p_provider_session)
      THEN RETURN jsonb_build_object('code','CONFLICT'); END IF;
    IF a.provider_session IS NULL THEN
      UPDATE public.identity_veriff_test_attempts SET provider_session=p_provider_session WHERE id=a.id RETURNING * INTO a;
    END IF;
  ELSIF p_operation IS DISTINCT FROM 'read' THEN
    RETURN jsonb_build_object('code','CONFLICT');
  END IF;

  RETURN jsonb_build_object('code','OK','registered',registered,'binding',a.id,
    'provider_session',a.provider_session,'purpose',a.purpose,'expires_at',a.expires_at,'decision_status',a.decision_status);
END;
$$;
REVOKE ALL ON FUNCTION public.identity_veriff_test_registration(uuid,text,uuid,text,integer,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_veriff_test_registration(uuid,text,uuid,text,integer,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_identity_veriff_test_decision(
  p_binding uuid, p_provider_session uuid, p_provider_attempt uuid, p_status text, p_decision_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  a public.identity_veriff_test_attempts%ROWTYPE;
  s public.verification_sessions%ROWTYPE;
  c public.identity_biometric_consents%ROWTYPE;
  outcome_terminal boolean;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('approved','declined','resubmission_requested','expired','abandoned','review')
     OR p_provider_attempt IS NULL OR p_decision_at IS NULL THEN RETURN jsonb_build_object('code','INVALID'); END IF;
  SELECT * INTO a FROM public.identity_veriff_test_attempts WHERE id=p_binding AND provider_session=p_provider_session;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','IGNORED'); END IF;
  SELECT * INTO s FROM public.verification_sessions WHERE id=a.session_id FOR UPDATE;
  SELECT * INTO a FROM public.identity_veriff_test_attempts WHERE id=p_binding AND provider_session=p_provider_session;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','IGNORED'); END IF;
  SELECT * INTO c FROM public.identity_biometric_consents
    WHERE session_id=s.id AND user_id=s.user_id ORDER BY sequence_id DESC LIMIT 1;
  IF s.status NOT IN ('pending_manual_review','ocr_failed') OR s.version <> a.evidence_revision
      OR c.status IS DISTINCT FROM 'granted' OR c.id IS DISTINCT FROM a.consent_id OR NOT a.purpose = ANY(c.purposes)
      OR a.expires_at <= statement_timestamp() OR p_decision_at >= a.expires_at
      OR p_decision_at < a.created_at - interval '30 seconds' OR p_decision_at > statement_timestamp() + interval '30 seconds' THEN
    RETURN jsonb_build_object('code','IGNORED');
  END IF;

  IF a.decision_status=p_status AND a.provider_attempt=p_provider_attempt AND a.decision_at=p_decision_at THEN
    RETURN jsonb_build_object('code','DUPLICATE');
  END IF;
  IF a.decision_status IN ('approved','declined','expired','abandoned') OR p_decision_at <= a.decision_at THEN
    RETURN jsonb_build_object('code','IGNORED');
  END IF;

  UPDATE public.identity_veriff_test_attempts SET provider_attempt=p_provider_attempt, decision_status=p_status,
    decision_at=p_decision_at WHERE id=a.id;
  outcome_terminal := p_status IN ('approved','declined','expired','abandoned');
  IF outcome_terminal THEN
    INSERT INTO public.verification_assessments(session_id,assessment_source,biometric_consent_id,
      biometric_request_id,biometric_purpose,biometric_evidence_revision,face_match_status,liveness_status,provider_state,provider)
      VALUES(s.id,'veriff_test_simulated',c.id,a.id,a.purpose,s.version,'not_run','not_run','veriff_test_simulated','veriff');
  END IF;
  INSERT INTO public.trust_audit_events(event_type,actor_role,actor_type,source_route,new_value)
    VALUES ('VERIFICATION_BIOMETRIC_TEST_SIMULATION_RECORDED','system','system','identity/veriff-test',
      jsonb_build_object('session_id',s.id,'test_attempt_id',a.id,'purpose',a.purpose,'test_status',p_status,
        'provenance','TEST_SIMULATED'));
  RETURN jsonb_build_object('code','RECORDED');
END;
$$;
REVOKE ALL ON FUNCTION public.record_identity_veriff_test_decision(uuid,uuid,uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_identity_veriff_test_decision(uuid,uuid,uuid,text,timestamptz) TO service_role;
