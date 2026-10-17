-- +migrate Up
-- OC-5E GMO-3 (ported from PR #209 6425e905, made atomic) — a CarUp reviewer's decision on a garage
-- application.
--
-- #209 wrote the decision-ledger row FIRST and then moved the application with a status-guarded
-- update. Two reviewers deciding at once each wrote a ledger row; one won the update and the other
-- was told "your decision was not applied" — while the ledger kept a decision that never happened.
-- Here the row lock, the state check, the ledger row and the status change are one transaction: a
-- refused or losing decision leaves nothing behind.
--
-- The function decides nothing the service does not also decide (the vocabulary, the transitions,
-- the reason rule, self-decision); it is the AUTHORITATIVE copy, evaluated under the lock. The
-- approval preconditions that need other domains (governed identity, live evidence) stay in the
-- service, which reads them through their own authorities and refuses before calling this.
--
-- Approving records a judgment. It creates no tenant and no membership (GMO-4's one job).

DO $$
BEGIN
  IF to_regclass('public.garage_applications') IS NULL OR to_regclass('public.garage_application_decisions') IS NULL THEN
    RAISE EXCEPTION 'GMO-3 requires garage_applications and garage_application_decisions (20260918090000)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_garage_application_decision(
  p_application_id UUID,
  p_decision       TEXT,
  p_actor_user_id  TEXT,
  p_actor_role     TEXT DEFAULT NULL,
  p_reason_code    TEXT DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app      public.garage_applications%ROWTYPE;
  v_updated  public.garage_applications%ROWTYPE;
  v_ledger   public.garage_application_decisions%ROWTYPE;
  v_to       TEXT;
  v_terminal BOOLEAN;
  v_reason   TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_code     TEXT := NULLIF(LEFT(BTRIM(COALESCE(p_reason_code, '')), 80), '');
BEGIN
  IF p_actor_user_id IS NULL OR BTRIM(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'GARAGE_DECISION_ACTOR_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_to := CASE p_decision
    WHEN 'start_review'      THEN 'under_review'
    WHEN 'request_more_info' THEN 'information_required'
    WHEN 'approve'           THEN 'approved'
    WHEN 'reject'            THEN 'rejected'
  END;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'GARAGE_DECISION_UNKNOWN:%', COALESCE(p_decision, '') USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A decision that pauses or closes someone's application must tell them why.
  IF p_decision IN ('request_more_info', 'reject') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'GARAGE_DECISION_REASON_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The lock serializes every decision on this application; the second waits and then sees the first.
  SELECT * INTO v_app FROM public.garage_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_APPLICATION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- Self-approval is the shortest path from "I applied" to "I have a workspace".
  IF v_app.applicant_user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'GARAGE_DECISION_SELF' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The decisions each state accepts (allowedDecisions in garageReviewService.js says the same).
  -- An application waiting on the applicant is not the reviewer's to move; a decided one is history.
  IF NOT (
    (v_app.status = 'submitted'    AND p_decision IN ('start_review', 'request_more_info', 'approve', 'reject'))
    OR (v_app.status = 'under_review' AND p_decision IN ('request_more_info', 'approve', 'reject'))
  ) THEN
    RAISE EXCEPTION 'GARAGE_DECISION_CONFLICT:%', v_app.status USING ERRCODE = 'check_violation';
  END IF;

  v_terminal := p_decision IN ('approve', 'reject');

  INSERT INTO public.garage_application_decisions (application_id, decision, reason_code, reason, actor_user_id, actor_role)
  VALUES (p_application_id, p_decision, v_code, v_reason, p_actor_user_id, p_actor_role)
  RETURNING * INTO v_ledger;

  UPDATE public.garage_applications
     SET status               = v_to,
         updated_at           = NOW(),
         decided_at           = CASE WHEN v_terminal THEN NOW() ELSE decided_at END,
         decided_by_user_id   = CASE WHEN v_terminal THEN p_actor_user_id ELSE decided_by_user_id END,
         decision_reason_code = CASE WHEN v_terminal THEN v_code ELSE decision_reason_code END,
         decision_reason      = CASE WHEN v_terminal THEN v_reason ELSE decision_reason END
   WHERE id = p_application_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'application', to_jsonb(v_updated),
    'decision', to_jsonb(v_ledger),
    'from_status', v_app.status,
    'to_status', v_to
  );
END;
$$;

COMMENT ON FUNCTION public.record_garage_application_decision(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'OC-5E GMO-3: a reviewer decision on a garage application — row lock, state check, decision ledger '
  'and status change in one transaction. Refuses self-decision, a decision the state does not accept, '
  'and a pausing/closing decision without a reason. Creates no tenant and no membership.';

-- Only the backend (service_role) records decisions; no client role may call this directly.
REVOKE ALL ON FUNCTION public.record_garage_application_decision(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_garage_application_decision(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.record_garage_application_decision(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
