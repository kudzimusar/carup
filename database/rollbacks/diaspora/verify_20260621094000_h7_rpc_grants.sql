-- Verification-only script for 20260621094000_diaspora_h7_rpc_execute_grants.sql
-- Classification: FEATURE-DISABLE + BACKUP RESTORE. Reversing would re-expose the H1/H2/H3 atomic
-- money/state RPCs (stock movement, quote acceptance, cargo-reservation approval) to
-- anon/authenticated EXECUTE — deliberately no destructive script exists.
--
-- BEFORE/AFTER: EXECUTE on all three RPCs is service_role only.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'diaspora_append_stock_movement_atomic',
    'diaspora_accept_quote_atomic',
    'diaspora_approve_cargo_reservation_atomic'
  )
ORDER BY routine_name, grantee;
-- Expected: exactly one grantee per routine: service_role.
