-- O2-X4 continuation. Store receipts and unavailable status only. No media,
-- templates, scores or provider result writes are part of this migration.
DO $$
BEGIN
  IF to_regclass('public.identity_biometric_consents') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_biometric_consents' AND column_name = 'sequence_id'
  ) THEN
    RAISE EXCEPTION 'Historical O2-X4 biometric consent ledger requires a governed reconciliation first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.identity_biometric_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  session_id uuid NOT NULL REFERENCES public.verification_sessions(id),
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('granted','withdrawn')),
  purposes text[] NOT NULL,
  policy_version text NOT NULL,
  consent_text_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, request_id)
);
ALTER TABLE public.identity_biometric_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_biometric_consents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.identity_biometric_consents TO service_role;

ALTER TABLE public.verification_assessments
  ADD COLUMN IF NOT EXISTS biometric_consent_id uuid REFERENCES public.identity_biometric_consents(id),
  ADD COLUMN IF NOT EXISTS biometric_request_id uuid,
  ADD COLUMN IF NOT EXISTS biometric_purpose text,
  ADD COLUMN IF NOT EXISTS biometric_evidence_revision integer,
  ADD COLUMN IF NOT EXISTS face_match_status text,
  ADD COLUMN IF NOT EXISTS liveness_status text,
  ADD COLUMN IF NOT EXISTS provider_state text;
CREATE UNIQUE INDEX IF NOT EXISTS verification_biometric_request_unique
  ON public.verification_assessments(session_id, biometric_request_id)
  WHERE biometric_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_identity_biometric_contract(
  p_session uuid, p_user text, p_operation text, p_request uuid,
  p_revision integer, p_purposes text[], p_notice text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  s public.verification_sessions%ROWTYPE;
  consent public.identity_biometric_consents%ROWTYPE;
  receipt public.identity_biometric_consents%ROWTYPE;
  assessment public.verification_assessments%ROWTYPE;
  normalized text[];
BEGIN
  SELECT * INTO s FROM public.verification_sessions
    WHERE id = p_session AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;

  SELECT * INTO consent FROM public.identity_biometric_consents
    WHERE session_id = s.id AND user_id = p_user ORDER BY sequence_id DESC LIMIT 1;
  IF p_operation = 'state' THEN
    RETURN jsonb_build_object('code','OK','status',COALESCE(consent.status,'not_granted'),
      'purposes',COALESCE(consent.purposes,ARRAY[]::text[]),'notice','biometric_consent_text.v1');
  END IF;

  IF p_request IS NULL THEN RETURN jsonb_build_object('code','INVALID'); END IF;
  IF p_operation IN ('grant','withdraw') THEN
    normalized := ARRAY(SELECT DISTINCT purpose FROM unnest(p_purposes) AS p(purpose) ORDER BY purpose);
    IF (p_operation = 'grant' AND (p_notice IS DISTINCT FROM 'biometric_consent_text.v1'
         OR cardinality(normalized) = 0 OR array_position(normalized,NULL) IS NOT NULL
         OR NOT normalized <@ ARRAY['face_document_match','liveness']))
       OR (p_operation = 'withdraw' AND cardinality(normalized) <> 0) THEN
      RETURN jsonb_build_object('code','INVALID');
    END IF;
    SELECT * INTO receipt FROM public.identity_biometric_consents
      WHERE session_id = s.id AND request_id = p_request;
    IF FOUND THEN
      IF receipt.status <> (CASE WHEN p_operation = 'grant' THEN 'granted' ELSE 'withdrawn' END)
        OR (p_operation = 'grant' AND receipt.purposes <> normalized) THEN
        RETURN jsonb_build_object('code','CONFLICT');
      END IF;
      RETURN jsonb_build_object('code','OK','status',consent.status,'purposes',consent.purposes,'replayed',true);
    END IF;
    IF p_revision IS DISTINCT FROM s.version OR
      (p_operation = 'grant' AND s.status IN ('verified','rejected')) THEN
      RETURN jsonb_build_object('code','CONFLICT');
    END IF;
    IF p_operation = 'withdraw' THEN
      IF consent.status IS DISTINCT FROM 'granted' THEN RETURN jsonb_build_object('code','CONFLICT'); END IF;
      normalized := consent.purposes;
    END IF;
    INSERT INTO public.identity_biometric_consents
      (session_id,user_id,request_id,status,purposes,policy_version,consent_text_version)
    VALUES (s.id,p_user,p_request,CASE WHEN p_operation = 'grant' THEN 'granted' ELSE 'withdrawn' END,
      normalized,'biometric_consent.v1','biometric_consent_text.v1') RETURNING * INTO receipt;
    INSERT INTO public.trust_audit_events(event_type,actor_user_id,actor_role,actor_type,source_route,new_value)
      VALUES ('VERIFICATION_BIOMETRIC_CONSENT_CHANGED',p_user,'applicant','user','identity/biometric-contract',
        jsonb_build_object('session_id',s.id,'consent_id',receipt.id,'status',receipt.status));
    RETURN jsonb_build_object('code','OK','status',receipt.status,'purposes',receipt.purposes,'replayed',false);
  END IF;

  IF p_operation IS DISTINCT FROM 'assess' OR cardinality(p_purposes) IS DISTINCT FROM 1
    OR p_purposes[1] IS NULL THEN RETURN jsonb_build_object('code','INVALID'); END IF;
  IF p_revision IS DISTINCT FROM s.version OR s.status NOT IN ('pending_manual_review','ocr_failed')
    OR s.front_storage_path IS NULL OR s.selfie_storage_path IS NULL
    OR (s.double_sided AND s.back_storage_path IS NULL)
    OR consent.status IS DISTINCT FROM 'granted' OR NOT p_purposes[1] = ANY(consent.purposes) THEN
    RETURN jsonb_build_object('code','CONFLICT');
  END IF;
  SELECT * INTO assessment FROM public.verification_assessments
    WHERE session_id = s.id AND biometric_request_id = p_request;
  IF FOUND THEN
    IF assessment.biometric_evidence_revision <> s.version OR assessment.biometric_consent_id <> consent.id
      OR assessment.biometric_purpose <> p_purposes[1] THEN RETURN jsonb_build_object('code','CONFLICT'); END IF;
    RETURN jsonb_build_object('code','OK','provider_state','not_configured','replayed',true);
  END IF;
  -- One unavailable attempt per authorized purpose under the same consent and revision.
  IF EXISTS (SELECT 1 FROM public.verification_assessments WHERE session_id=s.id
      AND biometric_consent_id=consent.id AND biometric_evidence_revision=s.version AND biometric_purpose=p_purposes[1]) THEN
    RETURN jsonb_build_object('code','CONFLICT');
  END IF;
  INSERT INTO public.verification_assessments(session_id,assessment_source,biometric_consent_id,
    biometric_request_id,biometric_purpose,biometric_evidence_revision,face_match_status,liveness_status,provider_state)
    VALUES(s.id,'biometric_contract',consent.id,p_request,p_purposes[1],s.version,'not_run','not_run','not_configured')
    RETURNING * INTO assessment;
  INSERT INTO public.trust_audit_events(event_type,actor_user_id,actor_role,actor_type,source_route,new_value)
    VALUES ('VERIFICATION_BIOMETRIC_UNAVAILABLE',p_user,'applicant','user','identity/biometric-contract',
      jsonb_build_object('session_id',s.id,'assessment_id',assessment.id,'purpose',p_purposes[1]));
  RETURN jsonb_build_object('code','OK','provider_state','not_configured','replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_identity_biometric_contract(uuid,text,text,uuid,integer,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_identity_biometric_contract(uuid,text,text,uuid,integer,text[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_identity_biometric_assessment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.biometric_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'Biometric assessment receipts are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.biometric_request_id IS NOT NULL THEN RAISE EXCEPTION 'Insert a new biometric assessment receipt'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS identity_biometric_assessment_immutable ON public.verification_assessments;
CREATE TRIGGER identity_biometric_assessment_immutable
BEFORE UPDATE OR DELETE ON public.verification_assessments FOR EACH ROW
EXECUTE FUNCTION public.guard_identity_biometric_assessment();
