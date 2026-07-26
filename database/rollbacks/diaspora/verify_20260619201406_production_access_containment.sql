-- Verification-only script for 20260619201406_production_access_containment.sql
-- Classification: FEATURE-DISABLE + BACKUP RESTORE. No destructive rollback is provided on purpose:
-- reversing this migration would RE-GRANT anon/authenticated access to 11 launch tables and widen
-- the hardened diaspora_can_access_order helper — i.e. the rollback itself is a security incident.
-- If the containment breaks legitimate access, fix forward (grant the specific missing privilege),
-- or restore the whole database from backup under explicit authorization.
--
-- BEFORE/AFTER: table grant surface for client roles must show NO anon/authenticated privileges.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'diaspora_%'
  )
ORDER BY table_name, grantee, privilege_type;
-- Expected: zero rows for the 11 contained launch tables.

-- Helper hardening intact (SECURITY DEFINER + pinned search_path + narrowed EXECUTE):
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'diaspora_can_access_order';
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'diaspora_can_access_order';
-- Expected grantees: authenticated, service_role (NOT anon, NOT PUBLIC).
