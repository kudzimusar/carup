-- +migrate Up
-- =============================================================================
-- VEHICLE PASSPORT V7/V16 — GOVERNED OWNERSHIP TRANSFER AUTHORITY
--
-- Adds the missing operational transfer writer beneath the already-certified V7
-- state/read-model contracts. A sale/payment state is NOT ownership proof.
-- Completion is atomic: transfer state + vehicle owner + ownership history + audit event.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_ownership_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE RESTRICT,
  previous_owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  incoming_owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  tenant_id TEXT,
  state TEXT NOT NULL DEFAULT 'initiated'
    CHECK (state IN (
      'initiated','awaiting_parties','evidence_required','under_review',
      'transaction_complete','registry_pending','complete','disputed','cancelled'
    )),
  idempotency_key TEXT NOT NULL UNIQUE,
  initiated_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  registry_authority TEXT,
  completion_reference TEXT,
  completed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (previous_owner_id <> incoming_owner_id),
  CHECK ((state = 'complete') = (completed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_ownership_transfer_active_vin
  ON public.vehicle_ownership_transfers(vin)
  WHERE state NOT IN ('complete','cancelled');

CREATE INDEX IF NOT EXISTS idx_vehicle_ownership_transfers_incoming
  ON public.vehicle_ownership_transfers(incoming_owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_ownership_transfer_events (
  id BIGSERIAL PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES public.vehicle_ownership_transfers(id) ON DELETE RESTRICT,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_ownership_transfer_events_transfer
  ON public.vehicle_ownership_transfer_events(transfer_id, created_at ASC, id ASC);

ALTER TABLE public.vehicle_ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_ownership_transfer_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_ownership_transfers FROM anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_ownership_transfer_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_ownership_transfers TO service_role;
GRANT SELECT, INSERT ON TABLE public.vehicle_ownership_transfer_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vehicle_ownership_transfer_events_id_seq TO service_role;

ALTER TABLE public.vehicle_ownership_history
  ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES public.vehicle_ownership_transfers(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_ownership_history_transfer
  ON public.vehicle_ownership_history(transfer_id)
  WHERE transfer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.passport_begin_ownership_transfer_atomic(
  p_vin TEXT,
  p_incoming_owner_id TEXT,
  p_actor_id TEXT,
  p_actor_role TEXT,
  p_idempotency_key TEXT
)
RETURNS public.vehicle_ownership_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $begin$
DECLARE
  v_vehicle public.vehicles%ROWTYPE;
  v_existing public.vehicle_ownership_transfers%ROWTYPE;
  v_created public.vehicle_ownership_transfers%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_privileged BOOLEAN := lower(coalesce(p_actor_role,'')) IN ('admin','government','reviewer','platform_admin','super_admin');
BEGIN
  IF nullif(btrim(p_vin),'') IS NULL
     OR nullif(btrim(p_incoming_owner_id),'') IS NULL
     OR nullif(btrim(p_actor_id),'') IS NULL
     OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'complete transfer identity is required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_vehicle
    FROM public.vehicles
   WHERE vin=p_vin
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle not found' USING ERRCODE='P0002'; END IF;
  IF nullif(btrim(v_vehicle.owner_id),'') IS NULL THEN
    RAISE EXCEPTION 'governed current owner is required before transfer' USING ERRCODE='23514';
  END IF;
  IF v_vehicle.owner_id = p_incoming_owner_id THEN
    RAISE EXCEPTION 'incoming owner already owns this vehicle' USING ERRCODE='23514';
  END IF;
  IF p_actor_id <> v_vehicle.owner_id AND NOT v_privileged THEN
    RAISE EXCEPTION 'only current owner or governance may initiate transfer' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_existing
    FROM public.vehicle_ownership_transfers
   WHERE idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.vin IS DISTINCT FROM p_vin
       OR v_existing.incoming_owner_id IS DISTINCT FROM p_incoming_owner_id
       OR v_existing.previous_owner_id IS DISTINCT FROM v_vehicle.owner_id THEN
      RAISE EXCEPTION 'idempotency key is bound to different transfer truth' USING ERRCODE='23505';
    END IF;
    RETURN v_existing;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_ownership_transfers
     WHERE vin=p_vin AND state NOT IN ('complete','cancelled')
  ) THEN
    RAISE EXCEPTION 'an active ownership transfer already exists for this vehicle' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.vehicle_ownership_transfers(
    vin,previous_owner_id,incoming_owner_id,tenant_id,state,idempotency_key,initiated_by,created_at,updated_at
  ) VALUES(
    p_vin,v_vehicle.owner_id,p_incoming_owner_id,v_vehicle.tenant_id,'initiated',
    p_idempotency_key,p_actor_id,v_now,v_now
  ) RETURNING * INTO v_created;

  INSERT INTO public.vehicle_ownership_transfer_events(
    transfer_id,from_state,to_state,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_created.id,NULL,'initiated',p_actor_id,p_actor_role,'ownership_transfer_started',
    jsonb_build_object('vin',p_vin,'incoming_owner_id',p_incoming_owner_id),v_now
  );

  IF to_regclass('public.domain_events') IS NOT NULL THEN
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES(
      'vehicle.ownership.transfer_started',
      jsonb_build_object(
        'transferId',v_created.id,
        'vin',p_vin,
        'recipientUserId',p_incoming_owner_id,
        'previousOwnerId',v_vehicle.owner_id,
        'incomingOwnerId',p_incoming_owner_id,
        'subject_type','vehicle',
        'subject_id',p_vin
      ),
      'pending',0,v_vehicle.tenant_id
    );
  END IF;

  RETURN v_created;
END
$begin$;

CREATE OR REPLACE FUNCTION public.passport_transition_ownership_transfer_atomic(
  p_transfer_id UUID,
  p_to_state TEXT,
  p_actor_id TEXT,
  p_actor_role TEXT,
  p_reason TEXT DEFAULT NULL,
  p_registry_authority TEXT DEFAULT NULL,
  p_completion_reference TEXT DEFAULT NULL
)
RETURNS public.vehicle_ownership_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $transition$
DECLARE
  v_transfer public.vehicle_ownership_transfers%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_privileged BOOLEAN := lower(coalesce(p_actor_role,'')) IN ('admin','government','reviewer','platform_admin','super_admin');
  v_allowed BOOLEAN := FALSE;
  v_event_type TEXT;
BEGIN
  IF p_transfer_id IS NULL OR nullif(btrim(p_to_state),'') IS NULL OR nullif(btrim(p_actor_id),'') IS NULL THEN
    RAISE EXCEPTION 'transfer id, target state and actor are required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_transfer
    FROM public.vehicle_ownership_transfers
   WHERE id=p_transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ownership transfer not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_vehicle
    FROM public.vehicles
   WHERE vin=v_transfer.vin
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle not found' USING ERRCODE='P0002'; END IF;

  IF p_actor_id NOT IN (v_transfer.previous_owner_id,v_transfer.incoming_owner_id) AND NOT v_privileged THEN
    RAISE EXCEPTION 'actor is not a transfer participant or governance reviewer' USING ERRCODE='42501';
  END IF;

  v_allowed := CASE v_transfer.state
    WHEN 'initiated' THEN p_to_state IN ('awaiting_parties','evidence_required','under_review','cancelled','disputed')
    WHEN 'awaiting_parties' THEN p_to_state IN ('evidence_required','under_review','cancelled','disputed')
    WHEN 'evidence_required' THEN p_to_state IN ('under_review','cancelled','disputed')
    WHEN 'under_review' THEN p_to_state IN ('transaction_complete','registry_pending','complete','evidence_required','disputed','cancelled')
    WHEN 'transaction_complete' THEN p_to_state IN ('registry_pending','complete','disputed')
    WHEN 'registry_pending' THEN p_to_state IN ('complete','disputed')
    WHEN 'complete' THEN p_to_state IN ('disputed')
    WHEN 'disputed' THEN p_to_state IN ('under_review','complete','cancelled')
    WHEN 'cancelled' THEN FALSE
    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'illegal ownership transfer transition: % -> %',v_transfer.state,p_to_state USING ERRCODE='23514';
  END IF;
  IF p_to_state='disputed' AND nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'ownership transfer dispute requires a reason' USING ERRCODE='22023';
  END IF;

  IF p_to_state='complete' THEN
    IF NOT v_privileged THEN
      RAISE EXCEPTION 'ownership transfer completion requires governance authority' USING ERRCODE='42501';
    END IF;
    IF nullif(btrim(p_registry_authority),'') IS NULL OR nullif(btrim(p_completion_reference),'') IS NULL THEN
      RAISE EXCEPTION 'ownership transfer completion requires governed authority and completion reference' USING ERRCODE='22023';
    END IF;
    IF v_vehicle.owner_id IS DISTINCT FROM v_transfer.previous_owner_id THEN
      RAISE EXCEPTION 'vehicle owner changed during transfer review' USING ERRCODE='40001';
    END IF;

    UPDATE public.vehicles
       SET owner_id=v_transfer.incoming_owner_id
     WHERE vin=v_transfer.vin;

    INSERT INTO public.vehicle_ownership_history(
      vin,previous_owner_id,new_owner_id,transfer_date,transfer_hash,transfer_id
    ) VALUES(
      v_transfer.vin,
      v_transfer.previous_owner_id,
      v_transfer.incoming_owner_id,
      v_now::text,
      md5(concat_ws('|',v_transfer.id::text,v_transfer.vin,v_transfer.previous_owner_id,v_transfer.incoming_owner_id,v_now::text,p_registry_authority,p_completion_reference)),
      v_transfer.id
    )
    ON CONFLICT (transfer_id) WHERE transfer_id IS NOT NULL DO NOTHING;
  END IF;

  UPDATE public.vehicle_ownership_transfers
     SET state=p_to_state,
         registry_authority=CASE WHEN p_to_state='complete' THEN btrim(p_registry_authority) ELSE registry_authority END,
         completion_reference=CASE WHEN p_to_state='complete' THEN btrim(p_completion_reference) ELSE completion_reference END,
         completed_at=CASE WHEN p_to_state='complete' THEN v_now ELSE NULL END,
         version=version+1,
         updated_at=v_now
   WHERE id=v_transfer.id
   RETURNING * INTO v_transfer;

  INSERT INTO public.vehicle_ownership_transfer_events(
    transfer_id,from_state,to_state,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_transfer.id,
    CASE WHEN v_transfer.version>1 THEN (
      SELECT from_state FROM (
        VALUES (NULL::text)
      ) AS ignored(from_state) LIMIT 1
    ) ELSE NULL END,
    p_to_state,p_actor_id,p_actor_role,p_reason,
    jsonb_build_object(
      'vin',v_transfer.vin,
      'registry_authority',CASE WHEN p_to_state='complete' THEN p_registry_authority ELSE NULL END,
      'completion_reference_present',p_completion_reference IS NOT NULL
    ),v_now
  );

  -- Correct the audit event's from_state using the pre-update state retained by PL/pgSQL.
  UPDATE public.vehicle_ownership_transfer_events
     SET from_state=(
       SELECT e.to_state
         FROM public.vehicle_ownership_transfer_events e
        WHERE e.transfer_id=v_transfer.id
          AND e.id < currval('public.vehicle_ownership_transfer_events_id_seq')
        ORDER BY e.id DESC
        LIMIT 1
     )
   WHERE id=currval('public.vehicle_ownership_transfer_events_id_seq');

  v_event_type := CASE
    WHEN p_to_state='complete' THEN 'vehicle.ownership.transfer_completed'
    WHEN p_to_state IN ('awaiting_parties','evidence_required','under_review','disputed') THEN 'vehicle.ownership.transfer_action_required'
    ELSE 'vehicle.ownership.transfer_state_changed'
  END;

  IF to_regclass('public.domain_events') IS NOT NULL THEN
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES(
      v_event_type,
      jsonb_build_object(
        'transferId',v_transfer.id,
        'vin',v_transfer.vin,
        'recipientUserId',CASE
          WHEN p_to_state='complete' THEN v_transfer.incoming_owner_id
          WHEN p_actor_id=v_transfer.previous_owner_id THEN v_transfer.incoming_owner_id
          ELSE v_transfer.previous_owner_id
        END,
        'previousOwnerId',v_transfer.previous_owner_id,
        'incomingOwnerId',v_transfer.incoming_owner_id,
        'transfer_state',p_to_state,
        'subject_type','vehicle',
        'subject_id',v_transfer.vin
      ),
      'pending',0,v_transfer.tenant_id
    );
  END IF;

  RETURN v_transfer;
END
$transition$;

REVOKE ALL ON FUNCTION public.passport_begin_ownership_transfer_atomic(TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.passport_begin_ownership_transfer_atomic(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.passport_transition_ownership_transfer_atomic(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.passport_transition_ownership_transfer_atomic(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

-- +migrate Down
-- Forward-only lifecycle authority. Ownership/transfer history must not be destroyed.
