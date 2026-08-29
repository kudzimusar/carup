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
BEGIN
  IF to_regclass('public.blockchain_custody_rollout') IS NULL THEN
    RAISE EXCEPTION '[issue-158] custody PREPARED migration is absent';
  END IF;

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
