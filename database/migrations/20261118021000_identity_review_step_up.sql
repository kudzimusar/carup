-- One short-lived, single-use proof per reviewer. The app stores only the
-- SHA-256 digest of a random secret. The session table remains auth authority.
CREATE TABLE IF NOT EXISTS public.identity_review_step_up (
  reviewer_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  auth_session_id text NOT NULL,
  case_id uuid NOT NULL REFERENCES public.verification_sessions(id) ON DELETE CASCADE,
  operation text NOT NULL,
  proof_digest text NOT NULL CHECK (proof_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE public.identity_review_step_up ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_review_step_up FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.identity_review_step_up TO service_role;

CREATE OR REPLACE FUNCTION public.consume_identity_review_step_up(
  p_reviewer_id text, p_auth_session_id text, p_case_id uuid,
  p_operation text, p_proof_digest text
)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog AS $$
  WITH consumed AS (
    UPDATE public.identity_review_step_up AS proof
    SET consumed_at = clock_timestamp()
    WHERE proof.reviewer_id = p_reviewer_id
      AND proof.auth_session_id = p_auth_session_id
      AND proof.case_id = p_case_id
      AND proof.operation = p_operation
      AND proof.proof_digest = p_proof_digest
      AND proof.consumed_at IS NULL
      AND proof.expires_at > clock_timestamp()
      AND EXISTS (
        SELECT 1 FROM public.user_sessions AS session
        WHERE session.id::text = p_auth_session_id
          AND session.user_id = p_reviewer_id
          AND session.is_valid IS TRUE
          AND session.expires_at::timestamptz > clock_timestamp()
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM consumed);
$$;
REVOKE ALL ON FUNCTION public.consume_identity_review_step_up(text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_identity_review_step_up(text,text,uuid,text,text) TO service_role;
