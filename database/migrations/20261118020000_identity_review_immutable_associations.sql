-- Preserve the identity and audit record behind each Phase 7C decision.
-- The existing insert-time independence check and retention behavior still apply.
CREATE OR REPLACE FUNCTION public.reject_identity_review_record_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Identity review records cannot be rewritten' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_identity_review_record_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_verification_decision_no_update ON public.verification_decisions;
CREATE TRIGGER trg_verification_decision_no_update
  BEFORE UPDATE ON public.verification_decisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_identity_review_record_update();

DROP TRIGGER IF EXISTS trg_verification_owner_no_update ON public.verification_sessions;
CREATE TRIGGER trg_verification_owner_no_update
  BEFORE UPDATE ON public.verification_sessions
  FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.id IS DISTINCT FROM NEW.id)
  EXECUTE FUNCTION public.reject_identity_review_record_update();

DROP TRIGGER IF EXISTS trg_verification_audit_no_update ON public.trust_audit_events;
CREATE TRIGGER trg_verification_audit_no_update
  BEFORE UPDATE ON public.trust_audit_events
  FOR EACH ROW
  WHEN (OLD.event_type LIKE 'VERIFICATION%' OR NEW.event_type LIKE 'VERIFICATION%')
  EXECUTE FUNCTION public.reject_identity_review_record_update();

REVOKE UPDATE ON public.verification_decisions FROM PUBLIC, anon, authenticated, service_role;
