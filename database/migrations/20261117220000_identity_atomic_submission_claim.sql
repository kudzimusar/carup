-- LR06 candidate: submission claim and authoritative audit must commit together.
-- The caller is a server-side service; no client-supplied actor is trusted directly.
CREATE OR REPLACE FUNCTION claim_verification_ocr_submission(
  p_session_id UUID, p_user_id TEXT, p_expected_version INTEGER,
  p_expected_status TEXT, p_actor_role TEXT, p_actor_tenant_id TEXT, p_request_id TEXT,
  p_ip_address TEXT, p_user_agent TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE claimed verification_sessions%ROWTYPE; timestamp_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE verification_sessions SET
    status = 'ocr_pending', workflow_phase = 'system_processing',
    submitted_at = COALESCE(submitted_at, timestamp_now), ocr_started_at = timestamp_now,
    updated_at = timestamp_now, failure_reason = NULL, ocr_confirmed_at = NULL,
    ocr_confirmation_required = false, version = version + 1
  WHERE id = p_session_id AND user_id = p_user_id AND version = p_expected_version
    AND status = p_expected_status
    AND (status IN ('uploaded', 'ocr_failed') OR
         (status = 'ocr_pending' AND ocr_started_at IS NOT NULL AND ocr_started_at <= timestamp_now - INTERVAL '5 minutes'))
    AND front_storage_path IS NOT NULL AND selfie_storage_path IS NOT NULL
    AND (NOT double_sided OR back_storage_path IS NOT NULL)
  RETURNING * INTO claimed;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO trust_audit_events(event_type, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route, previous_value, new_value, request_id, ip_address, user_agent)
    VALUES ('VERIFICATION_SUBMITTED', p_user_id, p_actor_role, p_actor_tenant_id, 'user',
      '/api/identity/verification-sessions/:sessionId/submit',
      jsonb_build_object('status', p_expected_status),
      jsonb_build_object('session_id', claimed.id, 'status', claimed.status, 'document_type', claimed.document_type, 'workflow_phase', claimed.workflow_phase),
      p_request_id, p_ip_address, p_user_agent);
  RETURN to_jsonb(claimed);
END;
$$;
REVOKE ALL ON FUNCTION claim_verification_ocr_submission(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_verification_ocr_submission(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- Phase 7C decision, case update and audit are one transaction. Policy and
-- reviewer authorization remain in the existing backend service.
CREATE OR REPLACE FUNCTION record_verification_decision_atomic(
  p_session_id UUID, p_expected_version INTEGER, p_decision JSONB,
  p_update JSONB, p_event_type TEXT, p_request_id TEXT, p_ip_address TEXT, p_user_agent TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE current_case verification_sessions%ROWTYPE; updated_case verification_sessions%ROWTYPE; existing verification_decisions%ROWTYPE;
BEGIN
  SELECT * INTO current_case FROM verification_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  IF p_decision->>'session_id' IS DISTINCT FROM p_session_id::text THEN RETURN jsonb_build_object('code','INVALID'); END IF;
  IF NULLIF(p_decision->>'idempotency_key','') IS NOT NULL THEN
    SELECT * INTO existing FROM verification_decisions WHERE session_id = p_session_id AND idempotency_key = p_decision->>'idempotency_key';
    IF FOUND THEN
      IF existing.decision IS DISTINCT FROM p_decision->>'decision' OR existing.reason_code IS DISTINCT FROM p_decision->>'reason_code'
        OR existing.internal_note IS DISTINCT FROM p_decision->>'internal_note' OR existing.applicant_message IS DISTINCT FROM p_decision->>'applicant_message'
        OR existing.reviewer_id IS DISTINCT FROM p_decision->>'reviewer_id' THEN RETURN jsonb_build_object('code','IDEMPOTENCY_CONFLICT'); END IF;
      RETURN jsonb_build_object('code','REPLAY','decision',to_jsonb(existing),'session',to_jsonb(current_case));
    END IF;
  END IF;
  IF current_case.version IS DISTINCT FROM p_expected_version THEN RETURN jsonb_build_object('code','STALE'); END IF;
  -- The same transaction also enforces the new-case applicant confirmation gate.
  IF p_decision->>'decision' = 'approve' AND current_case.ocr_confirmation_required AND current_case.ocr_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('code','CONFIRMATION_REQUIRED');
  END IF;
  INSERT INTO verification_decisions(id,session_id,decision,reason_code,internal_note,applicant_message,reviewer_id,reviewer_role,
    previous_workflow_phase,resulting_workflow_phase,previous_legacy_status,resulting_legacy_status,final_disposition,idempotency_key,created_at)
  VALUES (p_decision->>'id',p_session_id,p_decision->>'decision',p_decision->>'reason_code',p_decision->>'internal_note',p_decision->>'applicant_message',p_decision->>'reviewer_id',p_decision->>'reviewer_role',
    p_decision->>'previous_workflow_phase',p_decision->>'resulting_workflow_phase',p_decision->>'previous_legacy_status',p_decision->>'resulting_legacy_status',p_decision->>'final_disposition',p_decision->>'idempotency_key',
    COALESCE((p_decision->>'created_at')::timestamptz,clock_timestamp()));
  UPDATE verification_sessions SET
    updated_at = clock_timestamp(), version = version + 1,
    workflow_phase = CASE WHEN p_update ? 'workflow_phase' THEN p_update->>'workflow_phase' ELSE workflow_phase END,
    status = CASE WHEN p_update ? 'status' THEN p_update->>'status' ELSE status END,
    final_disposition = CASE WHEN p_update ? 'final_disposition' THEN p_update->>'final_disposition' ELSE final_disposition END,
    primary_reason_code = CASE WHEN p_update ? 'primary_reason_code' THEN p_update->>'primary_reason_code' ELSE primary_reason_code END,
    reviewed_by = CASE WHEN p_update ? 'reviewed_by' THEN p_update->>'reviewed_by' ELSE reviewed_by END,
    reviewed_at = CASE WHEN p_update ? 'reviewed_at' THEN (p_update->>'reviewed_at')::timestamptz ELSE reviewed_at END,
    review_decision = CASE WHEN p_update ? 'review_decision' THEN p_update->>'review_decision' ELSE review_decision END,
    failure_reason = CASE WHEN p_update ? 'failure_reason' THEN p_update->>'failure_reason' ELSE failure_reason END,
    review_notes = CASE WHEN p_update ? 'review_notes' THEN p_update->>'review_notes' ELSE review_notes END,
    retry_reason = CASE WHEN p_update ? 'retry_reason' THEN p_update->>'retry_reason' ELSE retry_reason END
  WHERE id = p_session_id RETURNING * INTO updated_case;
  INSERT INTO trust_audit_events(event_type,actor_user_id,actor_role,actor_type,source_route,previous_value,new_value,reason,decision_notes,request_id,ip_address,user_agent)
    VALUES (p_event_type, p_decision->>'reviewer_id', p_decision->>'reviewer_role', 'user',
      '/api/admin/identity/verification-sessions/:sessionId/review',
      jsonb_build_object('status',current_case.status,'review_decision',current_case.review_decision,'workflow_phase',current_case.workflow_phase),
      jsonb_build_object('session_id',p_session_id,'status',updated_case.status,'review_decision',updated_case.review_decision,'workflow_phase',updated_case.workflow_phase,'final_disposition',updated_case.final_disposition,'decision_id',p_decision->>'id'),
      p_decision->>'reason_code', COALESCE(p_decision->>'internal_note',p_decision->>'applicant_message'), p_request_id, p_ip_address, p_user_agent);
  RETURN jsonb_build_object('code','OK','session',to_jsonb(updated_case));
END;
$$;
REVOKE ALL ON FUNCTION record_verification_decision_atomic(UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_verification_decision_atomic(UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) TO service_role;
