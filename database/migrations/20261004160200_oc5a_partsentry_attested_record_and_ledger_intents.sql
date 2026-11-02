-- +migrate Up
-- OC-5A (RC1 residual findings A and D) — one commit boundary for a PartSentry record, and a durable
-- intent for its ledger event.
--
-- FINDING D. addRepairLog wrote the log, then moved vehicles.mileage, then asked the ledger to record
-- the event — three separate writes. When the ledger refused (for example, custody rollout not
-- FINALIZED) the caller was told the request FAILED while the log and the odometer had already
-- changed for good, and the five-minute duplicate guard then rejected the retry. Now:
--   * partsentry_record_service() makes the domain mutation in ONE transaction: the log, the odometer
--     (only when the record is a governed mechanic service — see below), and a ledger_event_intents row;
--   * the ledger write happens afterwards, from the intent, through the ONE canonical ledger writer
--     (blockchainService.addEvent) — inline after commit, again on a retry of the same request, and from
--     the worker-secret drain route. The intent is marked recorded only after the event exists, and the
--     drain looks for the event (its payload carries ledgerIntentId) before writing, so a crash between
--     the ledger write and the mark cannot produce a second event.
-- A caller therefore never hears "failed" for a record that was kept, and a kept record never loses its
-- audit intent: it is either recorded on the ledger or visibly pending in ledger_event_intents.
--
-- FINDING A. Each record now says who stands behind it (attestation). Only a 'mechanic_service' record
-- — a mechanic under an owner-authorized work order of a service organisation they verifiably belong
-- to — moves the canonical odometer. An owner's own entry is 'owner_stated', and is never labelled or
-- ledgered as a mechanic inspection. Rows written before this migration are 'legacy_unattested' with
-- odometer_applied NULL (the old writer always moved the odometer; NULL records that it was never
-- attested, rather than inventing a value).
--
-- The new columns are repair FACTS. The OC-4A history guard candidate
-- (database/migration-candidates/oc4a/) protects every column outside its six governed review fields,
-- so these are immutable once written wherever that guard is applied — which is why the ledger state
-- lives in ledger_event_intents and never on the log row.
--
-- Preconditions: partsentry_logs (supabase_schema.sql) with tenant_id (002), vehicles, mechanic_work_orders
-- with owner_authorization (20261004160100).

DO $$
BEGIN
  IF to_regclass('public.partsentry_logs') IS NULL OR to_regclass('public.vehicles') IS NULL THEN
    RAISE EXCEPTION 'partsentry_logs and vehicles must exist before the attested PartSentry record';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'mechanic_work_orders' AND column_name = 'owner_authorization') THEN
    RAISE EXCEPTION 'mechanic_work_orders.owner_authorization is absent: apply 20261004160100 first';
  END IF;
END $$;

-- ── partsentry_logs: who stands behind the record ─────────────────────────────────────────────────
ALTER TABLE public.partsentry_logs ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE public.partsentry_logs ADD COLUMN IF NOT EXISTS attestation TEXT NOT NULL DEFAULT 'legacy_unattested';
ALTER TABLE public.partsentry_logs ADD COLUMN IF NOT EXISTS work_order_id UUID;
ALTER TABLE public.partsentry_logs ADD COLUMN IF NOT EXISTS odometer_applied BOOLEAN;
ALTER TABLE public.partsentry_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partsentry_logs_attestation_check'
                   AND conrelid = 'public.partsentry_logs'::regclass) THEN
    ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_attestation_check
      CHECK (attestation IN ('mechanic_service', 'dealer_recorded', 'owner_stated', 'seller_stated',
                             'platform_recorded', 'legacy_unattested'));
  END IF;
  -- Only a governed mechanic service moves the canonical odometer; a legacy row records that it was
  -- never attested (NULL) instead of a guessed value.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partsentry_logs_odometer_attestation'
                   AND conrelid = 'public.partsentry_logs'::regclass) THEN
    ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_odometer_attestation
      CHECK ((attestation = 'legacy_unattested' AND odometer_applied IS NULL)
          OR (attestation <> 'legacy_unattested' AND odometer_applied = (attestation = 'mechanic_service')));
  END IF;
  -- A mechanic service is done under a work order, and names it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partsentry_logs_service_names_work_order'
                   AND conrelid = 'public.partsentry_logs'::regclass) THEN
    ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_service_names_work_order
      CHECK (attestation <> 'mechanic_service' OR work_order_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partsentry_logs_work_order_fkey'
                   AND conrelid = 'public.partsentry_logs'::regclass) THEN
    ALTER TABLE public.partsentry_logs ADD CONSTRAINT partsentry_logs_work_order_fkey
      FOREIGN KEY (work_order_id) REFERENCES public.mechanic_work_orders(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- One record per (actor, client idempotency key): a retried request can never create a second record.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partsentry_logs_actor_idempotency_key
  ON public.partsentry_logs (mechanic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.partsentry_logs.attestation IS
  'Who stands behind this record: mechanic_service (a mechanic under an owner-authorized work order; the only '
  'class that moves vehicles.mileage) | dealer_recorded | owner_stated | seller_stated | platform_recorded | '
  'legacy_unattested (written before OC-5A). mechanic_id holds the recording actor for every class.';

-- ── the durable ledger intent ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_event_intents (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  vin TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signer_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recording', 'recorded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ledger_event_id BIGINT,
  recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_event_intents_source_unique UNIQUE (source, source_id),
  CONSTRAINT ledger_event_intents_operation_unique UNIQUE (operation_id),
  CONSTRAINT ledger_event_intents_recorded_names_event
    CHECK ((status = 'recorded') = (ledger_event_id IS NOT NULL AND recorded_at IS NOT NULL)),
  CONSTRAINT ledger_event_intents_claim_shape
    CHECK ((status = 'recording') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ledger_event_intents_due
  ON public.ledger_event_intents (next_attempt_at, created_at) WHERE status <> 'recorded';
CREATE INDEX IF NOT EXISTS idx_ledger_event_intents_vin ON public.ledger_event_intents (vin);

ALTER TABLE public.ledger_event_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_event_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ledger_event_intents FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_event_intents FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_event_intents FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- No DELETE: an intent is never removed, only recorded.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_event_intents TO service_role';
  END IF;
END $$;

COMMENT ON TABLE public.ledger_event_intents IS
  'Durable intent to record one domain event on the hash-chained ledger through the canonical writer '
  '(blockchainService.addEvent). Written in the same transaction as the domain mutation; recorded afterwards '
  '(inline, on retry, or by the worker drain). status=recorded names the ledger event. Never deleted.';

-- ── the one commit boundary for a PartSentry record ────────────────────────────────────────────────
-- Authority is decided by the caller (partsentryServiceAuthority.js) BEFORE this runs; this function
-- enforces what the database can know for certain: the attestation vocabulary, the odometer rule, the
-- single-writer lock on the vehicle, idempotent replay, and that the record, the odometer and the
-- ledger intent commit together or not at all.
CREATE OR REPLACE FUNCTION public.partsentry_record_service(
  p_vin TEXT,
  p_actor_id TEXT,
  p_attestation TEXT,
  p_work_order_id UUID,
  p_tenant_id UUID,
  p_part_name TEXT,
  p_part_oem TEXT,
  p_action_type TEXT,
  p_description TEXT,
  p_mileage INTEGER,
  p_signature TEXT,
  p_timestamp TEXT,
  p_idempotency_key TEXT,
  p_ledger_event_type TEXT,
  p_ledger_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical_mileage INTEGER;
  v_existing public.partsentry_logs%ROWTYPE;
  v_found BOOLEAN := false;
  v_log public.partsentry_logs%ROWTYPE;
  v_intent public.ledger_event_intents%ROWTYPE;
  v_intent_id UUID := gen_random_uuid();
  v_apply BOOLEAN;
BEGIN
  IF p_attestation IS NULL OR p_attestation NOT IN ('mechanic_service', 'dealer_recorded', 'owner_stated', 'seller_stated', 'platform_recorded') THEN
    RAISE EXCEPTION 'partsentry: % is not a recordable attestation', coalesce(p_attestation, 'NULL') USING ERRCODE = '22023';
  END IF;
  IF p_mileage IS NULL OR p_mileage < 0 THEN
    RAISE EXCEPTION 'A valid odometer reading is required to record a repair.' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'partsentry: a record needs an actor' USING ERRCODE = '22023';
  END IF;
  IF p_ledger_event_type IS NULL OR btrim(p_ledger_event_type) = '' THEN
    RAISE EXCEPTION 'partsentry: a record needs its ledger event type' USING ERRCODE = '22023';
  END IF;
  IF p_attestation = 'mechanic_service' AND p_work_order_id IS NULL THEN
    RAISE EXCEPTION 'partsentry: a mechanic service names its work order' USING ERRCODE = '22023';
  END IF;
  v_apply := (p_attestation = 'mechanic_service');

  -- Every write for this vehicle is serialized from here: the replay check, the odometer comparison
  -- and the odometer write all happen under this row lock.
  SELECT mileage INTO v_canonical_mileage FROM public.vehicles WHERE vin = p_vin FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Replay. With a client key, the key decides. Without one (older clients), the same actor recording
  -- the same part at the same reading within five minutes is the same request — a lost response
  -- retried — and gets the original record back instead of a refusal.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.partsentry_logs
     WHERE mechanic_id = p_actor_id AND idempotency_key = p_idempotency_key;
    v_found := FOUND;
    IF v_found AND (v_existing.vin IS DISTINCT FROM p_vin OR v_existing.part_name IS DISTINCT FROM p_part_name
        OR v_existing.mileage IS DISTINCT FROM p_mileage OR v_existing.action_type IS DISTINCT FROM p_action_type
        OR v_existing.attestation IS DISTINCT FROM p_attestation) THEN
      RAISE EXCEPTION 'partsentry: this idempotency key already names a different record' USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT * INTO v_existing FROM public.partsentry_logs
     WHERE vin = p_vin AND mechanic_id = p_actor_id AND part_name = p_part_name AND mileage = p_mileage
       AND attestation = p_attestation AND created_at > now() - interval '5 minutes'
     ORDER BY id DESC LIMIT 1;
    v_found := FOUND;
  END IF;

  IF v_found THEN
    SELECT * INTO v_intent FROM public.ledger_event_intents
     WHERE source = 'partsentry_logs' AND source_id = v_existing.id::text;
    RETURN jsonb_build_object('replayed', true, 'log', to_jsonb(v_existing),
                              'intent', CASE WHEN FOUND THEN to_jsonb(v_intent) ELSE NULL END);
  END IF;

  -- An odometer reading is never below the canonical odometer — for every class, as before. Only a
  -- mechanic service then MOVES it.
  IF v_canonical_mileage IS NOT NULL AND p_mileage < v_canonical_mileage THEN
    RAISE EXCEPTION 'Mileage verification failure. Recorded mileage % km cannot be lower than vehicle current odometer % km.',
      p_mileage, v_canonical_mileage USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.partsentry_logs
    (vin, mechanic_id, part_name, part_oem, action_type, description, mileage, signature, timestamp, tenant_id,
     attestation, work_order_id, odometer_applied, idempotency_key)
  VALUES
    (p_vin, p_actor_id, p_part_name, p_part_oem, p_action_type, p_description, p_mileage, p_signature, p_timestamp, p_tenant_id,
     p_attestation, p_work_order_id, v_apply, p_idempotency_key)
  RETURNING * INTO v_log;

  IF v_apply THEN
    UPDATE public.vehicles SET mileage = p_mileage WHERE vin = p_vin;
  END IF;

  INSERT INTO public.ledger_event_intents (id, source, source_id, vin, event_type, payload, signer_id, operation_id)
  VALUES (v_intent_id, 'partsentry_logs', v_log.id::text, p_vin, p_ledger_event_type,
          coalesce(p_ledger_payload, '{}'::jsonb) || jsonb_build_object('logId', v_log.id, 'ledgerIntentId', v_intent_id),
          p_actor_id, 'partsentry_log:' || v_log.id::text)
  RETURNING * INTO v_intent;

  RETURN jsonb_build_object('replayed', false, 'log', to_jsonb(v_log), 'intent', to_jsonb(v_intent));
END;
$$;

-- ── claiming intents for recording ─────────────────────────────────────────────────────────────────
-- Exclusive by construction: a row is claimed by one caller (SKIP LOCKED + the status change). A claim
-- older than p_stale_after_seconds belongs to a caller that died; it may be re-claimed, and the drain
-- looks for the event before writing, so a re-claim after a crash cannot duplicate it. The stale window
-- must exceed the longest function invocation (Vercel caps a serverless invocation well below 900 s).
-- A named intent (p_intent_id: the inline drain, or a client retry) ignores the retry backoff.
CREATE OR REPLACE FUNCTION public.ledger_event_intents_claim(
  p_claim_token UUID,
  p_limit INTEGER DEFAULT 10,
  p_intent_id UUID DEFAULT NULL,
  p_stale_after_seconds INTEGER DEFAULT 900
) RETURNS SETOF public.ledger_event_intents
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  UPDATE public.ledger_event_intents AS i
     SET status = 'recording', claim_token = p_claim_token, claimed_at = now(), attempts = i.attempts + 1
   WHERE i.id IN (
     SELECT c.id FROM public.ledger_event_intents AS c
      WHERE ((c.status = 'pending' AND (p_intent_id IS NOT NULL OR c.next_attempt_at <= now()))
          OR (c.status = 'recording' AND c.claimed_at < now() - make_interval(secs => GREATEST(coalesce(p_stale_after_seconds, 900), 60))))
        AND (p_intent_id IS NULL OR c.id = p_intent_id)
      ORDER BY c.created_at, c.id
      LIMIT GREATEST(LEAST(coalesce(p_limit, 10), 100), 1)
      FOR UPDATE SKIP LOCKED)
  RETURNING i.*;
$$;

DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.partsentry_record_service(TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, JSONB)',
    'public.ledger_event_intents_claim(UUID, INTEGER, UUID, INTEGER)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
  END LOOP;
END $$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.ledger_event_intents_claim(UUID, INTEGER, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.partsentry_record_service(TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP TABLE IF EXISTS public.ledger_event_intents;
DROP INDEX IF EXISTS public.uq_partsentry_logs_actor_idempotency_key;
ALTER TABLE public.partsentry_logs DROP CONSTRAINT IF EXISTS partsentry_logs_work_order_fkey;
ALTER TABLE public.partsentry_logs DROP CONSTRAINT IF EXISTS partsentry_logs_service_names_work_order;
ALTER TABLE public.partsentry_logs DROP CONSTRAINT IF EXISTS partsentry_logs_odometer_attestation;
ALTER TABLE public.partsentry_logs DROP CONSTRAINT IF EXISTS partsentry_logs_attestation_check;
ALTER TABLE public.partsentry_logs DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE public.partsentry_logs DROP COLUMN IF EXISTS odometer_applied;
ALTER TABLE public.partsentry_logs DROP COLUMN IF EXISTS work_order_id;
ALTER TABLE public.partsentry_logs DROP COLUMN IF EXISTS attestation;
