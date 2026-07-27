-- +migrate Up
-- =============================================================================
-- Diaspora ledger #23 — SafeTrade ST-3 item #1 closure (Issue #127).
--
-- Ledger #22 built the transactional outbox and taught the transition RPC to write into it. That
-- closed item #1 for transitions that GO THROUGH that RPC — but the dispute-hold and
-- delivery-window-close paths do not. They mutate their row with a direct UPDATE and then append a
-- best-effort audit afterwards, which is exactly the pattern ST-3 #1 exists to eliminate: if the
-- process dies between the UPDATE and the append, the state moved and the record of it never
-- happened, silently.
--
-- This migration gives those two paths their own atomic RPCs. Each one locks the row, applies the
-- state change, writes the CRITICAL audit row, and enqueues the outbox events — all inside a single
-- transaction. Either everything happened or nothing did.
--
-- It also adds the two functions the outbox drainer needs. A drainer that reads with a plain SELECT
-- would hand the same event to two workers; claiming is therefore done with FOR UPDATE SKIP LOCKED
-- under a visibility lease, so concurrent drainers partition the queue instead of duplicating it.
--
-- Additive: no existing table, column, policy or function is altered. Ledger #3–#22 untouched.
-- search_path is pinned to `public, extensions, pg_temp` for the same reason ledger #18 pinned it on
-- the other RPCs — pgcrypto's digest() lives in `extensions` on Supabase, and the audit seal needs it.
-- service_role-only EXECUTE, matching ledger #11.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Dispute hold — state change + audit + outbox, atomically.
--
--    `p_events` is a JSON array of {eventType, payload}. Passing an empty array is legitimate: the
--    caller may want the atomic state+audit write without emitting anything downstream.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_safetrade_dispute_hold_atomic(
  p_dispute_id uuid,
  p_actor_id text,
  p_hold_placed boolean,
  p_hold_reference text DEFAULT NULL,
  p_events jsonb DEFAULT '[]'::jsonb,
  p_audit_action text DEFAULT 'SAFETRADE_DISPUTE_HOLD_PLACED',
  p_audit_metadata jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_dispute public.diaspora_safetrade_disputes%ROWTYPE;
  v_txn public.diaspora_safetrade_transactions%ROWTYPE;
  v_event jsonb;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/UNAUTHENTICATED'; END IF;

  -- 1. Lock the dispute, then its transaction (for tenant + order attribution on the audit row).
  SELECT * INTO v_dispute FROM public.diaspora_safetrade_disputes
    WHERE id = p_dispute_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_DISPUTE'; END IF;

  SELECT * INTO v_txn FROM public.diaspora_safetrade_transactions
    WHERE id = v_dispute.transaction_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_TXN'; END IF;

  -- 2. Apply the hold state on the locked row.
  UPDATE public.diaspora_safetrade_disputes
     SET hold_placed = COALESCE(p_hold_placed, hold_placed),
         hold_reference = COALESCE(p_hold_reference, hold_reference),
         updated_by = p_actor_id,
         updated_at = v_ts
   WHERE id = p_dispute_id
   RETURNING * INTO v_dispute;

  -- 3. CRITICAL audit row, same transaction (this is what used to be best-effort AFTER commit).
  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|' || p_audit_action || '|diaspora_safetrade_dispute|'
      || p_dispute_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    v_txn.import_order_id, v_txn.tenant_id, p_actor_id, p_audit_action,
    'diaspora_safetrade_dispute', p_dispute_id::text,
    jsonb_build_object('holdPlaced', NOT COALESCE(p_hold_placed, false)),
    jsonb_build_object('holdPlaced', v_dispute.hold_placed, 'holdReference', v_dispute.hold_reference),
    COALESCE(p_audit_metadata, '{}'::jsonb) || jsonb_build_object('correlationId', p_correlation_id),
    v_seal
  );

  -- 4. Outbox events, same transaction.
  IF jsonb_typeof(COALESCE(p_events, '[]'::jsonb)) = 'array' THEN
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
      INSERT INTO public.diaspora_safetrade_outbox (
        tenant_id, transaction_id, milestone_id, event_type, payload, correlation_id, actor_id
      ) VALUES (
        v_txn.tenant_id, v_dispute.transaction_id, v_dispute.milestone_id,
        COALESCE(v_event ->> 'eventType', 'SAFETRADE_DISPUTE_EVENT'),
        COALESCE(v_event -> 'payload', '{}'::jsonb),
        p_correlation_id, p_actor_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('dispute', to_jsonb(v_dispute));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Delivery-window close — state change + audit + outbox, atomically.
--
--    The double-emit guard lives HERE, on the locked row, rather than in the service: two concurrent
--    close attempts would otherwise both read `reputation_eligibility_emitted = false` and both emit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_safetrade_close_delivery_window_atomic(
  p_confirmation_id uuid,
  p_actor_id text,
  p_emit_eligibility boolean,
  p_at timestamptz DEFAULT NULL,
  p_events jsonb DEFAULT '[]'::jsonb,
  p_audit_action text DEFAULT 'SAFETRADE_DELIVERY_WINDOW_CHECK',
  p_audit_metadata jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_conf public.diaspora_safetrade_delivery_confirmations%ROWTYPE;
  v_txn public.diaspora_safetrade_transactions%ROWTYPE;
  v_event jsonb;
  v_seal text;
  v_ts timestamptz := COALESCE(p_at, now());
  v_replay boolean := false;
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/UNAUTHENTICATED'; END IF;

  SELECT * INTO v_conf FROM public.diaspora_safetrade_delivery_confirmations
    WHERE id = p_confirmation_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_CONFIRMATION'; END IF;

  SELECT * INTO v_txn FROM public.diaspora_safetrade_transactions
    WHERE id = v_conf.transaction_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_TXN'; END IF;

  -- Idempotency on the LOCKED row: a concurrent second close cannot double-emit.
  IF p_emit_eligibility AND v_conf.reputation_eligibility_emitted THEN
    v_replay := true;
  ELSIF p_emit_eligibility THEN
    UPDATE public.diaspora_safetrade_delivery_confirmations
       SET dispute_window_closed = true,
           reputation_eligibility_emitted = true,
           reputation_eligibility_emitted_at = v_ts,
           updated_by = p_actor_id,
           updated_at = v_ts
     WHERE id = p_confirmation_id
     RETURNING * INTO v_conf;
  END IF;

  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|' || p_audit_action || '|diaspora_safetrade_delivery|'
      || p_confirmation_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    v_txn.import_order_id, v_txn.tenant_id, p_actor_id, p_audit_action,
    'diaspora_safetrade_delivery', p_confirmation_id::text,
    jsonb_build_object('eligibilityEmitted', false),
    jsonb_build_object('eligibilityEmitted', COALESCE(p_emit_eligibility, false), 'idempotentReplay', v_replay),
    COALESCE(p_audit_metadata, '{}'::jsonb) || jsonb_build_object('correlationId', p_correlation_id),
    v_seal
  );

  -- A replay emits no NEW events — the original close already enqueued them.
  IF NOT v_replay AND jsonb_typeof(COALESCE(p_events, '[]'::jsonb)) = 'array' THEN
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
      INSERT INTO public.diaspora_safetrade_outbox (
        tenant_id, transaction_id, milestone_id, event_type, payload, correlation_id, actor_id
      ) VALUES (
        v_txn.tenant_id, v_conf.transaction_id, v_conf.milestone_id,
        COALESCE(v_event ->> 'eventType', 'SAFETRADE_DELIVERY_EVENT'),
        COALESCE(v_event -> 'payload', '{}'::jsonb),
        p_correlation_id, p_actor_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('confirmation', to_jsonb(v_conf), 'idempotentReplay', v_replay);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Outbox drainer — claim.
--
--    FOR UPDATE SKIP LOCKED plus a visibility lease. Two drainers running concurrently partition the
--    queue rather than both delivering the same event; a drainer that dies mid-flight leaves rows
--    that simply become due again when the lease expires.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_safetrade_outbox_claim_atomic(
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 60,
  p_now timestamptz DEFAULT NULL
)
RETURNS SETOF public.diaspora_safetrade_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
BEGIN
  RETURN QUERY
  UPDATE public.diaspora_safetrade_outbox o
     SET attempts = o.attempts + 1,
         -- Lease: invisible to other drainers until it expires or the row is settled.
         next_attempt_at = v_now + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 60), 1))
   WHERE o.id IN (
     SELECT c.id FROM public.diaspora_safetrade_outbox c
      WHERE c.status IN ('pending', 'failed')
        AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= v_now)
      ORDER BY c.created_at
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Outbox drainer — settle.
--
--    Success → dispatched. Failure → exponential backoff until p_max_attempts, then dead_lettered so
--    an operator sees it. A failed event is never dropped and never retried forever.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_safetrade_outbox_settle_atomic(
  p_id uuid,
  p_succeeded boolean,
  p_error text DEFAULT NULL,
  p_max_attempts integer DEFAULT 5,
  p_now timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.diaspora_safetrade_outbox%ROWTYPE;
  v_now timestamptz := COALESCE(p_now, now());
  v_backoff integer;
BEGIN
  SELECT * INTO v_row FROM public.diaspora_safetrade_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_OUTBOX_EVENT'; END IF;

  IF COALESCE(p_succeeded, false) THEN
    UPDATE public.diaspora_safetrade_outbox
       SET status = 'dispatched', dispatched_at = v_now, next_attempt_at = NULL, last_error = NULL
     WHERE id = p_id RETURNING * INTO v_row;
  ELSIF v_row.attempts >= GREATEST(COALESCE(p_max_attempts, 5), 1) THEN
    UPDATE public.diaspora_safetrade_outbox
       SET status = 'dead_lettered', next_attempt_at = NULL,
           last_error = left(COALESCE(p_error, 'delivery failed'), 500)
     WHERE id = p_id RETURNING * INTO v_row;
  ELSE
    -- 2^attempts seconds, capped at 15 minutes.
    v_backoff := LEAST(power(2, LEAST(v_row.attempts, 10))::integer, 900);
    UPDATE public.diaspora_safetrade_outbox
       SET status = 'failed',
           next_attempt_at = v_now + make_interval(secs => v_backoff),
           last_error = left(COALESCE(p_error, 'delivery failed'), 500)
     WHERE id = p_id RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. EXECUTE posture — service_role only, matching ledger #11.
-- ─────────────────────────────────────────────────────────────────────────────
DO $grants$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'diaspora_safetrade_dispute_hold_atomic',
         'diaspora_safetrade_close_delivery_window_atomic',
         'diaspora_safetrade_outbox_claim_atomic',
         'diaspora_safetrade_outbox_settle_atomic'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$grants$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_safetrade_outbox_settle_atomic(uuid, boolean, text, integer, timestamptz);
DROP FUNCTION IF EXISTS public.diaspora_safetrade_outbox_claim_atomic(integer, integer, timestamptz);
DROP FUNCTION IF EXISTS public.diaspora_safetrade_close_delivery_window_atomic(uuid, text, boolean, timestamptz, jsonb, text, jsonb, text);
DROP FUNCTION IF EXISTS public.diaspora_safetrade_dispute_hold_atomic(uuid, text, boolean, text, jsonb, text, jsonb, text);
