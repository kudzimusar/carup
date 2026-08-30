-- +migrate Up
-- =============================================================================
-- ISSUE #158 — DURABLE LEDGER OPERATION IDENTITY FOR TERMINAL WRITES
--
-- This migration has a NEW identity on purpose. 20260829040000 established "at most one
-- terminal event per signer", and the runtime then classified a terminal uniqueness
-- conflict as a retry when the signer, VIN, event type and payload matched. Content
-- equality is NOT an operation identity: two genuinely independent invocations with the
-- same subject data are indistinguishable from one invocation retried after a lost
-- response, so the loser of the race was acknowledged as if it had persisted.
--
-- Fixing that requires a NEW persistence contract, so it must not be smuggled into an
-- already-published migration: a database that has already recorded 20260829040000 would
-- silently miss it. This migration is self-sufficient for every property it introduces.
--
-- WHAT THIS DELIVERS
--
-- 1. blockchain_events.operation_id — the durable identity of the LOGICAL OPERATION that
--    produced the row, supplied by the calling service from an identity that already
--    exists in its own committed state (a parts log id, an insurance policy id, a finance
--    application id, a police report number). It therefore survives a successful commit,
--    a lost HTTP/RPC response, a caller crash and a process restart: a fresh retry
--    recomputes the SAME operation id, while a genuinely new invocation cannot.
--
-- 2. uq_blockchain_events_terminal_operation — at the terminal instant an operation
--    identity may be consumed AT MOST ONCE. Combined with the existing per-signer index
--    from 20260829040000, the terminal instant now admits at most one event per signer
--    AND at most one event per operation.
--
-- 3. blockchain_events_terminal_requires_operation — at the terminal instant a row may
--    not exist without an operation identity. This is what makes the runtime's refusal
--    total rather than best-effort: there is no representable terminal row whose
--    provenance cannot be decided.
--
-- WHAT THIS DELIBERATELY DOES NOT CLAIM
--
-- * operation_id is NOT part of calculateHash() and is NOT covered by the event
--   signature. It cannot be: the hash pre-image is fixed by every historical event and
--   changing it would invalidate the entire published chain. operation_id is an
--   idempotency identity, not a truth claim. It is safe in that role because the runtime
--   never returns a matched row without ALSO proving signer, VIN, event type and
--   persisted payload equality; an attacker able to write operation_id directly already
--   has ledger write access and is outside this control's threat model.
--
-- * No claim is made about non-terminal same-VIN append serialization. The uniqueness
--   index and the CHECK are both scoped to the terminal instant only, exactly like
--   20260829040000. Non-terminal rows may carry an operation_id for auditability, and
--   the runtime records one whenever the caller has a durable identity, but no
--   uniqueness or idempotency guarantee is asserted for them here.
--
-- UPGRADE BEHAVIOUR, STATED HONESTLY
--
-- A terminal row written BEFORE this migration has no recorded operation identity. Such a
-- row is backfilled to 'legacy-unidentified:<current_hash>', which no runtime caller can
-- ever reproduce. A lost-response retry that straddles this upgrade is therefore REFUSED
-- rather than acknowledged. That is the intended fail-closed direction: the pre-migration
-- row genuinely cannot be proven to be the same invocation.
--
-- The backfill is guarded by an existence check. Terminal rows only arise at custody
-- clock saturation (year 9999), so in every realistic database the UPDATE is skipped
-- entirely and the CHECK validates against an unchanged table.
--
-- OPERATIONAL NOTE — lock cost, stated honestly:
-- ADD COLUMN ... NULL is a catalog-only change in PostgreSQL 11+ and does not rewrite the
-- table. The partial unique index still requires one scan of public.blockchain_events
-- under a lock that blocks concurrent writes to that table, and ADD CONSTRAINT ... NOT
-- VALID followed by VALIDATE CONSTRAINT takes a SHARE UPDATE EXCLUSIVE lock for a second
-- scan. CREATE INDEX CONCURRENTLY is deliberately NOT used because it cannot run inside a
-- transaction block and this repository's migration runner applies each migration
-- transactionally. Apply this inside the same protected Issue #158 maintenance window as
-- 20260829040000, with old writers drained.
-- =============================================================================

DO $pre$
BEGIN
  IF to_regclass('public.blockchain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-158] public.blockchain_events is absent';
  END IF;
  -- Fail closed rather than silently establishing half of the terminal contract: the
  -- per-signer terminal index from 20260829040000 is a prerequisite, not an optional peer.
  IF to_regclass('public.uq_blockchain_events_terminal_signer') IS NULL THEN
    RAISE EXCEPTION
      '[issue-158] terminal uniqueness migration (20260829040000) must be applied first';
  END IF;
END
$pre$;

ALTER TABLE public.blockchain_events
  ADD COLUMN IF NOT EXISTS operation_id TEXT;

COMMENT ON COLUMN public.blockchain_events.operation_id IS
  'Durable identity of the logical operation that produced this event, supplied by the '
  'writing service from its own committed state. Idempotency identity only: it is not '
  'part of the event hash pre-image and is not covered by the signature.';

-- Legacy terminal rows predate the identity contract. Give them an identity no runtime
-- caller can reproduce so a straddling retry is refused, never silently acknowledged.
DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.blockchain_events
     WHERE "timestamp" = '9999-12-31T23:59:59.999Z'
       AND operation_id IS NULL
  ) THEN
    UPDATE public.blockchain_events
       SET operation_id = 'legacy-unidentified:' || coalesce(current_hash, id::text)
     WHERE "timestamp" = '9999-12-31T23:59:59.999Z'
       AND operation_id IS NULL;
  END IF;
END
$backfill$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_blockchain_events_terminal_operation
  ON public.blockchain_events (operation_id)
  WHERE "timestamp" = '9999-12-31T23:59:59.999Z'
    AND operation_id IS NOT NULL;

DO $require$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.blockchain_events'::regclass
       AND conname = 'blockchain_events_terminal_requires_operation'
  ) THEN
    ALTER TABLE public.blockchain_events
      ADD CONSTRAINT blockchain_events_terminal_requires_operation
      CHECK ("timestamp" <> '9999-12-31T23:59:59.999Z' OR operation_id IS NOT NULL)
      NOT VALID;
    ALTER TABLE public.blockchain_events
      VALIDATE CONSTRAINT blockchain_events_terminal_requires_operation;
  END IF;
END
$require$;

-- The runtime writes this column through the same service_role path it already uses for
-- the rest of the row. Where a deployment has narrowed blockchain_events to column-level
-- privileges, the new column must be granted explicitly; where the table-level grant is
-- still in force this is a no-op re-grant rather than a privilege widening.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT (operation_id), INSERT (operation_id) '
         || 'ON TABLE public.blockchain_events TO service_role';
  END IF;
END
$grants$;

-- +migrate Down
-- Forward-only security boundary. Dropping operation_id would re-open terminal retry
-- misclassification, and dropping the CHECK would admit terminal rows whose provenance
-- cannot be decided. Do not reverse this migration.
