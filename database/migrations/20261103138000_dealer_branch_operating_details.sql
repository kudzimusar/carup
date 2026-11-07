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
  PERFORM set_config('carup.dealer_migration_up_v20261103138000', txid_current()::text, true);
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
-- CARUP-DEALER-ONB-001 C14 D7: private canonical branch operating declarations.
-- No GPS coordinate or dealer-entered schedule establishes public verification.
ALTER TABLE dealer_branches
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS opening_hours_text TEXT,
  ADD COLUMN IF NOT EXISTS operating_details_updated_at TIMESTAMPTZ;
-- R6 DBA #7: these CHECKs are deliberately NOT split into NOT VALID + VALIDATE. Both constrain
-- only the columns added just above, which are NULL on every existing row, so validation cannot
-- fail; and ADD COLUMN already holds ACCESS EXCLUSIVE on dealer_branches until this migration's
-- transaction commits, so an in-transaction VALIDATE would not shorten any lock (it only helps
-- in a separate transaction). lock_timeout above bounds the wait for that lock instead.
ALTER TABLE dealer_branches
  ADD CONSTRAINT dealer_branch_gps_pair_valid
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR
    (latitude IS NOT NULL AND longitude IS NOT NULL
     AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );
ALTER TABLE dealer_branches
  ADD CONSTRAINT dealer_branch_hours_text_valid
  CHECK(opening_hours_text IS NULL OR length(btrim(opening_hours_text)) BETWEEN 1 AND 350);
COMMENT ON COLUMN dealer_branches.latitude IS 'Private dealer-declared coordinate; independently verified public location NOT inferred';
COMMENT ON COLUMN dealer_branches.longitude IS 'Private dealer-declared coordinate; independently verified public location NOT inferred';
COMMENT ON COLUMN dealer_branches.opening_hours_text IS 'Private dealer-declared schedule, never an open-now assertion';

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
  IF current_setting('carup.dealer_migration_up_v20261103138000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103138000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
-- Protect user business data; rollback cannot silently discard declarations.
DO $$
BEGIN
 IF EXISTS(
   SELECT 1 FROM dealer_branches WHERE
     latitude IS NOT NULL OR longitude IS NOT NULL OR
     opening_hours_text IS NOT NULL OR operating_details_updated_at IS NOT NULL
 ) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_BRANCH_OPERATING_DETAILS';
 END IF;
END;
$$;
ALTER TABLE dealer_branches
  DROP CONSTRAINT IF EXISTS dealer_branch_hours_text_valid,
  DROP CONSTRAINT IF EXISTS dealer_branch_gps_pair_valid;
ALTER TABLE dealer_branches
  DROP COLUMN IF EXISTS operating_details_updated_at,
  DROP COLUMN IF EXISTS opening_hours_text,
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS latitude;
