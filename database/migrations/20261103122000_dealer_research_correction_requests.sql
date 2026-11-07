-- +migrate Up
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
  -- …and the Down of this same version refuses to run later in this transaction (whole-file apply).
  PERFORM set_config('carup.dealer_migration_up_v20261103122000', txid_current()::text, true);
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
-- Public correction/removal requests do not confer business ownership, modify a research
-- publication, or trigger automatic suppression. All disposition is independent review.
CREATE TABLE IF NOT EXISTS dealer_research_correction_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('CORRECTION','REMOVAL','BUSINESS_CLOSED','IDENTITY_DISPUTE')),
  request_summary TEXT NOT NULL CHECK (length(btrim(request_summary)) BETWEEN 30 AND 2000),
  contact_email TEXT CHECK (contact_email IS NULL OR length(contact_email) BETWEEN 3 AND 200),
  status TEXT NOT NULL DEFAULT 'PENDING_HUMAN_REVIEW'
    CHECK (status = 'PENDING_HUMAN_REVIEW'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dealer_research_correction_requests IS
  'Private requested correction/takedown queue; cannot self-revoke or assume ownership. Public source projection is affected only by an independent publication review.';
ALTER TABLE dealer_research_correction_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_correction_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON dealer_research_correction_requests TO service_role;
CREATE INDEX IF NOT EXISTS idx_dealer_research_correction_queue
  ON dealer_research_correction_requests (seed_dealer_id,created_at DESC);
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
  IF current_setting('carup.dealer_migration_up_v20261103122000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103122000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
-- R6 DBA #6: a public correction/takedown request is a third party's record. Rollback is refused
-- while any exist, before any DDL; dispose of them explicitly, or fix forward.
DO $$
BEGIN
  IF to_regclass('public.dealer_research_correction_requests') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_research_correction_requests) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_RESEARCH_CORRECTION_REQUESTS';
    END IF;
  END IF;
END;
$$;
DROP TABLE IF EXISTS dealer_research_correction_requests;
