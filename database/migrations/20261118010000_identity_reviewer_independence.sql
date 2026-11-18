-- A reviewer must never decide their own identity case. This trigger is an
-- additional database boundary; role/step-up authorization remains server-side.
CREATE OR REPLACE FUNCTION public.enforce_identity_reviewer_independence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE applicant_id TEXT;
BEGIN
  SELECT user_id INTO applicant_id FROM public.verification_sessions WHERE id = NEW.session_id;
  IF applicant_id IS NULL OR NULLIF(NEW.reviewer_id, '') IS NULL OR applicant_id = NEW.reviewer_id THEN
    RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_identity_reviewer_independence() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_identity_reviewer_independence ON public.verification_decisions;
CREATE TRIGGER trg_identity_reviewer_independence BEFORE INSERT ON public.verification_decisions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_reviewer_independence();
