-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Phase 9: SafeTrade escrow / assurance overlay
--
-- SafeTrade is an ASSURANCE/ESCROW OVERLAY on the 23-state import-order DAG. It references an
-- import_order_id and DERIVES its shipment/compliance/document gates by reading existing rows; it
-- does NOT re-implement logistics, NEVER writes diaspora_compliance_reviews / shipment statuses /
-- diaspora_reputation_records, and NEVER moves real money.
--
-- DESIGN DECISIONS (recorded here intentionally):
--  D1 SEPARATE diaspora_safetrade_milestones table — does NOT extend diaspora_payment_milestones
--     (which is order-keyed, has no transaction_id/payer/payee/triggers/idempotency and a money-only
--     status CHECK). A nullable legacy_payment_milestone_id (SET NULL) is the only bridge.
--  D2 REUSE diaspora_import_audit_log for SafeTrade audit (same in-txn CRITICAL pattern as H1/H2/H3);
--     SafeTrade rows are distinguished by resource_type + 'SAFETRADE_*' action. No second audit system.
--  D3 Release EVALUATION is an append-only RECORD (this migration) driven by a SERVICE (not built
--     here); evaluation NEVER releases money. The only state-changing release RPC requires a
--     privileged actor AND a passing prior evaluation reference (directive §5.2 / N5).
--  D4 Money is FAIL-CLOSED TWICE: a table CHECK forces live_payment = false, and the transition RPC
--     throws DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED for any money target with
--     live_payment = true OR a non-sandbox provider (N1/N7). The activation migration (EB-4) is the
--     only thing that may drop the CHECK / widen the provider list.
--
-- Additive, reversible, idempotent for dev verification. Reuses the Phase 1B RLS helpers
-- (diaspora_trade_os_can_access_row / _is_platform_admin / _is_tenant_member) and the updated_at
-- trigger. RLS enabled, REVOKE PUBLIC + GRANT authenticated/service_role. RPC EXECUTE to service_role
-- only. NOT applied to production by this program — validated by CI migration-sanity + unit tests.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Table: diaspora_safetrade_transactions (canonical escrow/assurance transaction) ──
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  import_order_id uuid NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
  accepted_quote_id uuid REFERENCES public.diaspora_import_quotes(id) ON DELETE SET NULL,
  buyer_id text,
  seller_id text,
  currency text NOT NULL DEFAULT 'USD',
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT',
      'INITIATED',
      'FUNDS_PENDING',
      'FUNDS_HELD',
      'IN_PROGRESS',
      'RELEASE_REVIEW',
      'RELEASE_AUTHORIZED',
      'SETTLED',
      'DISPUTED',
      'REFUND_REVIEW',
      'REFUNDED',
      'CANCELLED'
    )),
  payment_provider text NOT NULL DEFAULT 'sandbox',
  live_payment boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL DEFAULT 'safetrade-policy-v1',
  reviewer_id text,
  reviewed_at timestamptz,
  initiated_at timestamptz,
  settled_at timestamptz,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT diaspora_safetrade_txn_provider_chk
    CHECK (payment_provider IN ('sandbox','fake')),
  CONSTRAINT diaspora_safetrade_txn_live_closed_chk
    CHECK (live_payment = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_txn_order_quote
  ON public.diaspora_safetrade_transactions (import_order_id, accepted_quote_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_txn_idem
  ON public.diaspora_safetrade_transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_txn_tenant_status
  ON public.diaspora_safetrade_transactions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_txn_order
  ON public.diaspora_safetrade_transactions (import_order_id, status);

-- ── Table: diaspora_safetrade_milestones (reviewed escrow milestone; separate from payment_milestones) ──
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE CASCADE,
  import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,
  legacy_payment_milestone_id uuid REFERENCES public.diaspora_payment_milestones(id) ON DELETE SET NULL,
  milestone_type text NOT NULL
    CHECK (milestone_type IN ('DEPOSIT','PROGRESS','SHIPMENT','CUSTOMS_DUTY','DELIVERY','RELEASE','INSURANCE','FEE','REFUND')),
  sequence integer NOT NULL CHECK (sequence >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  payer text,
  payee text,
  due_trigger text NOT NULL DEFAULT 'MANUAL'
    CHECK (due_trigger IN ('MANUAL','ON_INITIATION','ON_SHIPMENT_BOOKED','ON_LOADED','ON_ARRIVAL','ON_CUSTOMS_CLEARED','ON_DELIVERY_CONFIRMED')),
  release_trigger text NOT NULL DEFAULT 'REVIEWER_APPROVAL'
    CHECK (release_trigger IN ('REVIEWER_APPROVAL','ON_DELIVERY_CONFIRMED_REVIEWED','ON_DOCUMENTS_VERIFIED_REVIEWED','MANUAL_REVIEWER')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING','DUE','FUNDS_PENDING','FUNDED','HELD',
      'RELEASE_REVIEW','RELEASE_AUTHORIZED','RELEASED',
      'WAIVED','REFUND_REVIEW','REFUNDED','CANCELLED','FAILED'
    )),
  evidence_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_reference text,
  provider_status text,
  idempotency_key text,
  released_by text,
  released_at timestamptz,
  due_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  CONSTRAINT uq_diaspora_safetrade_milestone_seq
    UNIQUE (transaction_id, sequence),
  CONSTRAINT uq_diaspora_safetrade_milestone_type
    UNIQUE (transaction_id, milestone_type, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_milestone_idem
  ON public.diaspora_safetrade_milestones (transaction_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_milestones_txn_status
  ON public.diaspora_safetrade_milestones (transaction_id, status, sequence);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_milestones_tenant
  ON public.diaspora_safetrade_milestones (tenant_id, status, created_at DESC);

-- ── Table: diaspora_safetrade_release_evaluations (append-only explainable release record) ──
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_release_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.diaspora_safetrade_milestones(id) ON DELETE CASCADE,
  eligible boolean NOT NULL DEFAULT false,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_reviewer boolean NOT NULL DEFAULT true,
  risk_level text NOT NULL DEFAULT 'HIGH'
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  policy_version text NOT NULL DEFAULT 'safetrade-policy-v1',
  evaluated_by text,
  evaluated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_evals_txn_milestone
  ON public.diaspora_safetrade_release_evaluations (transaction_id, milestone_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_evals_tenant
  ON public.diaspora_safetrade_release_evaluations (tenant_id, eligible, evaluated_at DESC);

-- ── updated_at triggers (reuse the Phase 1B helper) ──
DROP TRIGGER IF EXISTS set_diaspora_safetrade_transactions_updated_at ON public.diaspora_safetrade_transactions;
CREATE TRIGGER set_diaspora_safetrade_transactions_updated_at
  BEFORE UPDATE ON public.diaspora_safetrade_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_safetrade_milestones_updated_at ON public.diaspora_safetrade_milestones;
CREATE TRIGGER set_diaspora_safetrade_milestones_updated_at
  BEFORE UPDATE ON public.diaspora_safetrade_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_safetrade_evals_updated_at ON public.diaspora_safetrade_release_evaluations;
CREATE TRIGGER set_diaspora_safetrade_evals_updated_at
  BEFORE UPDATE ON public.diaspora_safetrade_release_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

-- ── Row Level Security ──
ALTER TABLE public.diaspora_safetrade_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_safetrade_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_safetrade_release_evaluations ENABLE ROW LEVEL SECURITY;

-- SafeTrade is escrow/assurance over money-state. Participants get RLS-scoped READ ONLY on the
-- transaction; every write — status/state transitions, reviewer, settlement, RELEASE/REFUND, provider
-- fields — goes through the service_role atomic RPCs (transition/record-milestone) which enforce the
-- state machine, evaluation requirement, non-negotiables and audit. A participant who reaches the
-- table directly still cannot UPDATE status or any money field. (Hardening 2026-07-18: was FOR ALL.)
DROP POLICY IF EXISTS diaspora_safetrade_transactions_tenant_access ON public.diaspora_safetrade_transactions;
CREATE POLICY diaspora_safetrade_transactions_tenant_access
  ON public.diaspora_safetrade_transactions
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- Milestones drive the release schedule; direct participant mutation of milestone status would
-- bypass the record-milestone RPC's evaluation/idempotency. READ ONLY for participants. (Was FOR ALL.)
DROP POLICY IF EXISTS diaspora_safetrade_milestones_tenant_access ON public.diaspora_safetrade_milestones;
CREATE POLICY diaspora_safetrade_milestones_tenant_access
  ON public.diaspora_safetrade_milestones
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- Release evaluations: participants READ ONLY (grant already blocks writes; the policy is SELECT too
-- so a future stray GRANT can never re-open forging of an eligible=true verdict). (Hardening
-- 2026-07-18: policy was FOR ALL though the grant was already SELECT-only.)
DROP POLICY IF EXISTS diaspora_safetrade_evals_tenant_access ON public.diaspora_safetrade_release_evaluations;
CREATE POLICY diaspora_safetrade_evals_tenant_access
  ON public.diaspora_safetrade_release_evaluations
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- ── Table-level grants: never PUBLIC; authenticated (RLS-scoped) + service_role only ──
REVOKE ALL ON TABLE public.diaspora_safetrade_transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_milestones FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_release_evaluations FROM PUBLIC;
DO $grants$
BEGIN
  -- Every SafeTrade table is SELECT-only for authenticated (RLS scopes the rows); all writes are
  -- service_role via the atomic RPCs. Explicit REVOKE of INSERT/UPDATE/DELETE is defense-in-depth so a
  -- future stray GRANT cannot silently re-open direct writes. (Hardening 2026-07-18: transactions +
  -- milestones were SELECT,INSERT,UPDATE.)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.diaspora_safetrade_transactions TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.diaspora_safetrade_transactions FROM authenticated;
    GRANT SELECT ON TABLE public.diaspora_safetrade_milestones TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.diaspora_safetrade_milestones FROM authenticated;
    -- Release evaluations are the N5 verdict the release path/RPC TRUSTS to bless a money RELEASE. They
    -- are written ONLY by the service_role singleton client (the evaluation service), never by an end
    -- user. Granting authenticated INSERT would let a non-reviewer forge an eligible=true row that the
    -- RPC then trusts — so authenticated gets SELECT ONLY (read your own verdicts under RLS); no
    -- INSERT/UPDATE/DELETE. service_role retains full write below.
    GRANT SELECT ON TABLE public.diaspora_safetrade_release_evaluations TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.diaspora_safetrade_release_evaluations FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.diaspora_safetrade_transactions TO service_role;
    GRANT ALL ON TABLE public.diaspora_safetrade_milestones TO service_role;
    GRANT ALL ON TABLE public.diaspora_safetrade_release_evaluations TO service_role;
  END IF;
END;
$grants$;

-- =============================================================
-- RPC: diaspora_safetrade_transition_atomic
--
-- Locks the transaction (and optional milestone), validates authority + source->target legality,
-- enforces money/high-risk fail-closed guards (N1/N5/N7), applies the update, and writes a CRITICAL
-- audit row into diaspora_import_audit_log IN THE SAME TRANSACTION (rolls back on failure, N6).
-- Idempotent on (transaction, milestone, idempotency_key): same target replays, conflicting target
-- raises IDEMPOTENCY_CONFLICT. service_role EXECUTE only.
-- =============================================================
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
SET search_path = 'public'
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

  RETURN jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'milestone', to_jsonb(v_milestone),
    'idempotentReplay', false
  );
END;
$$;

-- service_role only. Explicitly strip PUBLIC/anon/authenticated so no PostgREST caller can drive a
-- SafeTrade state transition (release/refund/settlement) directly. (Hardening 2026-07-18.)
REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(
  uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(
      uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.diaspora_safetrade_transition_atomic(
      uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_safetrade_transition_atomic(
      uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text
    ) TO service_role;
  END IF;
END;
$grant$;

-- =============================================================
-- RPC: diaspora_safetrade_record_milestone_atomic
--
-- Defines/seeds the milestone set for a transaction in ONE transaction: enforces single-currency,
-- reconciles Sum(amount) to total_amount within numeric(_,2) tolerance, inserts milestones, advances
-- DRAFT -> INITIATED, and writes a CRITICAL audit row in-txn. Idempotent on (transaction,
-- idempotency_key): same key replays, conflicting payload raises IDEMPOTENCY_CONFLICT.
-- service_role EXECUTE only.
-- =============================================================
CREATE OR REPLACE FUNCTION public.diaspora_safetrade_record_milestone_atomic(
  p_transaction_id uuid,
  p_actor_id text,
  p_tenant_id uuid,
  p_actor_is_privileged boolean,
  p_milestones jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  p_source text DEFAULT 'ui'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_txn public.diaspora_safetrade_transactions%ROWTYPE;
  v_prior_key text;
  v_elem jsonb;
  v_type text;
  v_seq integer;
  v_amount numeric(14,2);
  v_currency text;
  v_sum numeric(14,2) := 0;
  v_count integer := 0;
  v_seal text;
  v_ts timestamptz := now();
  v_result jsonb;
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/UNAUTHENTICATED'; END IF;
  IF p_milestones IS NULL OR jsonb_typeof(p_milestones) <> 'array' THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/MILESTONES_REQUIRED';
  END IF;

  -- 1. Lock the transaction; only DRAFT/INITIATED may have their milestone set (re)defined.
  SELECT * INTO v_txn FROM public.diaspora_safetrade_transactions
    WHERE id = p_transaction_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/NOT_FOUND_TXN'; END IF;
  IF NOT (
    p_actor_is_privileged
    OR v_txn.buyer_id = p_actor_id
    OR v_txn.created_by = p_actor_id
    OR (p_tenant_id IS NOT NULL AND v_txn.tenant_id IS NOT DISTINCT FROM p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/FORBIDDEN';
  END IF;
  IF v_txn.status NOT IN ('DRAFT','INITIATED') THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/MILESTONES_LOCKED';
  END IF;

  -- 2. Idempotency replay.
  IF p_idempotency_key IS NOT NULL THEN
    v_prior_key := v_txn.metadata #>> '{safetrade,lastMilestoneKey}';
    IF v_prior_key IS NOT NULL AND v_prior_key = p_idempotency_key THEN
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sequence) INTO v_result
        FROM public.diaspora_safetrade_milestones m
        WHERE m.transaction_id = p_transaction_id AND m.deleted_at IS NULL;
      RETURN jsonb_build_object(
        'transaction', to_jsonb(v_txn),
        'milestones', COALESCE(v_result, '[]'::jsonb),
        'idempotentReplay', true
      );
    END IF;
  END IF;

  -- 3/4. Validate each element + reconcile totals (single currency, numeric(_,2) scale).
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones)
  LOOP
    v_type := v_elem->>'milestoneType';
    v_seq := COALESCE((v_elem->>'sequence')::integer, v_count);
    v_amount := COALESCE((v_elem->>'amount'), '0')::numeric(14,2);
    v_currency := COALESCE(v_elem->>'currency', v_txn.currency);

    IF v_amount < 0 THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/INVALID_AMOUNT'; END IF;
    IF v_currency <> v_txn.currency THEN
      RAISE EXCEPTION 'DIASPORA_SAFETRADE/CURRENCY_MISMATCH: milestone % txn %', v_currency, v_txn.currency;
    END IF;

    INSERT INTO public.diaspora_safetrade_milestones (
      tenant_id, transaction_id, import_order_id, legacy_payment_milestone_id,
      milestone_type, sequence, amount, currency, payer, payee, due_trigger, release_trigger,
      status, evidence_requirements, idempotency_key, metadata, created_by, updated_by
    ) VALUES (
      COALESCE(v_txn.tenant_id, p_tenant_id), p_transaction_id, v_txn.import_order_id,
      NULLIF(v_elem->>'legacyPaymentMilestoneId','')::uuid,
      v_type, v_seq, v_amount, v_currency,
      v_elem->>'payer', v_elem->>'payee',
      COALESCE(v_elem->>'dueTrigger', 'MANUAL'),
      COALESCE(v_elem->>'releaseTrigger', 'REVIEWER_APPROVAL'),
      'PENDING',
      COALESCE(v_elem->'evidenceRequirements', '[]'::jsonb),
      v_elem->>'idempotencyKey',
      jsonb_build_object('correlationId', p_correlation_id, 'source', p_source),
      p_actor_id, p_actor_id
    );

    -- REFUND lines are informational and excluded from the reconciliation sum.
    IF v_type <> 'REFUND' THEN
      v_sum := v_sum + v_amount;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'DIASPORA_SAFETRADE/MILESTONES_REQUIRED'; END IF;

  -- Reconcile within half a cent at numeric(_,2) (effectively exact).
  IF ABS(v_sum - v_txn.total_amount) > 0.005 THEN
    RAISE EXCEPTION 'DIASPORA_SAFETRADE/TOTALS_UNRECONCILED: sum % total %', v_sum, v_txn.total_amount;
  END IF;

  -- 5. Advance DRAFT -> INITIATED and stamp the milestone idempotency key.
  UPDATE public.diaspora_safetrade_transactions
    SET status = CASE WHEN status = 'DRAFT' THEN 'INITIATED' ELSE status END,
        initiated_at = COALESCE(initiated_at, v_ts),
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{safetrade,lastMilestoneKey}', to_jsonb(COALESCE(p_idempotency_key, '')), true),
        updated_by = p_actor_id,
        updated_at = v_ts
    WHERE id = p_transaction_id
    RETURNING * INTO v_txn;

  -- 6. CRITICAL audit row in-txn.
  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|SAFETRADE_MILESTONES_DEFINED|diaspora_safetrade_transaction|' || p_transaction_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    v_txn.import_order_id, v_txn.tenant_id, p_actor_id, 'SAFETRADE_MILESTONES_DEFINED',
    'diaspora_safetrade_transaction', p_transaction_id::text,
    NULL,
    jsonb_build_object('status', v_txn.status, 'milestoneCount', v_count),
    jsonb_build_object('total', v_txn.total_amount, 'sum', v_sum, 'reconciled', true, 'correlationId', p_correlation_id, 'source', p_source),
    v_seal
  );

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sequence) INTO v_result
    FROM public.diaspora_safetrade_milestones m
    WHERE m.transaction_id = p_transaction_id AND m.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'milestones', COALESCE(v_result, '[]'::jsonb),
    'reconciliation', jsonb_build_object('total', v_txn.total_amount, 'sum', v_sum, 'reconciled', true),
    'idempotentReplay', false
  );
END;
$$;

-- service_role only. Explicitly strip PUBLIC/anon/authenticated. (Hardening 2026-07-18.)
REVOKE ALL ON FUNCTION public.diaspora_safetrade_record_milestone_atomic(
  uuid, text, uuid, boolean, jsonb, text, text, text
) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.diaspora_safetrade_record_milestone_atomic(
      uuid, text, uuid, boolean, jsonb, text, text, text
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.diaspora_safetrade_record_milestone_atomic(
      uuid, text, uuid, boolean, jsonb, text, text, text
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_safetrade_record_milestone_atomic(
      uuid, text, uuid, boolean, jsonb, text, text, text
    ) TO service_role;
  END IF;
END;
$grant$;

COMMENT ON TABLE public.diaspora_safetrade_transactions
  IS 'SafeTrade escrow/assurance transaction (overlay on import orders). live_payment is CHECK-forced false until EB-4 activation; never moves real money.';
COMMENT ON TABLE public.diaspora_safetrade_milestones
  IS 'Reviewed escrow milestones. Separate from diaspora_payment_milestones (D1); legacy_payment_milestone_id is the only bridge.';
COMMENT ON TABLE public.diaspora_safetrade_release_evaluations
  IS 'Append-only explainable release-readiness records (D3). Never releases money; consumed by the transition RPC as the N5 gate.';
COMMENT ON FUNCTION public.diaspora_safetrade_transition_atomic(uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text)
  IS 'Atomic SafeTrade state transition with in-txn CRITICAL audit, idempotency replay, and money/high-risk fail-closed guards. service_role EXECUTE only.';
COMMENT ON FUNCTION public.diaspora_safetrade_record_milestone_atomic(uuid, text, uuid, boolean, jsonb, text, text, text)
  IS 'Atomic milestone definition with single-currency total reconciliation and in-txn CRITICAL audit. service_role EXECUTE only.';

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_safetrade_record_milestone_atomic(uuid, text, uuid, boolean, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.diaspora_safetrade_transition_atomic(uuid, uuid, text, uuid, boolean, text, uuid, text, boolean, text, text, jsonb, text, text);
DROP TABLE IF EXISTS public.diaspora_safetrade_release_evaluations;
DROP TABLE IF EXISTS public.diaspora_safetrade_milestones;
DROP TABLE IF EXISTS public.diaspora_safetrade_transactions;
