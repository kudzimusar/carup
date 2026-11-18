-- One bounded password-verification budget per reviewer across API instances.
CREATE TABLE IF NOT EXISTS public.identity_review_attempt_budget (
  reviewer_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 15)
);
ALTER TABLE public.identity_review_attempt_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_review_attempt_budget FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_identity_review_attempt(
  p_reviewer_id text,
  p_auth_session_id text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  WITH request_time AS MATERIALIZED (
    SELECT clock_timestamp() AS at
  ), claimed AS (
    INSERT INTO public.identity_review_attempt_budget AS budget (reviewer_id, window_started_at, attempts)
    SELECT p_reviewer_id, request_time.at, 1
    FROM request_time
    WHERE EXISTS (
      SELECT 1
      FROM public.user_sessions AS session
      JOIN public.users AS reviewer ON reviewer.id = session.user_id
      WHERE session.id::text = p_auth_session_id
        AND session.user_id = p_reviewer_id
        AND session.is_valid IS TRUE
        AND session.expires_at::timestamptz > request_time.at
        AND reviewer.role IN ('admin', 'platform_admin', 'super_admin')
    )
    ON CONFLICT (reviewer_id) DO UPDATE
    SET window_started_at = CASE
          WHEN budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
          THEN EXCLUDED.window_started_at ELSE budget.window_started_at END,
        attempts = CASE
          WHEN budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
          THEN 1 ELSE budget.attempts + 1 END
    WHERE budget.attempts < 15
       OR budget.window_started_at <= EXCLUDED.window_started_at - interval '15 minutes'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION public.claim_identity_review_attempt(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_identity_review_attempt(text,text) TO service_role;
