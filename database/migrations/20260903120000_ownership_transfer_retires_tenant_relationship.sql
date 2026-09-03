-- +migrate Up
-- O2/P1 correction — a completed ownership transfer must also retire the dealer-organisation
-- relationship on the vehicle.
--
-- 20260828203000 introduced this function and correctly retired the previous Marketplace selling
-- authority on completion (current_seller_id / current_seller_type / current_seller_type_source).
-- It did NOT clear `vehicles.tenant_id`. Independent Product Owner review of O2 P1 found that this
-- one surviving column is the root cause of a whole class of former-seller authorization bypasses:
-- the expression `isOwner || isCurrentSeller || isDealerTenant` is repeated verbatim across eleven
-- authorization sites (vehicle status, publish/unpublish/price scoping, seller-draft edits, evidence
-- upload scope, evidence link-event, completeness disclosure, media upload + signed URLs x4, the
-- shared vehicleObjectAuthority middleware, and PartSentry writes). With `tenant_id` intact, a
-- dealer principal who sold their own vehicle retained every one of them.
--
-- This migration is a faithful CREATE OR REPLACE of the certified function with exactly one change:
-- `tenant_id=NULL` added to the first-completion UPDATE. It is generated from the 20260828203000
-- source rather than retyped, so no other line can have drifted. Forward-only: replacing a function
-- needs no data migration, and a dealer who genuinely re-lists the vehicle re-establishes tenant_id
-- through the ordinary listing path.

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
  v_from_state TEXT;
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

  -- Legal completion is a one-way authority boundary. Before completion, a
  -- dispute may return to review or be cancelled. After completed_at is set,
  -- the transfer enters a separate terminal subgraph: complete <-> disputed.
  -- A completed dispute may only be upheld back to complete (and the existing
  -- completion guard below requires governance). Any ownership reversal must
  -- be represented by a separate governed compensating transfer.
  IF v_transfer.completed_at IS NOT NULL THEN
    v_allowed := CASE v_transfer.state
      WHEN 'complete' THEN p_to_state='disputed'
      WHEN 'disputed' THEN p_to_state='complete'
      ELSE FALSE
    END;
  ELSE
    v_allowed := CASE v_transfer.state
      WHEN 'initiated' THEN p_to_state IN ('awaiting_parties','evidence_required','under_review','cancelled','disputed')
      WHEN 'awaiting_parties' THEN p_to_state IN ('evidence_required','under_review','cancelled','disputed')
      WHEN 'evidence_required' THEN p_to_state IN ('under_review','cancelled','disputed')
      WHEN 'under_review' THEN p_to_state IN ('transaction_complete','registry_pending','complete','evidence_required','disputed','cancelled')
      WHEN 'transaction_complete' THEN p_to_state IN ('registry_pending','complete','disputed')
      WHEN 'registry_pending' THEN p_to_state IN ('complete','disputed')
      WHEN 'complete' THEN FALSE
      WHEN 'disputed' THEN p_to_state IN ('under_review','complete','cancelled')
      WHEN 'cancelled' THEN FALSE
      ELSE FALSE
    END;
  END IF;

  IF NOT v_allowed THEN
    IF v_transfer.completed_at IS NOT NULL AND p_to_state='cancelled' THEN
      RAISE EXCEPTION 'completed ownership transfer cannot be cancelled; use governed reversal workflow'
        USING ERRCODE='23514';
    ELSIF v_transfer.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'completed ownership transfer cannot return to pre-completion state; use governed reversal workflow'
        USING ERRCODE='23514';
    END IF;
    RAISE EXCEPTION 'illegal ownership transfer transition: % -> %',v_transfer.state,p_to_state USING ERRCODE='23514';
  END IF;
  IF p_to_state='disputed' AND nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'ownership transfer dispute requires a reason' USING ERRCODE='22023';
  END IF;

  v_from_state := v_transfer.state;

  IF p_to_state='complete' THEN
    IF NOT v_privileged THEN
      RAISE EXCEPTION 'ownership transfer completion requires governance authority' USING ERRCODE='42501';
    END IF;
    IF nullif(btrim(p_registry_authority),'') IS NULL OR nullif(btrim(p_completion_reference),'') IS NULL THEN
      RAISE EXCEPTION 'ownership transfer completion requires governed authority and completion reference' USING ERRCODE='22023';
    END IF;

    -- First completion: the current owner must still be the transfer's previous owner.
    -- Re-affirming a previously completed transfer after a dispute is also valid: in
    -- that case the vehicle already belongs to the incoming owner and the immutable
    -- transfer-linked ownership-history row must already exist.
    IF v_vehicle.owner_id IS NOT DISTINCT FROM v_transfer.previous_owner_id THEN
      UPDATE public.vehicles
         SET owner_id=v_transfer.incoming_owner_id,
             -- Ownership completion retires the previous Marketplace selling authority.
             -- The new owner must explicitly start a new sale before buyer intent can route.
             current_seller_id=NULL,
             current_seller_type=NULL,
             current_seller_type_source=NULL,
             -- The dealer-organisation relationship retires with the sale, exactly as the
             -- current-seller pointer above does. Leaving it set was the root cause of the
             -- former-seller authorization defect: `tenant_id` is the third clause of the
             -- `isOwner || isCurrentSeller || isDealerTenant` scope test repeated across eleven
             -- call sites, so a previous dealer relationship silently outlived the transfer and
             -- kept granting publish / unpublish / price / status / media / evidence control over
             -- a vehicle the tenant no longer had any relationship to. A dealer who genuinely
             -- lists the vehicle again re-establishes tenant_id through the ordinary listing path.
             tenant_id=NULL,
             publication_status=CASE
               WHEN publication_status='published' THEN 'publishable'
               ELSE publication_status
             END
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
    ELSIF v_vehicle.owner_id IS NOT DISTINCT FROM v_transfer.incoming_owner_id
       AND EXISTS (
         SELECT 1
           FROM public.vehicle_ownership_history h
          WHERE h.transfer_id=v_transfer.id
            AND h.vin=v_transfer.vin
            AND h.previous_owner_id=v_transfer.previous_owner_id
            AND h.new_owner_id=v_transfer.incoming_owner_id
       ) THEN
      NULL; -- governed dispute resolution upholds the already-recorded transfer
    ELSE
      RAISE EXCEPTION 'vehicle owner changed outside this governed transfer' USING ERRCODE='40001';
    END IF;
  END IF;

  UPDATE public.vehicle_ownership_transfers
     SET state=p_to_state,
         registry_authority=CASE WHEN p_to_state='complete' THEN btrim(p_registry_authority) ELSE registry_authority END,
         completion_reference=CASE WHEN p_to_state='complete' THEN btrim(p_completion_reference) ELSE completion_reference END,
         completed_at=CASE
           WHEN p_to_state='complete' THEN coalesce(completed_at,v_now)
           ELSE completed_at
         END,
         version=version+1,
         updated_at=v_now
   WHERE id=v_transfer.id
   RETURNING * INTO v_transfer;

  INSERT INTO public.vehicle_ownership_transfer_events(
    transfer_id,from_state,to_state,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_transfer.id,v_from_state,p_to_state,p_actor_id,p_actor_role,p_reason,
    jsonb_build_object(
      'vin',v_transfer.vin,
      'registry_authority',CASE WHEN p_to_state='complete' THEN p_registry_authority ELSE NULL END,
      'completion_reference_present',p_completion_reference IS NOT NULL
    ),v_now
  );

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
        'recipient_role',CASE
          WHEN p_to_state='complete' THEN 'incoming_owner'
          WHEN p_actor_id=v_transfer.previous_owner_id THEN 'incoming_owner'
          ELSE 'previous_owner'
        END,
        'transfer_state',p_to_state,
        'subject_type','vehicle',
        'subject_id',v_transfer.vin
      ),
      'pending',0,v_transfer.tenant_id
    );

    -- Completion changes a relationship for BOTH parties. The incoming owner gets
    -- the primary completion event above; the previous owner receives a distinct
    -- durable event rather than relying on UI state or an out-of-band message.
    IF p_to_state='complete' AND v_transfer.previous_owner_id IS DISTINCT FROM v_transfer.incoming_owner_id THEN
      INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
      VALUES(
        'vehicle.ownership.transfer_completed',
        jsonb_build_object(
          'transferId',v_transfer.id,
          'vin',v_transfer.vin,
          'recipientUserId',v_transfer.previous_owner_id,
          'recipient_role','previous_owner',
          'transfer_state',p_to_state,
          'subject_type','vehicle',
          'subject_id',v_transfer.vin
        ),
        'pending',0,v_transfer.tenant_id
      );
    END IF;
  END IF;

  RETURN v_transfer;
END
$transition$;

DO $o2_p1_post$
BEGIN
  IF to_regprocedure('public.passport_transition_ownership_transfer_atomic(uuid,text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '[O2 P1] passport_transition_ownership_transfer_atomic is missing after replace';
  END IF;
END
$o2_p1_post$;

-- +migrate Down
-- Forward-only: completed transfers may already have retired their tenant relationship, and
-- restoring the previous definition would re-open the bypass. Forward-fix instead.
SELECT 1;
