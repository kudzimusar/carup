-- Verification-only script for 014_diaspora_rls_recursion_fix.sql
-- Classification: FORWARD-FIX ONLY — do not roll back.
-- The policies 014 replaced caused recursive RLS evaluation on diaspora_import_orders (the reason
-- 014 exists). Restoring them would reintroduce a known production defect, so no destructive
-- rollback is provided. If 014's SECURITY DEFINER helper misbehaves, write a forward fix.
--
-- BEFORE/AFTER: confirm the helper exists, is SECURITY DEFINER, and the recreated policies are live.

-- 1. Helper function present + SECURITY DEFINER + owner:
SELECT p.proname, p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS owner,
       p.proconfig AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'diaspora_can_access_order';

-- 2. Policies recreated by 014 are present on their tables:
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN (
  'diaspora_import_orders', 'diaspora_import_order_participants', 'diaspora_trade_documents',
  'diaspora_cargo_reservations', 'diaspora_shipments', 'diaspora_shipment_stage_events',
  'diaspora_compliance_reviews', 'diaspora_payment_milestones', 'diaspora_import_audit_log',
  'vehicle_import_records'
)
ORDER BY tablename, policyname;

-- 3. EXECUTE grant surface of the helper (expect anon, authenticated per 014; later containment
--    migrations narrow this — see 20260619201406):
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'diaspora_can_access_order';
