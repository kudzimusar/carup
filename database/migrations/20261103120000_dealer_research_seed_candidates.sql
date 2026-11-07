-- +migrate Up
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
  -- …and the Down of this same version refuses to run later in this transaction (whole-file apply).
  PERFORM set_config('carup.dealer_migration_up_v20261103120000', txid_current()::text, true);
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
-- CARUP-DEALER-ONB-001 D1/D4: RESEARCH CANDIDATES ONLY.
-- Never treat one seed row as a legal organization, dealership tenant, seller or verified branch.
-- This additive private table has NO public/anon/authenticated read policies or public projection.
CREATE TABLE IF NOT EXISTS dealer_research_seed_records (
  seed_dealer_id            TEXT PRIMARY KEY
    CHECK (seed_dealer_id ~ '^ZW-DEAL-[0-9]{4}$'),
  source_workbook_sha256    TEXT NOT NULL
    CHECK (source_workbook_sha256 ~ '^[0-9a-f]{64}$'),
  original_source_row      INTEGER NOT NULL
    CHECK (original_source_row BETWEEN 8 AND 111),
  source_row_sha256         TEXT NOT NULL
    CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot          JSONB NOT NULL,
  proposed_source_category TEXT,
  grouping_review          TEXT NOT NULL DEFAULT 'UNREVIEWED_PARENT_BRANCH_MATCH',
  publication_eligibility  TEXT NOT NULL DEFAULT 'PENDING_HUMAN_SOURCE_ELIGIBILITY',
  claim_lifecycle          TEXT NOT NULL DEFAULT 'UNCLAIMED_NO_APPROVED_CLAIM',
  logo_rights_status       TEXT NOT NULL DEFAULT 'PLACEHOLDER_UNTIL_RIGHTS_REVIEW',
  public_profile_state     TEXT NOT NULL DEFAULT 'NOT_PUBLISHED',
  candidate_record_state   TEXT NOT NULL DEFAULT 'RESEARCH_ONLY_NOT_LEGAL_ENTITY',
  imported_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(source_snapshot) = 'object'),
  CHECK (publication_eligibility = 'PENDING_HUMAN_SOURCE_ELIGIBILITY'),
  CHECK (public_profile_state = 'NOT_PUBLISHED'),
  CHECK (candidate_record_state = 'RESEARCH_ONLY_NOT_LEGAL_ENTITY')
);
COMMENT ON TABLE dealer_research_seed_records IS
  'Private immutable research seed snapshots, NOT canonical legal entities or published dealer profiles; contains RESTRICTED unreviewed contact and source claims. Separate reviewer-governed public projection required.';
CREATE INDEX IF NOT EXISTS idx_dealer_research_seed_workbook
  ON dealer_research_seed_records (source_workbook_sha256, original_source_row);
ALTER TABLE dealer_research_seed_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_seed_records FROM PUBLIC;
REVOKE ALL ON dealer_research_seed_records FROM anon;
REVOKE ALL ON dealer_research_seed_records FROM authenticated;
GRANT SELECT, INSERT ON dealer_research_seed_records TO service_role;
-- Deliberately no RLS policy for visitor or dealer, no public view, no update privilege.
-- A correction/identity-review flow must be introduced separately with audit custody.
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
  IF current_setting('carup.dealer_migration_up_v20261103120000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103120000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
-- R6 DBA #6: imported research snapshots are custody (source row hashes, provenance). Rollback is
-- refused while any exist, before any DDL; dispose of them explicitly, or fix forward.
DO $$
BEGIN
  IF to_regclass('public.dealer_research_seed_records') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_research_seed_records) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_RESEARCH_SEED_CUSTODY';
    END IF;
  END IF;
END;
$$;
DROP TABLE IF EXISTS dealer_research_seed_records;
