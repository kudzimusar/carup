-- +migrate Up
-- =====================================================================================================
-- OC-3D CANDIDATE — NOT APPLIED ANYWHERE. Lives outside database/migrations on purpose: no runner or
-- workflow picks it up. To be promoted into database/migrations only by an authorised staging lane.
--
-- Append-only enforcement for CarUp's hash-chained AUDIT LEDGER and evidence provenance.
--
-- Measured state (repository SQL in PGlite, OC-3D): blockchain_events has NO trigger and accepts
-- UPDATE, DELETE and TRUNCATE; evidence_provenance_events refuses row UPDATE/DELETE
-- (20260621120000) but accepts TRUNCATE, which row triggers never see. The SQLite-era triggers in
-- 004_add_tamper_proofing.sql do not run on PostgreSQL at all.
--
-- What this proves and what it does not: the triggers and grants stop the APPLICATION roles
-- (anon, authenticated, service_role) from rewriting history. They are NOT cryptographic
-- immutability: the table owner / a superuser can still DISABLE TRIGGER, set
-- session_replication_role = replica, or drop the trigger. Tamper EVIDENCE against that party is
-- the hash chain + signatures verified from genesis (blockchainService.verifyChain), not this file.
-- =====================================================================================================

CREATE OR REPLACE FUNCTION public.carup_ledger_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.blockchain_events') IS NULL THEN
    RAISE EXCEPTION '[oc-3d] public.blockchain_events is absent; refusing.';
  END IF;
  IF to_regclass('public.evidence_provenance_events') IS NULL THEN
    RAISE EXCEPTION '[oc-3d] public.evidence_provenance_events is absent; refusing.';
  END IF;
END $$;

-- The ledger: no row may be rewritten or removed; the table may not be emptied.
DROP TRIGGER IF EXISTS trg_ledger_no_update ON public.blockchain_events;
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON public.blockchain_events
  FOR EACH ROW EXECUTE FUNCTION public.carup_ledger_reject_mutation();
DROP TRIGGER IF EXISTS trg_ledger_no_delete ON public.blockchain_events;
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON public.blockchain_events
  FOR EACH ROW EXECUTE FUNCTION public.carup_ledger_reject_mutation();
DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON public.blockchain_events;
CREATE TRIGGER trg_ledger_no_truncate BEFORE TRUNCATE ON public.blockchain_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.carup_ledger_reject_mutation();

-- Provenance already refuses row UPDATE/DELETE; close TRUNCATE, which those row triggers never see.
DROP TRIGGER IF EXISTS trg_provenance_no_truncate ON public.evidence_provenance_events;
CREATE TRIGGER trg_provenance_no_truncate BEFORE TRUNCATE ON public.evidence_provenance_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.carup_ledger_reject_mutation();

-- Application roles read and append; they never rewrite (defence in depth beneath the triggers).
REVOKE UPDATE, DELETE, TRUNCATE ON public.blockchain_events FROM anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.evidence_provenance_events FROM anon, authenticated, service_role;

-- New hashes must be a v1 (64 hex) or v2 ('v2:' + 64 hex) hash. NOT VALID: historical rows are not
-- re-judged by this candidate (no backfill); a later lane may VALIDATE after a read-only audit.
ALTER TABLE public.blockchain_events DROP CONSTRAINT IF EXISTS blockchain_events_hash_format;
ALTER TABLE public.blockchain_events
  ADD CONSTRAINT blockchain_events_hash_format
  CHECK (current_hash ~ '^(v2:)?[0-9a-f]{64}$' AND previous_hash ~ '^(v2:)?[0-9a-f]{64}$') NOT VALID;

-- +migrate Down
-- Removes the triggers, function and constraint. It does NOT re-grant UPDATE/DELETE/TRUNCATE: the
-- privileges held before Up are not measured, and widening write access to an audit store must be a
-- deliberate, recorded act — not a side effect of rolling a migration back.
ALTER TABLE public.blockchain_events DROP CONSTRAINT IF EXISTS blockchain_events_hash_format;
DROP TRIGGER IF EXISTS trg_provenance_no_truncate ON public.evidence_provenance_events;
DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON public.blockchain_events;
DROP TRIGGER IF EXISTS trg_ledger_no_delete ON public.blockchain_events;
DROP TRIGGER IF EXISTS trg_ledger_no_update ON public.blockchain_events;
DROP FUNCTION IF EXISTS public.carup_ledger_reject_mutation();
