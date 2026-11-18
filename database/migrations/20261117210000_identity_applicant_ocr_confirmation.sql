-- Local candidate only. Apply only through the approved migration process.
-- Captures applicant declarations separately from machine observations.
ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS ocr_confirmed_at TIMESTAMPTZ;
ALTER TABLE verification_sessions ADD COLUMN IF NOT EXISTS ocr_confirmation_required BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS verification_applicant_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
  applicant_user_id TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  source_version INTEGER NOT NULL,
  source_ocr_started_at TIMESTAMPTZ,
  original_observations JSONB NOT NULL,
  applicant_fields JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, idempotency_key),
  UNIQUE(session_id, source_ocr_started_at)
);
ALTER TABLE verification_applicant_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON verification_applicant_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON verification_applicant_confirmations TO service_role;

-- Lock, validate and persist the declaration and its audit event in one transaction.
-- The backend supplies actor identity after authentication; only service_role may execute.
CREATE OR REPLACE FUNCTION confirm_verification_ocr_fields(
  p_session_id UUID, p_user_id TEXT, p_expected_version INTEGER,
  p_idempotency_key UUID, p_fields JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s verification_sessions%ROWTYPE; existing verification_applicant_confirmations%ROWTYPE; rec verification_applicant_confirmations%ROWTYPE;
BEGIN
  SELECT * INTO s FROM verification_sessions WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  SELECT * INTO existing FROM verification_applicant_confirmations WHERE session_id = p_session_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing.applicant_fields <> p_fields THEN RETURN jsonb_build_object('code','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('code','OK','id',existing.id,'version',existing.source_version + 1,'created_at',existing.created_at,'replayed',true);
  END IF;
  IF s.status <> 'pending_manual_review' OR s.ocr_execution_status <> 'provider_succeeded' OR s.ocr_started_at IS NULL OR s.ocr_result IS NULL OR s.ocr_result = '{}'::jsonb THEN
    RETURN jsonb_build_object('code','INVALID_STATE');
  END IF;
  IF s.version <> p_expected_version THEN RETURN jsonb_build_object('code','STALE_VERSION'); END IF;
  IF EXISTS (SELECT 1 FROM verification_applicant_confirmations WHERE session_id = p_session_id AND source_ocr_started_at = s.ocr_started_at) THEN
    RETURN jsonb_build_object('code','ALREADY_CONFIRMED');
  END IF;
  INSERT INTO verification_applicant_confirmations(session_id, applicant_user_id, idempotency_key, source_version, source_ocr_started_at, original_observations, applicant_fields)
    VALUES (s.id, p_user_id, p_idempotency_key, s.version, s.ocr_started_at, COALESCE(s.ocr_result, '{}'::jsonb), p_fields) RETURNING * INTO rec;
  UPDATE verification_sessions SET version = version + 1, updated_at = now(), ocr_confirmed_at = rec.created_at WHERE id = s.id;
  INSERT INTO trust_audit_events(event_type, actor_user_id, actor_role, actor_type, source_route, new_value)
    VALUES ('VERIFICATION_OCR_APPLICANT_CONFIRMED', p_user_id, 'applicant', 'user', '/api/identity/verification-sessions/:sessionId/ocr-confirmation',
      jsonb_build_object('session_id', s.id, 'confirmation_id', rec.id, 'fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_fields) AS k)));
  RETURN jsonb_build_object('code','OK','id',rec.id,'version',s.version + 1,'created_at',rec.created_at,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION confirm_verification_ocr_fields(UUID,TEXT,INTEGER,UUID,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_verification_ocr_fields(UUID,TEXT,INTEGER,UUID,JSONB) TO service_role;
