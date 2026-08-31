-- ISSUE #158 — PROTECTED PRIVATE-KEY CUSTODY FINALIZER
--
-- DO NOT run as part of ordinary automatic migrations.
-- Preconditions:
--   1. 20260828210000_issue158_private_key_custody.sql is applied;
--   2. the new runtime is fully deployed;
--   3. every old runtime writer has been drained;
--   4. issue158_mark_old_writers_drained.sql has recorded that operator assertion.
--
-- This transaction is intentionally destructive to prohibited secret material only.

BEGIN;

LOCK TABLE public.public_keys IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  v_state TEXT;
  v_drained BOOLEAN;
  v_generation TEXT;
  v_superseded OID;
BEGIN
  IF to_regclass('public.blockchain_custody_rollout') IS NULL THEN
    RAISE EXCEPTION '[issue-158] custody PREPARED migration is absent';
  END IF;

  -- FINALIZED is what enables key activation at all. Reaching it while the
  -- boundary-hardening contract is absent would leave the superseded caller-clock
  -- contract as the service-role authority, so an intermediate runtime could sign
  -- under ambiguous validity boundaries. Refuse the ordering hole outright.
  IF to_regclass('public.blockchain_signing_watermarks') IS NULL THEN
    RAISE EXCEPTION
      '[issue-158] refusing custody finalization: boundary-hardening migration is absent'
      USING ERRCODE='55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname='blockchain_activate_public_key_boundary'
  ) THEN
    RAISE EXCEPTION
      '[issue-158] refusing custody finalization: boundary-hardening migration is absent'
      USING ERRCODE='55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname='blockchain_reseed_signing_watermarks'
  ) THEN
    RAISE EXCEPTION
      '[issue-158] refusing custody finalization: boundary-hardening migration is absent'
      USING ERRCODE='55000';
  END IF;

  -- FINALIZED enables key activation, and activation may re-issue the terminal instant
  -- so a lost-response retry can reach conflict classification. That is only safe while
  -- the ledger admits at most one terminal event per signer, so a fresh rollout must not
  -- reach FINALIZED without the terminal uniqueness invariant present.
  IF to_regclass('public.blockchain_events') IS NOT NULL
     AND to_regclass('public.uq_blockchain_events_terminal_signer') IS NULL THEN
    RAISE EXCEPTION
      '[issue-158] refusing custody finalization: terminal ledger uniqueness invariant is absent'
      USING ERRCODE='55000';
  END IF;

  -- Terminal conflict classification is safe only after the durable operation identity
  -- migration is present. A content-equality-only runtime can acknowledge a genuinely
  -- independent event as a retry, so FINALIZED must not become reachable without the
  -- persisted identity, its required-at-terminal constraint and its signer-scoped
  -- uniqueness guard.
  IF to_regclass('public.blockchain_events') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM pg_attribute
       WHERE attrelid='public.blockchain_events'::regclass
         AND attname='operation_id'
         AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION
        '[issue-158] refusing custody finalization: durable terminal operation identity migration is absent'
        USING ERRCODE='55000';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conrelid='public.blockchain_events'::regclass
         AND conname='blockchain_events_terminal_operation_id_required'
         AND convalidated
    ) THEN
      RAISE EXCEPTION
        '[issue-158] refusing custody finalization: terminal operation identity constraint is absent or unvalidated'
        USING ERRCODE='55000';
    END IF;

    IF to_regclass('public.uq_blockchain_events_signer_operation_id') IS NULL THEN
      RAISE EXCEPTION
        '[issue-158] refusing custody finalization: signer operation identity uniqueness invariant is absent'
        USING ERRCODE='55000';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.blockchain_events
       WHERE "timestamp"='9999-12-31T23:59:59.999Z'
         AND nullif(btrim(operation_id),'') IS NULL
    ) THEN
      RAISE EXCEPTION
        '[issue-158] refusing custody finalization: terminal ledger row lacks durable operation identity'
        USING ERRCODE='55000';
    END IF;
  END IF;

  -- The superseded caller-clock contracts must already be closed to the application
  -- role before any key activation becomes possible.
  FOR v_superseded IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname='blockchain_activate_public_key_atomic'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
       AND has_function_privilege('service_role',v_superseded,'EXECUTE') THEN
      RAISE EXCEPTION
        '[issue-158] refusing custody finalization: superseded caller-clock activation contract is still executable by service_role'
        USING ERRCODE='55000';
    END IF;
  END LOOP;

  SELECT state,old_writers_drained,authorized_generation
    INTO v_state,v_drained,v_generation
    FROM public.blockchain_custody_rollout
   WHERE singleton=TRUE
   FOR UPDATE;

  IF v_state IS DISTINCT FROM 'PREPARED' THEN
    RAISE EXCEPTION '[issue-158] custody finalizer requires PREPARED state, got %',v_state;
  END IF;

  IF v_drained IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      '[issue-158] refusing custody finalization until old runtime writers are explicitly marked drained'
      USING ERRCODE='55000';
  END IF;

  IF nullif(btrim(v_generation),'') IS NULL THEN
    RAISE EXCEPTION
      '[issue-158] refusing custody finalization until a custody generation is owner-authorized'
      USING ERRCODE='55000';
  END IF;
END
$pre$;

-- POST-DRAIN WATERMARK RESEED — must precede FINALIZED becoming reachable.
--
-- The PREPARED window deliberately keeps legacy runtimes alive until this point. A
-- legacy runtime appends stakeholder ledger events from its own caller clock while
-- REUSING its existing ACTIVE key, so such an event moves no key edge and is invisible
-- to both the upgrade-time bootstrap (already run) and the per-call key floor. Without
-- this reseed the first post-finalization rotation could choose a boundary before that
-- late event and retroactively exclude it from the old key's half-open interval.
--
-- Old writers are asserted drained above, so this is the last moment a forward-clock
-- event can exist; the reseed locks the ledger while it scans.
DO $reseed$
BEGIN
  PERFORM public.blockchain_reseed_signing_watermarks();
END
$reseed$;

-- Public verification history remains. Only prohibited private material is erased.
UPDATE public.public_keys
   SET private_key_pem=NULL
 WHERE private_key_pem IS NOT NULL;

ALTER TABLE public.public_keys
  DROP CONSTRAINT IF EXISTS public_keys_private_material_absent;
ALTER TABLE public.public_keys
  ADD CONSTRAINT public_keys_private_material_absent
  CHECK (private_key_pem IS NULL);

-- New runtime performs every key mutation through the SECURITY DEFINER atomic RPC.
-- Removing direct service-role writes also prevents a stale old runtime from revoking
-- the active key and then failing its now-prohibited private-key insert.
REVOKE SELECT,INSERT,UPDATE,DELETE ON TABLE public.public_keys FROM service_role;
GRANT SELECT (
  id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
  key_ref,key_version,custody_provider
) ON public.public_keys TO service_role;

REVOKE ALL ON TABLE public.public_keys FROM anon,authenticated;
ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;

UPDATE public.blockchain_custody_rollout
   SET state='FINALIZED',
       finalized_at=clock_timestamp()
 WHERE singleton=TRUE;

COMMIT;
