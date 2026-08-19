-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6 — RESERVATION EXPIRY RECONCILIATION + DIRECT-ACCESS CLOSURE
--
-- `vehicle_reservations` remains authoritative. `vehicles.status/reserved_until/
-- active_reservation_id` are only a cache and may lag clock expiry until this reconciler runs.
-- Public detail reads do NOT depend on this job: reservationProjectionService evaluates expires_at
-- at read time. This job exists to converge the cache and outbox state.
--
-- Critical safety rule: a reservation with a linked payment intent is NEVER auto-released merely
-- because its reservation clock elapsed. Provider cancellation/reconciliation must happen first.
-- Otherwise CarUp could expose the vehicle to a second buyer while a provider authorization still
-- exists. Those rows remain locked and are reported as skipped_payment_linked for operator review.
--
-- UNAPPLIED until the single guarded staging truth cutover after Phase 6.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.vehicle_reservations') IS NULL
     OR to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] reservation expiry prerequisites absent';
  END IF;
END
$pre$;

-- Backend participant-scoped routes are the only read path. A prior Phase 6 migration granted
-- authenticated SELECT on escrow_trust_sessions, which would bypass participant scoping and expose
-- counterparty/economic state to any future Supabase JWT caller. Close the table plane completely.
REVOKE ALL ON TABLE public.escrow_trust_sessions FROM anon,authenticated;
REVOKE ALL ON TABLE public.escrow_trust_events FROM anon,authenticated;
REVOKE ALL ON TABLE public.escrow_trust_webhook_events FROM anon,authenticated;
REVOKE ALL ON TABLE public.vehicle_reservations FROM anon,authenticated;
GRANT ALL ON TABLE public.escrow_trust_sessions TO service_role;
GRANT ALL ON TABLE public.escrow_trust_events TO service_role;
GRANT ALL ON TABLE public.escrow_trust_webhook_events TO service_role;
GRANT ALL ON TABLE public.vehicle_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.issue164_reconcile_expired_reservations(
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  expired_reservations integer,
  repaired_vehicle_caches integer,
  skipped_payment_linked integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $reconcile_expiry$
DECLARE
  v_row record;
  v_expired integer := 0;
  v_repaired integer := 0;
  v_skipped integer := 0;
  v_vehicle_rows integer := 0;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'reconciliation clock is required' USING ERRCODE='22023';
  END IF;

  FOR v_row IN
    SELECT
      r.id,
      r.vin,
      r.transaction_intent_id,
      r.inquiry_id,
      r.buyer_id,
      r.seller_id,
      r.reserved_at,
      r.expires_at,
      tx.status AS transaction_status,
      tx.payment_intent_id,
      tx.payment_state,
      tx.tenant_id
    FROM public.vehicle_reservations r
    JOIN public.escrow_trust_sessions tx ON tx.id=r.transaction_intent_id
    WHERE r.status='active'
      AND r.expires_at<=p_now
    ORDER BY r.expires_at,r.id
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    -- Once a payment intent exists, the database cannot know whether a provider authorization must
    -- be cancelled/released. Do not manufacture availability from a clock alone.
    IF v_row.payment_intent_id IS NOT NULL
       OR lower(coalesce(v_row.transaction_status,'')) NOT IN ('eligible','cancelled','failed') THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.vehicle_reservations
       SET status='expired',updated_at=p_now
     WHERE id=v_row.id AND status='active';
    IF NOT FOUND THEN CONTINUE; END IF;
    v_expired := v_expired + 1;

    UPDATE public.vehicles
       SET status=CASE WHEN lower(coalesce(status,''))='reserved' THEN 'Available' ELSE status END,
           reserved_at=NULL,
           reserved_until=NULL,
           active_reservation_id=NULL
     WHERE vin=v_row.vin
       AND active_reservation_id=v_row.id;
    GET DIAGNOSTICS v_vehicle_rows = ROW_COUNT;
    v_repaired := v_repaired + v_vehicle_rows;

    -- A pre-payment expiry invalidates any previously computed deposit eligibility. It does not
    -- change a provider state because, by the guard above, no provider intent exists on this row.
    UPDATE public.escrow_trust_sessions
       SET deposit_eligibility=CASE
             WHEN deposit_eligibility='not_evaluated' THEN 'not_evaluated'
             ELSE 'ineligible'
           END,
           deposit_amount=NULL,
           deposit_currency=NULL,
           deposit_policy_version=NULL,
           deposit_reasons=CASE
             WHEN deposit_reasons @> '["reservation_expired"]'::jsonb THEN deposit_reasons
             ELSE coalesce(deposit_reasons,'[]'::jsonb) || '["reservation_expired"]'::jsonb
           END,
           updated_at=p_now
     WHERE id=v_row.transaction_intent_id;

    INSERT INTO public.escrow_trust_events(
      session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
    ) VALUES(
      v_row.transaction_intent_id,
      v_row.transaction_status,
      v_row.transaction_status,
      NULL,
      'system',
      'reservation_expired',
      jsonb_build_object(
        'reservation_id',v_row.id,
        'expired_at',v_row.expires_at,
        'cache_repaired',v_vehicle_rows=1
      ),
      p_now
    );

    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES(
      'VEHICLE_RESERVATION_EXPIRED',
      jsonb_build_object(
        'vin',v_row.vin,
        'reservationId',v_row.id,
        'transactionIntentId',v_row.transaction_intent_id,
        'expiresAt',v_row.expires_at
      ),
      'pending',0,v_row.tenant_id
    );
  END LOOP;

  expired_reservations := v_expired;
  repaired_vehicle_caches := v_repaired;
  skipped_payment_linked := v_skipped;
  RETURN NEXT;
END
$reconcile_expiry$;

REVOKE ALL ON FUNCTION public.issue164_reconcile_expired_reservations(timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_reconcile_expired_reservations(timestamptz)
  TO service_role;

-- Best-effort scheduler registration. Read correctness does not depend on pg_cron: if it is absent,
-- the public reservation projection remains correct and a later guarded operator run can reconcile.
DO $schedule$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '[issue-164-p6] pg_cron unavailable; reservation cache reconciliation is manual/read-safe';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
    FROM cron.job
   WHERE jobname='issue164-reservation-expiry-reconcile'
   ORDER BY jobid DESC
   LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'issue164-reservation-expiry-reconcile',
    '* * * * *',
    'SELECT public.issue164_reconcile_expired_reservations();'
  );
END
$schedule$;

-- Postcondition: direct browser roles own no privilege on the transaction/reservation tables.
DO $post$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ' ORDER BY table_name,grantee,privilege_type)
    INTO v_leak
    FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name IN (
       'escrow_trust_sessions','escrow_trust_events','escrow_trust_webhook_events','vehicle_reservations'
     )
     AND grantee IN ('anon','authenticated');
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p6] direct transaction/reservation privilege leak remains: %',v_leak;
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only. Reversal could re-open participant-data access or revive expired reservation caches.
