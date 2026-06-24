-- Resolve the Supabase security advisory "Function Search Path Mutable" for the
-- referral updated_at trigger function (public.set_referral_updated_at), created
-- in 016_referral_engine_phase1.sql without a pinned search_path.
--
-- Additive + idempotent: CREATE OR REPLACE redefines ONLY the function body with
-- a pinned (empty) search_path. The function identity (public.set_referral_updated_at,
-- no args) is unchanged, so the five referral_*_updated_at triggers that reference
-- it by name remain bound. No table, column, index, policy, or data is touched.
--
-- search_path = '' makes name resolution non-mutable; pg_catalog is still always
-- implicitly searched first, so now() resolves safely.

CREATE OR REPLACE FUNCTION public.set_referral_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
