-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
  -- …and the Down of this same version refuses to run later in this transaction (whole-file apply).
  PERFORM set_config('carup.dealer_migration_up_v20261103125000', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
END
$txnguard$;
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
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
  -- R6 DBA review 4 R1: this version's Up ran earlier in THIS transaction — a whole file (Up then
  -- Down) was applied as one transaction, which would silently undo itself. Refuse loudly; the
  -- whole transaction rolls back.
  IF current_setting('carup.dealer_migration_up_v20261103125000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103125000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
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
