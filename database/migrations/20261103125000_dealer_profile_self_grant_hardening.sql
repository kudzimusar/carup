-- +migrate Up
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
DROP POLICY IF EXISTS "dealer_profiles owner update" ON dealer_profiles;
CREATE POLICY "dealer_profiles owner update" ON dealer_profiles
 FOR UPDATE TO authenticated
 USING (auth.uid() IS NOT NULL AND user_id=auth.uid()::text)
 WITH CHECK (user_id=auth.uid()::text);
REVOKE INSERT (
  user_id,legal_name,trading_name,registration_number,tax_id,
  physical_address,responsible_person,operating_country
) ON dealer_profiles FROM authenticated;
REVOKE UPDATE (
  legal_name,trading_name,registration_number,tax_id,
  physical_address,responsible_person,operating_country
) ON dealer_profiles FROM authenticated;
GRANT INSERT,UPDATE ON dealer_profiles TO authenticated;
