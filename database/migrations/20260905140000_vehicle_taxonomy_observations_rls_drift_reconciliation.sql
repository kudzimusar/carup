-- +migrate Up
-- =============================================================
-- Forward reconciliation — `public.vehicle_taxonomy_observations` security drift.
--
-- 20260828133000_global_vehicle_taxonomy_s0.sql already expresses the intended state: RLS enabled,
-- anon/authenticated revoked, service_role granted. Staging was nevertheless MEASURED as:
--
--     rls_enabled = false
--     anon         SELECT = true, INSERT = true
--     authenticated SELECT = true, INSERT = true
--
-- So this is DRIFT from committed intent, not a missing decision. The governance queue holds raw
-- seller/import observations; with Supabase's public-schema defaults and PostgREST in front, that
-- combination let anyone holding the anon key both read the queue and write rows into it.
--
-- This migration is deliberately ADDITIVE and FORWARD-ONLY. The originating migration's bytes are
-- not edited and it is not replayed: it is already applied, and rewriting an applied migration is
-- how provenance pinning gets broken. Everything below is idempotent, so re-application is safe
-- and this file can also serve as the repair if the same drift ever recurs.
--
-- Production is NOT activated by this file being present in the repository.
-- =============================================================

DO $reconcile$
BEGIN
  IF to_regclass('public.vehicle_taxonomy_observations') IS NULL THEN
    RAISE NOTICE 'vehicle_taxonomy_observations absent; nothing to reconcile.';
    RETURN;
  END IF;

  -- 1. RLS on. Idempotent: ALTER ... ENABLE is a no-op when already enabled.
  EXECUTE 'ALTER TABLE public.vehicle_taxonomy_observations ENABLE ROW LEVEL SECURITY';

  -- 2. Remove API-role reachability. RLS alone is not sufficient here: a table with RLS enabled
  --    and no policy denies row access, but leaving the GRANTs in place keeps the relation
  --    advertised through PostgREST. Revoking is what actually removes the surface.
  EXECUTE 'REVOKE ALL ON TABLE public.vehicle_taxonomy_observations FROM anon';
  EXECUTE 'REVOKE ALL ON TABLE public.vehicle_taxonomy_observations FROM authenticated';
  EXECUTE 'REVOKE ALL ON TABLE public.vehicle_taxonomy_observations FROM PUBLIC';

  -- 3. Preserve the access the product actually needs. The backend reaches this table as
  --    service_role, which bypasses RLS; restating the grant makes the intent explicit and
  --    survives a future default-privilege change.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_taxonomy_observations TO service_role';
  END IF;
END
$reconcile$;

-- 4. Fail loudly rather than reporting a false success. A reconciliation that silently did nothing
--    is worse than one that errors, because it closes the finding without closing the hole.
DO $verify$
DECLARE
  v_rls   boolean;
  v_anon  boolean;
  v_authed boolean;
BEGIN
  IF to_regclass('public.vehicle_taxonomy_observations') IS NULL THEN RETURN; END IF;

  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'vehicle_taxonomy_observations';

  v_anon   := has_table_privilege('anon',          'public.vehicle_taxonomy_observations', 'SELECT');
  v_authed := has_table_privilege('authenticated', 'public.vehicle_taxonomy_observations', 'SELECT');

  IF NOT v_rls THEN
    RAISE EXCEPTION 'RECONCILE FAILED: RLS still disabled on vehicle_taxonomy_observations';
  END IF;
  IF v_anon OR v_authed THEN
    RAISE EXCEPTION 'RECONCILE FAILED: API roles retain SELECT (anon=%, authenticated=%)', v_anon, v_authed;
  END IF;
END
$verify$;

-- +migrate Down
-- No automatic rollback. Restoring anon/authenticated reachability to a governance queue would
-- re-open the exact exposure this migration exists to close, so a reversal must be a deliberate,
-- separately reviewed migration rather than an automated undo.
