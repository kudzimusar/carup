-- +migrate Up
-- =====================================================================================================
-- OC-3D CANDIDATE — NOT APPLIED ANYWHERE (see 20261004130000 for the promotion rule).
--
-- 1. Fork guard. Both ledger writers read the chain tail and then insert; two concurrent writers can
--    therefore append two events with the SAME previous_hash, and verifyChain then reports that VIN
--    as broken forever. A unique (vin, previous_hash) makes the second insert fail (and retry) instead.
-- 2. Retention. blockchain_events.vin and evidence_provenance_events.evidence_id were ON DELETE CASCADE:
--    deleting a vehicle (or an evidence row) erased its audit history. Both become RESTRICT. (The
--    provenance row triggers already block the cascaded delete; this makes the FK say so.)
-- Every step refuses rather than guesses when the data would make it unsafe.
-- =====================================================================================================

DO $$
DECLARE
  v_forks bigint;
BEGIN
  SELECT count(*) INTO v_forks
    FROM (SELECT vin, previous_hash FROM public.blockchain_events GROUP BY vin, previous_hash HAVING count(*) > 1) f;
  IF v_forks > 0 THEN
    RAISE EXCEPTION '[oc-3d] % forked chain link(s) already exist in blockchain_events — reconcile them before the fork guard; refusing.', v_forks;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_blockchain_events_vin_previous_hash
  ON public.blockchain_events (vin, previous_hash);

-- Replace whichever FK points at vehicles / vehicle_evidence (names are not assumed).
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.blockchain_events'::regclass AND contype = 'f'
       AND confrelid = 'public.vehicles'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.blockchain_events DROP CONSTRAINT %I', v_name);
  END LOOP;
  ALTER TABLE public.blockchain_events
    ADD CONSTRAINT blockchain_events_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE RESTRICT;

  FOR v_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.evidence_provenance_events'::regclass AND contype = 'f'
       AND confrelid = 'public.vehicle_evidence'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.evidence_provenance_events DROP CONSTRAINT %I', v_name);
  END LOOP;
  ALTER TABLE public.evidence_provenance_events
    ADD CONSTRAINT evidence_provenance_events_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.vehicle_evidence(id) ON DELETE RESTRICT;
END $$;

-- +migrate Down
ALTER TABLE public.evidence_provenance_events DROP CONSTRAINT IF EXISTS evidence_provenance_events_evidence_id_fkey;
ALTER TABLE public.evidence_provenance_events
  ADD CONSTRAINT evidence_provenance_events_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.vehicle_evidence(id) ON DELETE CASCADE;
ALTER TABLE public.blockchain_events DROP CONSTRAINT IF EXISTS blockchain_events_vin_fkey;
ALTER TABLE public.blockchain_events
  ADD CONSTRAINT blockchain_events_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE;
DROP INDEX IF EXISTS public.uq_blockchain_events_vin_previous_hash;
