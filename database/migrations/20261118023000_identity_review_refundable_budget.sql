-- Preserve the same shared limit on failed and in-flight password verifications.
-- A successful confirmation releases only its own reservation, once.
ALTER TABLE public.identity_review_attempt_budget
  ADD COLUMN IF NOT EXISTS reservations jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.identity_review_attempt_budget
  DROP CONSTRAINT IF EXISTS identity_review_attempt_budget_attempts_check,
  ADD CONSTRAINT identity_review_attempt_budget_attempts_check CHECK (attempts BETWEEN 0 AND 15);

CREATE OR REPLACE FUNCTION public.reserve_identity_review_attempt(
  p_reviewer_id text, p_auth_session_id text, p_reservation uuid
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  WITH request_time AS MATERIALIZED (SELECT clock_timestamp() AS at),
  claimed AS (
    INSERT INTO public.identity_review_attempt_budget AS budget
      (reviewer_id, window_started_at, attempts, reservations)
    SELECT p_reviewer_id, request_time.at, 1,
      CASE WHEN p_reservation IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object(p_reservation::text, p_auth_session_id) END
    FROM request_time
    WHERE EXISTS (
      SELECT 1 FROM public.user_sessions AS session
      JOIN public.users AS reviewer ON reviewer.id = session.user_id
      WHERE session.id::text = p_auth_session_id AND session.user_id = p_reviewer_id
        AND session.is_valid IS TRUE AND session.expires_at::timestamptz > request_time.at
        AND reviewer.role IN ('admin', 'platform_admin', 'super_admin')
    )
    ON CONFLICT (reviewer_id) DO UPDATE
    SET window_started_at = CASE
          WHEN budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
          THEN EXCLUDED.window_started_at ELSE budget.window_started_at END,
        attempts = CASE
          WHEN budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
          THEN 1 ELSE budget.attempts + 1 END,
        reservations = CASE
          WHEN budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
          THEN EXCLUDED.reservations ELSE budget.reservations || EXCLUDED.reservations END
    WHERE (budget.attempts < 15
       AND (p_reservation IS NULL OR NOT (budget.reservations ? p_reservation::text)))
       OR budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION public.reserve_identity_review_attempt(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_identity_review_attempt(text,text,uuid) TO service_role;

-- Earlier API processes still use the full-attempt budget until cutover.
CREATE OR REPLACE FUNCTION public.claim_identity_review_attempt(p_reviewer_id text, p_auth_session_id text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT public.reserve_identity_review_attempt(p_reviewer_id, p_auth_session_id, NULL::uuid);
$$;
REVOKE ALL ON FUNCTION public.claim_identity_review_attempt(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_identity_review_attempt(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_identity_review_attempt(
  p_reviewer_id text, p_auth_session_id text, p_reservation uuid
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  WITH released AS (
    UPDATE public.identity_review_attempt_budget AS budget
    SET attempts = budget.attempts - 1,
        reservations = budget.reservations - p_reservation::text
    WHERE budget.reviewer_id = p_reviewer_id AND budget.attempts > 0
      AND budget.window_started_at > clock_timestamp() - interval '15 minutes'
      AND budget.reservations ->> p_reservation::text = p_auth_session_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM released);
$$;
REVOKE ALL ON FUNCTION public.release_identity_review_attempt(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_identity_review_attempt(text,text,uuid) TO service_role;
