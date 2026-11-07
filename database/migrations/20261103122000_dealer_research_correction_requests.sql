-- +migrate Up
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
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
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
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
