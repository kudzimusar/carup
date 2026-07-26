-- Verification-only script for 20260620232827_issue77_access_containment_followup.sql
-- Classification: FEATURE-DISABLE + BACKUP RESTORE (security-weakening rollback — reversing would
-- unpin search_path and widen grants on the two authorization helpers). Fix forward instead.
--
-- BEFORE/AFTER: both helpers keep pinned search_path and narrowed EXECUTE.
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('current_tenant_id', 'is_diaspora_platform_admin')
ORDER BY p.proname;
-- Expected: proconfig contains a pinned search_path entry for both.

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('current_tenant_id', 'is_diaspora_platform_admin')
ORDER BY routine_name, grantee;
-- Expected: authenticated + service_role only (no PUBLIC, no anon).
