-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Session-scoped, exactly as 20261103141000.
SET lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 D2 security barrier.
-- Legacy 20260626150000_dealer_compliance.sql granted authenticated users
-- table-wide INSERT and UPDATE of dealer_profiles. RLS checked *whose row*,
-- not *which authority columns*, permitting a direct Supabase caller to set
-- identity_status, active_state, compliance_review_state, tenant_id, etc.
-- The API whitelist alone does not protect the direct PostgREST surface.
-- Restrict owner writes to unverified application identity data only.
REVOKE INSERT,UPDATE ON dealer_profiles FROM authenticated;
GRANT INSERT (
  user_id,legal_name,trading_name,registration_number,tax_id,
  physical_address,responsible_person,operating_country
) ON dealer_profiles TO authenticated;
GRANT UPDATE (
  legal_name,trading_name,registration_number,tax_id,
  physical_address,responsible_person,operating_country
) ON dealer_profiles TO authenticated;

-- Deny even allowlisted identity editing on an independently verified or
-- approved company; corrections require separate governed review.
DROP POLICY IF EXISTS "dealer_profiles owner update" ON dealer_profiles;
CREATE POLICY "dealer_profiles owner update" ON dealer_profiles
 FOR UPDATE TO authenticated
 USING (
    auth.uid() IS NOT NULL AND user_id=auth.uid()::text
    AND identity_status NOT IN ('verified')
    AND compliance_review_state NOT IN ('passed')
 )
 WITH CHECK (
    auth.uid() IS NOT NULL AND user_id=auth.uid()::text
    AND identity_status NOT IN ('verified')
    AND compliance_review_state NOT IN ('passed')
 );
-- Insert grants omit all 8 authority fields and tenant_id; DB defaults are
-- immutable by direct untrusted clients under this role.
COMMENT ON TABLE dealer_profiles IS
 'Canonical dealer profile. Authenticated owner may write candidate identity
  fields only; governance status, active state, tenant and listing limits are
  exclusively service-role/independent compliance controlled.';

-- +migrate Down
-- R6 DBA #6: this Down deliberately does NOT restore the pre-migration privileges. The exact
-- pre-migration state (20260626150000: table-wide GRANT INSERT,UPDATE ON dealer_profiles TO
-- authenticated, and an owner UPDATE policy with no status predicate) is the privilege-escalation
-- hole this migration closes: a direct PostgREST caller could set identity_status,
-- compliance_review_state, active_state, suspension/investigation/restriction state or tenant_id
-- on its own row. No rollback of the dealership programme needs that, and every dealership write
-- runs as service_role, so restoring it would only re-open the hole. The column-scoped grants and
-- the status-guarded owner policy therefore STAY in place on rollback (fix forward if they must
-- change). Re-applying the Up is idempotent: REVOKE/GRANT and DROP POLICY IF EXISTS + CREATE POLICY.
DO $$
BEGIN
  RAISE NOTICE 'dealer_profiles self-grant hardening retained on rollback (security barrier; see 20261103125000)';
END;
$$;
