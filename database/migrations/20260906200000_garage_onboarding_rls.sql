-- +migrate Up
-- GMO — row-level security for every table this programme added.
--
-- These four tables shipped without RLS while every comparable table around them has it enabled
-- (`tenants`, `tenant_users`, `users`, `service_cases`, `dealer_compliance_documents`). An
-- adversarial review found it: without RLS, PostgREST exposes them to the `anon` and
-- `authenticated` roles directly, and the row that decides who becomes a garage administrator was
-- writable from a browser — entirely bypassing the reviewer, the capability check and the step-up
-- that the API path spends three phases enforcing.
--
-- The posture matches `service_cases`: RLS ON, FORCE ON, and NO permissive policies. The backend
-- reaches these tables as `service_role`, which bypasses RLS by design, so every read and write
-- continues to go through the governed service layer where the authority checks actually live.
-- Nothing reaches them directly from a browser.
--
-- FORCE matters as well as ENABLE: without it the table owner is exempt, and "the owner is exempt"
-- is the kind of exception that turns into an incident the first time something connects as owner.

ALTER TABLE public.garage_applications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_applications           FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.garage_application_decisions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_decisions  FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.garage_application_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_documents  FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.garage_invitations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_invitations            FORCE  ROW LEVEL SECURITY;

-- Belt and braces: revoke the direct table privileges PostgREST would otherwise expose. RLS with no
-- policy already denies these roles, but a future migration that adds a policy for one purpose
-- should not silently open every other operation along with it.
REVOKE ALL ON public.garage_applications          FROM anon, authenticated;
REVOKE ALL ON public.garage_application_decisions FROM anon, authenticated;
REVOKE ALL ON public.garage_application_documents FROM anon, authenticated;
REVOKE ALL ON public.garage_invitations           FROM anon, authenticated;

-- The activation function must not be callable straight from a browser either. It is the one place
-- a tenant and a founding membership come into existence, and the API route in front of it composes
-- role + the named Operations capability + step-up. An anon or authenticated caller reaching it via
-- PostgREST's RPC endpoint would skip all three.
REVOKE ALL ON FUNCTION public.activate_garage_application(UUID, TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.garage_applications IS
  'GMO-1 garage applications. RLS forced with no policies: reachable only as service_role, through '
  'the governed API. The row that decides who becomes a garage administrator is not browser-writable.';
