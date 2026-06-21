-- Issue #77 — access-control containment follow-up.
--
-- Incremental, idempotent hardening that builds on the reconciled, canonical
-- 20260619201406_production_access_containment.sql. That migration is NOT
-- modified here.
--
-- Scope is intentionally minimal and evidence-scoped — this is NOT a blanket
-- RLS sweep and NOT an advisor-count cleanup:
--
--   1. Pin the search_path of the two authorization-helper functions that
--      still have a mutable search_path. Both participate in Row Level
--      Security decisions, so pinning their search_path closes a function-
--      resolution hardening gap (Supabase advisor: "Function Search Path
--      Mutable") on security-relevant helpers.
--
--   2. Apply least privilege to is_diaspora_platform_admin(): it is referenced
--      only by RLS policies on tables that are NOT granted to anon
--      (tenant_users and the diaspora_* tables), so the anon role does not
--      require EXECUTE on it. authenticated EXECUTE is preserved because
--      authenticated RLS policies depend on it; service_role is preserved.
--
-- Both functions deliberately remain SECURITY INVOKER: they read the *caller's*
-- session (current_setting / auth.jwt). Converting them to SECURITY DEFINER
-- would break tenant isolation and the admin check.
--
-- current_tenant_id() KEEPS its existing (anon-inclusive) EXECUTE grants:
-- anon browses public vehicles directly and the vehicles RLS policy
-- (tenant_vehicles_isolation) calls current_tenant_id(); removing anon EXECUTE
-- would break legitimate public vehicle browsing. Only its search_path is
-- pinned here (CREATE OR REPLACE preserves existing grants).
--
-- Idempotent and safe to apply more than once. No data is deleted and no schema
-- is redesigned.
--
-- Rollback: re-running the original definitions from
-- 002_multi_tenant_and_auth_schema.sql and 013_diaspora_trade_schema.sql
-- (without SET search_path) and re-granting EXECUTE to PUBLIC restores the
-- prior state. There is no destructive change to reverse.

-- 1. current_tenant_id(): pin search_path only; preserve existing EXECUTE grants
--    (anon required for public vehicle browsing via vehicles RLS).
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.current_tenant_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $function$
      SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
    $function$;
  END IF;
END $$;

-- 2. is_diaspora_platform_admin(): pin search_path and apply least privilege.
--    anon does not reach any policy that uses this helper, so anon EXECUTE is
--    removed; authenticated (RLS dependency) and service_role are preserved.
DO $$
BEGIN
  IF to_regprocedure('public.is_diaspora_platform_admin()') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.is_diaspora_platform_admin()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $function$
      SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role', '') IN ('admin', 'government');
    $function$;

    REVOKE ALL ON FUNCTION public.is_diaspora_platform_admin() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_diaspora_platform_admin() TO authenticated, service_role;
  END IF;
END $$;
