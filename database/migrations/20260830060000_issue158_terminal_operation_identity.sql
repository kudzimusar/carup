-- +migrate Up
-- =============================================================================
-- ISSUE #158 — DURABLE TERMINAL OPERATION IDENTITY
--
-- NEW forward-only migration identity. The earlier terminal uniqueness migration is
-- already published and must remain immutable.
--
-- The terminal instant can be re-issued only to recover a write whose response was
-- lost (or whose insert failed after the boundary was allocated). Content equality
-- cannot prove that two calls are the same operation: two independent business events
-- can have identical VIN/event/payload content. A durable caller/business operation id
-- therefore becomes part of the persisted terminal identity.
--
-- Existing terminal rows predate this contract. They receive a one-way historical
-- sentinel so the database can enforce the invariant without pretending a future retry
-- can recover an operation id that was never recorded by the original caller.
-- =============================================================================

DO $pre$
BEGIN
  -- Where the ledger table exists, the terminal uniqueness contract must already be in
  -- place: this migration EXTENDS that invariant and cannot stand alone.
  IF to_regclass('public.blockchain_events') IS NOT NULL
     AND to_regclass('public.uq_blockchain_events_terminal_signer') IS NULL THEN
    RAISE EXCEPTION
      '[issue-158] terminal uniqueness migration (20260829040000) must be applied first'
      USING ERRCODE='55000';
  END IF;
END
$pre$;

-- LEDGER-TABLE ABSENCE IS TOLERATED, DELIBERATELY.
--
-- 20260829040000 guards its terminal index with `IF to_regclass('public.blockchain_events')
-- IS NOT NULL`, and the protected finalizer guards its whole operation-identity precondition
-- block the same way. A database that has custody tables but no ledger table therefore
-- already exists in this chain's contract.
--
-- Refusing to apply here would not make such a database safer — it has no terminal ledger
-- row to protect — it would instead BLOCK the Issue #158 chain, and with it custody
-- finalization, on a database that has nothing to be unsafe about. Nothing is weakened:
-- wherever public.blockchain_events exists, every object below is created and the invariant
-- is total, and the finalizer independently re-checks each of them before FINALIZED becomes
-- reachable.
DO $identity$
BEGIN
  IF to_regclass('public.blockchain_events') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.blockchain_events ADD COLUMN IF NOT EXISTS operation_id TEXT';

  -- Existing terminal rows predate this contract. They receive a one-way historical
  -- sentinel no runtime caller can reproduce, so a retry that straddles this upgrade is
  -- refused rather than falsely acknowledged.
  EXECUTE $backfill$
    UPDATE public.blockchain_events
       SET operation_id = 'legacy-terminal:' || id::text
     WHERE "timestamp" = '9999-12-31T23:59:59.999Z'
       AND nullif(btrim(operation_id),'') IS NULL
  $backfill$;

  EXECUTE 'ALTER TABLE public.blockchain_events '
       || 'DROP CONSTRAINT IF EXISTS blockchain_events_terminal_operation_id_required';

  EXECUTE $check$
    ALTER TABLE public.blockchain_events
      ADD CONSTRAINT blockchain_events_terminal_operation_id_required
      CHECK (
        "timestamp" <> '9999-12-31T23:59:59.999Z'
        OR nullif(btrim(operation_id),'') IS NOT NULL
      ) NOT VALID
  $check$;

  EXECUTE 'ALTER TABLE public.blockchain_events '
       || 'VALIDATE CONSTRAINT blockchain_events_terminal_operation_id_required';

  -- Operation ids are namespaced by signer. This is deliberately broader than the
  -- terminal predicate so a future writer cannot reuse one durable business operation
  -- identity for a second ledger event under the same signer.
  EXECUTE $ix$
    CREATE UNIQUE INDEX IF NOT EXISTS uq_blockchain_events_signer_operation_id
      ON public.blockchain_events (split_part(signature,':',1), operation_id)
      WHERE operation_id IS NOT NULL
  $ix$;
END
$identity$;

-- +migrate Down
-- Forward-only integrity boundary. Do not remove durable terminal operation identity.
