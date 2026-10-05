-- +migrate Up
-- OCR 1.0-C3 — direct-access hardening for the bounded Garage application/evidence tables.
-- These tables are reached through the service-role backend and its proven-session applicant scope.
-- No browser role receives a direct PostgREST policy or grant.

ALTER TABLE public.garage_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_applications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.garage_application_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_decisions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.garage_application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_documents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.garage_applications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.garage_application_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.garage_application_documents FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.garage_applications TO service_role;
GRANT ALL ON public.garage_application_decisions TO service_role;
GRANT ALL ON public.garage_application_documents TO service_role;

COMMENT ON TABLE public.garage_application_documents IS
  'OCR 1.0-C3 private Garage evidence. OCR output is candidate assistance only and confers no Garage, tenant, membership, Seller or Trust authority.';
