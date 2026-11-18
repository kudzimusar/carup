-- The existing domain_events outbox and Phase 7C decision RPC are required.
-- No historical backfill: old event payloads lack decisionId, so matching them
-- to a decision would be ambiguous and could create duplicate notifications.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_decision_event_id
  ON public.domain_events ((payload->>'decisionId'))
  WHERE event_type = 'identity.verification.decided' AND payload ? 'decisionId';

-- Only the new entry point may invoke the previous primitive. This makes an
-- older application fail closed after this migration instead of silently
-- writing decisions without events. The definer owns both local functions;
-- execute is restricted below to the existing backend service role.
REVOKE EXECUTE ON FUNCTION public.record_verification_decision_atomic(UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) FROM service_role;
CREATE OR REPLACE FUNCTION public.record_verification_decision_with_event_atomic(
  p_session_id UUID, p_expected_version INTEGER, p_decision JSONB,
  p_update JSONB, p_event_type TEXT, p_request_id TEXT, p_ip_address TEXT, p_user_agent TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result JSONB; applicant_id TEXT;
BEGIN
  result := public.record_verification_decision_atomic(p_session_id, p_expected_version,
    p_decision, p_update, p_event_type, p_request_id, p_ip_address, p_user_agent);
  IF result->>'code' = 'OK' AND p_decision->>'decision' IN ('approve','reject','request_resubmission') THEN
    applicant_id := result->'session'->>'user_id';
    IF applicant_id IS NULL OR NULLIF(p_decision->>'id','') IS NULL THEN
      RAISE EXCEPTION 'Decision event requires applicant and decision identity';
    END IF;
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
      VALUES ('identity.verification.decided',
        jsonb_build_object('sessionId',p_session_id,'userId',applicant_id,
          'recipientUserId',applicant_id,'decision',p_decision->>'decision',
          'decisionId',p_decision->>'id',
          'reasonCodes',CASE WHEN NULLIF(p_decision->>'reason_code','') IS NULL THEN '[]'::jsonb
            ELSE jsonb_build_array(p_decision->>'reason_code') END),
        'pending',0,NULL);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.record_verification_decision_with_event_atomic(UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verification_decision_with_event_atomic(UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) TO service_role;
