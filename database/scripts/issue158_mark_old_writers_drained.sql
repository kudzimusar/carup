-- ISSUE #158 — OPERATOR ASSERTION: OLD BLOCKCHAIN WRITERS DRAINED
--
-- Protected/manual step only. Run this after the deployment platform proves that no
-- pre-custody runtime instance can write blockchain events or public_keys anymore.
-- The finalizer refuses to run until this assertion exists.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.blockchain_custody_rollout') IS NULL THEN
    RAISE EXCEPTION '[issue-158] custody PREPARED migration is absent';
  END IF;
END
$pre$;

UPDATE public.blockchain_custody_rollout
   SET old_writers_drained=TRUE
 WHERE singleton=TRUE
   AND state='PREPARED';

DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.blockchain_custody_rollout
     WHERE singleton=TRUE
       AND state='PREPARED'
       AND old_writers_drained=TRUE
  ) THEN
    RAISE EXCEPTION '[issue-158] could not record old-writer drain assertion';
  END IF;
END
$post$;

COMMIT;
