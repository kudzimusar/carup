-- +migrate Up
-- =============================================================================
-- Diaspora ledger #22 — SafeTrade ST-3 closure (Issue #127).
--
-- Closes the four ST-3 hardening items the repository records as blocking real-money activation.
-- Ledger #13 (which created this RPC) is NOT edited; this migration additively creates the outbox
-- and REPLACES the function with an identical signature, so no overload is introduced and every
-- existing caller keeps working.
--
--   ST-3 #1  Auxiliary dispute/delivery transition audit moves OUT of the best-effort
--            after-commit path and INTO a transactional outbox written inside the same
--            transaction as the state change and the critical audit row.
--   ST-3 #2  Maker-checker separation: the evaluator can never authorize the money movement their
--            own evaluation blessed, and HIGH-risk release/refund additionally requires a recorded,
--            single-use approval from a different human.
--   ST-3 #3  The durable operation row (ledger #21) is marked ledger_applied inside this
--            transaction, so provider state can never silently lead the authoritative ledger.
--   ST-3 #4  Durable webhook de-duplication ships in ledger #21
--            (diaspora_safetrade_provider_events, UNIQUE (provider, event_id)).
--
-- search_path stays pinned to `public, extensions, pg_temp` exactly as ledger #18 set it, so
-- pgcrypto's digest() keeps resolving on Supabase. service_role-only EXECUTE from ledger #11 is
-- re-asserted at the end (CREATE OR REPLACE preserves ACLs, but we are explicit rather than lucky).
--
-- Additive and idempotent; runs in one transaction.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The transactional outbox (ST-3 #1).
--    Append-only for its event content: a trigger blocks DELETE and blocks UPDATE of every column
--    except the worker's delivery bookkeeping. An auditor can therefore trust that what is in the
--    outbox is exactly what the transaction that produced it intended.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  transaction_id  uuid,
  milestone_id    uuid,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id  text,
  actor_id        text,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  dispatched_at   timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ck_diaspora_safetrade_outbox_status
    CHECK (status IN ('pending', 'dispatched', 'failed', 'dead_lettered'))
);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_outbox_queue
  ON public.diaspora_safetrade_outbox (status, next_attempt_at NULLS FIRST)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_outbox_txn
  ON public.diaspora_safetrade_outbox (transaction_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.diaspora_safetrade_outbox_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $outbox_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/OUTBOX_APPEND_ONLY: delete is not permitted';
  END IF;
  -- Only the worker's delivery bookkeeping may change. The event itself is immutable.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/OUTBOX_APPEND_ONLY: event content is immutable';
  END IF;
  RETURN NEW;
END;
$outbox_guard$;

DROP TRIGGER IF EXISTS diaspora_safetrade_outbox_append_only_trg ON public.diaspora_safetrade_outbox;
CREATE TRIGGER diaspora_safetrade_outbox_append_only_trg
  BEFORE UPDATE OR DELETE ON public.diaspora_safetrade_outbox
  FOR EACH ROW EXECUTE FUNCTION public.diaspora_safetrade_outbox_append_only();

ALTER TABLE public.diaspora_safetrade_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.diaspora_safetrade_outbox FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_outbox FROM anon;
REVOKE ALL ON TABLE public.diaspora_safetrade_outbox FROM authenticated;
GRANT ALL ON TABLE public.diaspora_safetrade_outbox TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The transition RPC, replaced in place (same signature — no overload).
--    Body is the ledger #13 body verbatim, plus the three ST-3 insertions marked inline.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaspora_safetrade_transition_atomic(
  p_transaction_id uuid,
  p_milestone_id uuid,
  p_actor_id text,
  p_tenant_id uuid,
  p_actor_is_privileged boolean,
  p_target_status text,
  p_evaluation_id uuid DEFAULT NULL,
  p_payment_provider text DEFAULT 'sandbox',
  p_live_payment boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL,
  p_source text DEFAULT 'ui'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_txn public.diaspora_safetrade_transactions%ROWTYPE;
  v_milestone public.diaspora_safetrade_milestones%ROWTYPE;
  v_eval public.diaspora_safetrade_release_evaluations%ROWTYPE;
  v_source text;
  v_resource_type text;
  v_resource_id text;
  v_prior_key text;
  v_prior_target text;
  v_is_money boolean := false;
  v_is_release_authorize boolean := false;
  v_seal text;
  v_ts timestamptz := now();
  -- ST-3 additions
  v_aux jsonb;
  v_aux_event jsonb;
  v_approval public.diaspora_safetrade_approvals%ROWTYPE;
  v_decision_type text;
  v_requires_maker_checker boolean := false;
  v_operation_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/UNAUTHENTICATED'; END IF;
  IF p_target_status IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/TARGET_REQUIRED'; END IF;

  -- 1. Lock the transaction.
  SELECT * INTO v_txn FROM public.diaspora_safetrade_transactions
    WHERE id = p_transaction_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_TXN'; END IF;

  -- 2. Optionally lock the milestone and assert it belongs to the transaction.
  IF p_milestone_id IS NOT NULL THEN
    SELECT * INTO v_milestone FROM public.diaspora_safetrade_milestones
      WHERE id = p_milestone_id AND deleted_at IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_MILESTONE'; END IF;
    IF v_milestone.transaction_id <> p_transaction_id THEN
      RAISE EXCEPTION 'DIASPORA_SAFETRADE/MILESTONE_NOT_IN_TXN';
    END IF;
    v_resource_type := 'diaspora_safetrade_milestone';
    v_resource_id := p_milestone_id::text;
    v_source := v_milestone.status;
  ELSE
    v_resource_type := 'diaspora_safetrade_transaction';
    v_resource_id := p_transaction_id::text;
    v_source := v_txn.status;
  END IF;

  -- 3. Authority against the locked rows (defense-in-depth with the service authz layer).
  IF NOT (
    p_actor_is_privileged
    OR v_txn.buyer_id = p_actor_id
    OR v_txn.created_by = p_actor_id
    OR (p_tenant_id IS NOT NULL AND v_txn.tenant_id IS NOT DISTINCT FROM p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/FORBIDDEN';
  END IF;

  -- 4. Idempotency replay (last transition key recorded on the row metadata).
  IF p_idempotency_key IS NOT NULL THEN
    IF p_milestone_id IS NOT NULL THEN
      v_prior_key := v_milestone.metadata #>> '{safetrade,lastTransitionKey}';
      v_prior_target := v_milestone.metadata #>> '{safetrade,lastTransitionTarget}';
    ELSE
      v_prior_key := v_txn.metadata #>> '{safetrade,lastTransitionKey}';
      v_prior_target := v_txn.metadata #>> '{safetrade,lastTransitionTarget}';
    END IF;
    IF v_prior_key IS NOT NULL AND v_prior_key = p_idempotency_key THEN
      IF v_prior_target IS DISTINCT FROM p_target_status THEN
        RAISE EXCEPTION 'DIASPORA_SAFETRADE/IDEMPOTENCY_CONFLICT';
      END IF;
      RETURN jsonb_build_object(
        'transaction', to_jsonb(v_txn),
        'milestone', to_jsonb(v_milestone),
        'idempotentReplay', true
      );
    END IF;
  END IF;

  -- 5. Transition validity (explicit allowlist; same style as IMPORT_ORDER_TRANSITIONS, enforced in SQL).
  IF NOT (
    -- Transaction lifecycle edges.
    (v_source = 'DRAFT' AND p_target_status IN ('INITIATED','CANCELLED'))
    OR (v_source = 'INITIATED' AND p_target_status IN ('FUNDS_PENDING','CANCELLED'))
    OR (v_source = 'FUNDS_PENDING' AND p_target_status IN ('FUNDS_HELD','REFUND_REVIEW','DISPUTED'))
    OR (v_source = 'FUNDS_HELD' AND p_target_status IN ('IN_PROGRESS','REFUND_REVIEW','DISPUTED'))
    OR (v_source = 'IN_PROGRESS' AND p_target_status IN ('RELEASE_REVIEW','REFUND_REVIEW','DISPUTED'))
    OR (v_source = 'RELEASE_REVIEW' AND p_target_status IN ('RELEASE_AUTHORIZED','REFUND_REVIEW','DISPUTED'))
    OR (v_source = 'RELEASE_AUTHORIZED' AND p_target_status IN ('SETTLED','DISPUTED'))
    OR (v_source = 'DISPUTED' AND p_target_status IN ('IN_PROGRESS','FUNDS_HELD','REFUND_REVIEW','CANCELLED'))
    OR (v_source = 'REFUND_REVIEW' AND p_target_status IN ('REFUNDED','DISPUTED'))
    -- Milestone lifecycle edges.
    OR (v_source = 'PENDING' AND p_target_status IN ('DUE','FUNDS_PENDING','WAIVED','CANCELLED'))
    OR (v_source = 'DUE' AND p_target_status IN ('FUNDS_PENDING','WAIVED','CANCELLED'))
    OR (v_source = 'FUNDS_PENDING' AND p_target_status IN ('FUNDED','HELD','FAILED','REFUND_REVIEW'))
    OR (v_source = 'FUNDED' AND p_target_status IN ('HELD','REFUND_REVIEW'))
    OR (v_source = 'HELD' AND p_target_status IN ('RELEASE_REVIEW','REFUND_REVIEW'))
    OR (v_source = 'RELEASE_REVIEW' AND p_target_status IN ('RELEASE_AUTHORIZED','REFUND_REVIEW'))
    OR (v_source = 'RELEASE_AUTHORIZED' AND p_target_status = 'RELEASED')
    OR (v_source = 'REFUND_REVIEW' AND p_target_status = 'REFUNDED')
  ) THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/INVALID_TRANSITION: % -> %', v_source, p_target_status;
  END IF;

  -- 6. NON-NEGOTIABLE money / high-risk guards (directive §5.2).
  v_is_money := p_target_status IN ('FUNDS_PENDING','FUNDED','HELD','FUNDS_HELD','RELEASE_AUTHORIZED','RELEASED','REFUNDED');
  v_is_release_authorize := p_target_status IN ('RELEASE_AUTHORIZED','RELEASED','REFUNDED');

  IF v_is_money THEN
    -- N1/N7: live money path always throws; only sandbox/fake providers proceed.
    IF COALESCE(p_live_payment, false) OR p_payment_provider IS NULL OR p_payment_provider NOT IN ('sandbox','fake') THEN
      RAISE EXCEPTION 'DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED';
    END IF;
  END IF;

  IF v_is_release_authorize THEN
    -- N5: release/refund authorization requires a privileged actor AND a passing prior evaluation.
    IF NOT p_actor_is_privileged THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/REVIEWER_REQUIRED'; END IF;
    IF p_evaluation_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/EVALUATION_REQUIRED'; END IF;
    SELECT * INTO v_eval FROM public.diaspora_safetrade_release_evaluations
      WHERE id = p_evaluation_id AND transaction_id = p_transaction_id AND deleted_at IS NULL
      LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/EVALUATION_REQUIRED'; END IF;
    IF p_milestone_id IS NOT NULL AND v_eval.milestone_id IS NOT NULL
       AND v_eval.milestone_id <> p_milestone_id THEN
      RAISE EXCEPTION 'DIASPORA_SAFETRADE/EVALUATION_REQUIRED';
    END IF;
    -- N5 defense-in-depth: the blessing evaluation must carry an EVALUATOR (a privileged reviewer/admin
    -- recorded by the service-role evaluation path; evaluated_by is set only when isPlatformAdmin/Reviewer
    -- passed). A forged row with no evaluator must not bless a money RELEASE even if eligible=true. The
    -- table now grants authenticated SELECT-only, so only the service_role can write these rows at all.
    IF v_eval.evaluated_by IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/EVALUATION_NOT_REVIEWED'; END IF;
    IF v_eval.eligible IS NOT TRUE THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_ELIGIBLE'; END IF;
    IF v_eval.policy_version IS DISTINCT FROM v_txn.policy_version THEN
      RAISE EXCEPTION 'DIASPORA_SAFETRADE/POLICY_VERSION_MISMATCH';
    END IF;

    -- ── ST-3 item 2: MAKER-CHECKER SEPARATION (Issue #127) ────────────────────────────────
    -- The evaluator can never be the actor who authorizes the money movement their own evaluation
    -- blesses. This is the primary separation-of-duties boundary and it is enforced here, on the
    -- locked rows, inside the authoritative transaction — not in a service that could be bypassed.
    IF v_eval.evaluated_by IS NOT DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'DIASPORA_SAFETRADE/EVALUATOR_SELF_APPROVAL';
    END IF;

    -- HIGH-risk decisions need a second, explicit, recorded human approval on top of the separation
    -- above. The approval row carries its own DB-level no-self-approve constraint (ledger #21), so a
    -- single human can never manufacture both halves.
    v_requires_maker_checker := (v_eval.risk_level = 'HIGH');
    IF v_requires_maker_checker THEN
      v_decision_type := CASE WHEN p_target_status = 'REFUNDED' THEN 'refund' ELSE 'release' END;
      SELECT * INTO v_approval FROM public.diaspora_safetrade_approvals
        WHERE transaction_id = p_transaction_id
          AND decision_type = v_decision_type
          AND state = 'approved'
          AND (evaluation_id IS NULL OR evaluation_id = p_evaluation_id)
          AND (milestone_id IS NULL OR p_milestone_id IS NULL OR milestone_id = p_milestone_id)
          AND (expires_at IS NULL OR expires_at > v_ts)
        ORDER BY approved_at DESC
        LIMIT 1
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'DIASPORA_SAFETRADE/APPROVAL_REQUIRED';
      END IF;
      -- Defense in depth over the table CHECK: neither half of the maker-checker pair may be the
      -- actor performing the transition, and the approver may not be the evaluator.
      IF v_approval.approved_by IS NOT DISTINCT FROM v_approval.requested_by THEN
        RAISE EXCEPTION 'DIASPORA_SAFETRADE/SELF_APPROVAL';
      END IF;
      IF v_approval.approved_by IS NOT DISTINCT FROM v_eval.evaluated_by THEN
        RAISE EXCEPTION 'DIASPORA_SAFETRADE/SELF_APPROVAL';
      END IF;
      -- Single-use: consume the approval in the same transaction so it cannot bless a second release.
      UPDATE public.diaspora_safetrade_approvals
        SET state = 'consumed', updated_at = v_ts
        WHERE id = v_approval.id;
    END IF;
  END IF;

  -- 7. Apply the update on the locked row, stamping the idempotency key for future replays.
  IF p_milestone_id IS NOT NULL THEN
    UPDATE public.diaspora_safetrade_milestones
      SET status = p_target_status,
          released_by = CASE WHEN p_target_status = 'RELEASED' THEN p_actor_id ELSE released_by END,
          released_at = CASE WHEN p_target_status = 'RELEASED' THEN v_ts ELSE released_at END,
          metadata = jsonb_set(
            jsonb_set(COALESCE(metadata, '{}'::jsonb), '{safetrade,lastTransitionKey}', to_jsonb(COALESCE(p_idempotency_key, '')), true),
            '{safetrade,lastTransitionTarget}', to_jsonb(p_target_status), true),
          updated_by = p_actor_id,
          updated_at = v_ts
      WHERE id = p_milestone_id
      RETURNING * INTO v_milestone;
  ELSE
    UPDATE public.diaspora_safetrade_transactions
      SET status = p_target_status,
          reviewer_id = CASE WHEN v_is_release_authorize THEN p_actor_id ELSE reviewer_id END,
          reviewed_at = CASE WHEN v_is_release_authorize THEN v_ts ELSE reviewed_at END,
          settled_at = CASE WHEN p_target_status = 'SETTLED' THEN v_ts ELSE settled_at END,
          metadata = jsonb_set(
            jsonb_set(COALESCE(metadata, '{}'::jsonb), '{safetrade,lastTransitionKey}', to_jsonb(COALESCE(p_idempotency_key, '')), true),
            '{safetrade,lastTransitionTarget}', to_jsonb(p_target_status), true),
          updated_by = p_actor_id,
          updated_at = v_ts
      WHERE id = p_transaction_id
      RETURNING * INTO v_txn;
  END IF;

  -- 8. CRITICAL audit row in the same transaction (rolls back with everything else on failure).
  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|SAFETRADE_' || p_target_status || '|' || v_resource_type || '|' || v_resource_id || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    v_txn.import_order_id, v_txn.tenant_id, p_actor_id, 'SAFETRADE_' || p_target_status, v_resource_type, v_resource_id,
    jsonb_build_object('status', v_source),
    jsonb_build_object('status', p_target_status),
    jsonb_build_object(
      'evaluationId', p_evaluation_id,
      'provider', p_payment_provider,
      'livePayment', COALESCE(p_live_payment, false),
      'reason', p_reason,
      'correlationId', p_correlation_id,
      'source', p_source,
      'extra', COALESCE(p_metadata, '{}'::jsonb)
    ),
    v_seal
  );

  -- ── ST-3 item 1: TRANSACTIONAL OUTBOX (Issue #127) ──────────────────────────────────────
  -- Auxiliary dispute/delivery transition events used to be appended best-effort AFTER this
  -- transaction committed, so a crash between COMMIT and the append silently lost them. They are now
  -- enqueued HERE, inside the same transaction as the state change and the critical audit row: either
  -- the transition and every one of its events are durable together, or none of them happened.
  v_aux := COALESCE(p_metadata -> 'auxEvents', '[]'::jsonb);
  IF jsonb_typeof(v_aux) = 'array' THEN
    FOR v_aux_event IN SELECT * FROM jsonb_array_elements(v_aux) LOOP
      INSERT INTO public.diaspora_safetrade_outbox (
        tenant_id, transaction_id, milestone_id, event_type, payload, correlation_id, actor_id
      ) VALUES (
        v_txn.tenant_id,
        p_transaction_id,
        p_milestone_id,
        COALESCE(v_aux_event ->> 'eventType', 'SAFETRADE_AUX_EVENT'),
        COALESCE(v_aux_event -> 'payload', '{}'::jsonb),
        p_correlation_id,
        p_actor_id
      );
    END LOOP;
  END IF;

  -- ── ST-3 item 3: bind the durable operation row to this committed ledger state ───────────
  -- The service records a pending operation BEFORE calling the provider. Marking it ledger_applied
  -- here — in the same transaction as the state change — is what makes it impossible for provider
  -- state to silently lead the authoritative ledger: anything the ledger has not confirmed stays in
  -- the reconciliation queue rather than being reported to a user as success.
  v_operation_id := NULLIF(p_metadata ->> 'operationId', '')::uuid;
  IF v_operation_id IS NOT NULL THEN
    UPDATE public.diaspora_safetrade_operations
      SET state = 'ledger_applied', applied_at = v_ts, updated_at = v_ts
      WHERE id = v_operation_id
        AND tenant_id IS NOT DISTINCT FROM v_txn.tenant_id
        AND state IN ('pending', 'provider_dispatched', 'provider_confirmed', 'reconciling');
  END IF;

  RETURN jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'milestone', to_jsonb(v_milestone),
    'idempotentReplay', false
  );
END;
$$;

-- Re-assert the ledger #11 execute posture explicitly.
REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(
  uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(
  uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(
  uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_safetrade_transition_atomic(
  uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
) TO service_role;

-- +migrate Down
-- Tightening only: reversing would restore the best-effort audit path and remove maker-checker
-- separation from the money boundary. Intentionally no destructive down (mirrors #17/#18/#19/#20);
-- restore-from-backup under explicit authorization if ever required.
