-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Phase 9 (Stage B): SafeTrade DISPUTES + DELIVERY confirmation
--
-- Additive companion to 20260621130000_diaspora_phase9_safetrade.sql. Three new tables that hang off
-- the canonical diaspora_safetrade_transactions / _milestones rows:
--   1. diaspora_safetrade_disputes             — one dispute case per (transaction, optional milestone)
--   2. diaspora_safetrade_dispute_evidence     — append-only evidence + statements attached to a dispute
--   3. diaspora_safetrade_delivery_confirmations — buyer (or reviewer-override) delivery confirmations,
--      signed-proof refs, dispute-window + escalation bookkeeping, and a reputation-ELIGIBILITY flag
--      (the SERVICE emits an eligibility EVENT only — it NEVER writes diaspora_reputation_records).
--
-- DESIGN DECISIONS (recorded here intentionally):
--  D1 Disputes/delivery are RECORDS; money never moves in these tables. An ACTIVE dispute BLOCKS release
--     (read by diasporaSafeTradeReleasePolicyService check #6 / ACTIVE_DISPUTE). Opening a dispute places
--     a TEMPORARY (sandbox) payment HOLD via the milestone service + the existing
--     diaspora_safetrade_transition_atomic RPC — never a new money RPC here.
--  D2 REUSE diaspora_import_audit_log for audit (same in-txn CRITICAL pattern as Phase 9 core); rows are
--     distinguished by resource_type IN ('diaspora_safetrade_dispute','diaspora_safetrade_delivery')
--     and a 'SAFETRADE_*' action prefix. No second audit system.
--  D3 Delivery confirmation NEVER auto-completes shipment/delivery and NEVER writes reputation; it only
--     records the buyer's signed confirmation, opens a dispute window, and (after the window closes with
--     no fraud hold + no open dispute) flips reputation_eligibility_emitted to mark that an eligibility
--     EVENT was surfaced. The existing diasporaReputationService remains the only reputation writer.
--  D4 No real money: there is no payment provider call in this migration and no money-moving RPC; the
--     sandbox HOLD on dispute open is performed by the service against the existing core RPC.
--
-- Additive, reversible, idempotent for dev verification. Reuses the Phase 1B RLS helpers
-- (diaspora_trade_os_can_access_row / _is_platform_admin / _is_tenant_member) and the updated_at
-- trigger. RLS enabled, REVOKE PUBLIC + GRANT authenticated/service_role. Evidence + delivery
-- confirmations are append-heavy. NOT applied to production by this program — validated by CI
-- migration-sanity + unit tests.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Table: diaspora_safetrade_disputes (one dispute case per transaction/optional milestone) ──
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.diaspora_safetrade_milestones(id) ON DELETE SET NULL,
  import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,
  raised_by text,                       -- actor id of the party who opened the dispute
  raised_by_role text                   -- server-derived role token at open time (BUYER/SELLER/REVIEWER/ADMIN)
    CHECK (raised_by_role IS NULL OR raised_by_role IN ('BUYER','SELLER','REVIEWER','ADMIN','SYSTEM')),
  category text NOT NULL DEFAULT 'OTHER'
    CHECK (category IN (
      'ITEM_NOT_AS_DESCRIBED','ITEM_NOT_RECEIVED','DAMAGED_IN_TRANSIT','DOCUMENT_DISCREPANCY',
      'COMPLIANCE_CONCERN','PAYMENT_DISCREPANCY','FRAUD_SUSPECTED','DELIVERY_TIMEOUT','OTHER'
    )),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','UNDER_REVIEW','AWAITING_INFO','RESOLVED','REJECTED','WITHDRAWN','CANCELLED')),
  resolution text                       -- how it was resolved (set only on terminal states)
    CHECK (resolution IS NULL OR resolution IN ('REFUND','RELEASE','CANCEL','PARTIAL_REFUND','DISMISSED','NO_ACTION')),
  resolution_notes text,
  hold_placed boolean NOT NULL DEFAULT false,   -- whether a temporary (sandbox) payment HOLD was placed on open
  hold_reference text,                          -- correlation pointer to the milestone HOLD (sandbox)
  assigned_reviewer_id text,                    -- reviewer/admin assigned to the case (server-derived)
  assigned_at timestamptz,
  resolved_by text,                             -- privileged actor who resolved/rejected
  resolved_at timestamptz,
  policy_version text NOT NULL DEFAULT 'safetrade-policy-v1',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

-- At most one active (non-terminal) dispute per transaction — keeps "is there an open dispute?" cheap
-- and prevents duplicate concurrent cases.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_dispute_active
  ON public.diaspora_safetrade_disputes (transaction_id)
  WHERE deleted_at IS NULL AND status IN ('OPEN','UNDER_REVIEW','AWAITING_INFO');

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_disputes_txn_status
  ON public.diaspora_safetrade_disputes (transaction_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_disputes_tenant
  ON public.diaspora_safetrade_disputes (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_disputes_reviewer
  ON public.diaspora_safetrade_disputes (assigned_reviewer_id, status);

-- ── Table: diaspora_safetrade_dispute_evidence (append-only evidence + statements) ──
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_dispute_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  dispute_id uuid NOT NULL REFERENCES public.diaspora_safetrade_disputes(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE SET NULL,
  evidence_type text NOT NULL DEFAULT 'STATEMENT'
    CHECK (evidence_type IN ('STATEMENT','DOCUMENT','PHOTO','SHIPMENT_EVENT','PAYMENT_EVIDENCE','SYSTEM_NOTE','OTHER')),
  author_id text,                       -- actor id who submitted the evidence/statement
  author_role text                      -- server-derived role at submission time
    CHECK (author_role IS NULL OR author_role IN ('BUYER','SELLER','REVIEWER','ADMIN','SYSTEM')),
  visibility text NOT NULL DEFAULT 'PARTICIPANTS'   -- participant-privacy control (see service redaction)
    CHECK (visibility IN ('PARTICIPANTS','REVIEWERS_ONLY','AUTHOR_ONLY')),
  statement text,                       -- free-text statement (when evidence_type = STATEMENT)
  document_ref text,                    -- pointer to a document / storage object (no raw bytes here)
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- structured pointers (document ids, shipment events)
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_dispute_evidence_dispute
  ON public.diaspora_safetrade_dispute_evidence (dispute_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_dispute_evidence_tenant
  ON public.diaspora_safetrade_dispute_evidence (tenant_id, created_at DESC);

-- ── Table: diaspora_safetrade_delivery_confirmations (buyer/reviewer delivery confirmation record) ──
CREATE TABLE IF NOT EXISTS public.diaspora_safetrade_delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.diaspora_safetrade_transactions(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.diaspora_safetrade_milestones(id) ON DELETE SET NULL,
  import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE SET NULL,
  confirmed_by text,                    -- buyer (or reviewer-override) actor id
  confirmed_by_role text                -- server-derived role at confirmation time
    CHECK (confirmed_by_role IS NULL OR confirmed_by_role IN ('BUYER','REVIEWER','ADMIN','SYSTEM')),
  confirmation_method text NOT NULL DEFAULT 'BUYER_CONFIRMED'
    CHECK (confirmation_method IN ('BUYER_CONFIRMED','REVIEWER_OVERRIDE','TIMEOUT_ESCALATION')),
  status text NOT NULL DEFAULT 'CONFIRMED'
    CHECK (status IN ('CONFIRMED','DISPUTED','ESCALATED','SUPERSEDED')),
  signed_proof_refs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- signed proof-of-delivery pointers (no raw bytes)
  proof_signature text,                 -- detached signature / hash of the signed proof bundle
  confirmed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  dispute_window_ends_at timestamptz,   -- end of the buyer dispute window (no auto money move at expiry)
  dispute_window_closed boolean NOT NULL DEFAULT false,
  escalated boolean NOT NULL DEFAULT false,
  escalation_reason text,
  fraud_hold boolean NOT NULL DEFAULT false,             -- a fraud/security hold blocks eligibility
  reputation_eligibility_emitted boolean NOT NULL DEFAULT false,  -- an ELIGIBILITY EVENT was surfaced (never a reputation row)
  reputation_eligibility_emitted_at timestamptz,
  policy_version text NOT NULL DEFAULT 'safetrade-policy-v1',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz
);

-- One active delivery-confirmation record per (transaction, milestone) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_delivery_active
  ON public.diaspora_safetrade_delivery_confirmations (transaction_id, milestone_id)
  WHERE deleted_at IS NULL AND status IN ('CONFIRMED','ESCALATED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_safetrade_delivery_idem
  ON public.diaspora_safetrade_delivery_confirmations (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_delivery_txn
  ON public.diaspora_safetrade_delivery_confirmations (transaction_id, status, confirmed_at DESC);

CREATE INDEX IF NOT EXISTS idx_diaspora_safetrade_delivery_window
  ON public.diaspora_safetrade_delivery_confirmations (dispute_window_closed, dispute_window_ends_at);

-- ── updated_at triggers (reuse the Phase 1B helper) ──
DROP TRIGGER IF EXISTS set_diaspora_safetrade_disputes_updated_at ON public.diaspora_safetrade_disputes;
CREATE TRIGGER set_diaspora_safetrade_disputes_updated_at
  BEFORE UPDATE ON public.diaspora_safetrade_disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_safetrade_dispute_evidence_updated_at ON public.diaspora_safetrade_dispute_evidence;
CREATE TRIGGER set_diaspora_safetrade_dispute_evidence_updated_at
  BEFORE UPDATE ON public.diaspora_safetrade_dispute_evidence
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_diaspora_safetrade_delivery_updated_at ON public.diaspora_safetrade_delivery_confirmations;
CREATE TRIGGER set_diaspora_safetrade_delivery_updated_at
  BEFORE UPDATE ON public.diaspora_safetrade_delivery_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

-- ── Row Level Security ──
ALTER TABLE public.diaspora_safetrade_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_safetrade_dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_safetrade_delivery_confirmations ENABLE ROW LEVEL SECURITY;

-- Disputes: participants get RLS-scoped READ ONLY. The backend (service_role) creates disputes and
-- controls every state field — status, resolution, assigned_reviewer_id, resolved_by, hold_placed,
-- fraud_hold, dispute_window_closed, reputation_eligibility_emitted, raised_by_role — so an ordinary
-- caller can never set them directly. (Hardening 2026-07-18: was FOR ALL.)
DROP POLICY IF EXISTS diaspora_safetrade_disputes_tenant_access ON public.diaspora_safetrade_disputes;
CREATE POLICY diaspora_safetrade_disputes_tenant_access
  ON public.diaspora_safetrade_disputes
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- Evidence: participants get RLS-scoped READ ONLY (the server-redacted read endpoint, ST-4B, is the
-- authored boundary; author_role and visibility are server-set). Uploads go through the backend, so
-- no direct INSERT for authenticated. (Hardening 2026-07-18: was FOR ALL / GRANT SELECT,INSERT.)
DROP POLICY IF EXISTS diaspora_safetrade_dispute_evidence_tenant_access ON public.diaspora_safetrade_dispute_evidence;
CREATE POLICY diaspora_safetrade_dispute_evidence_tenant_access
  ON public.diaspora_safetrade_dispute_evidence
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- Delivery confirmations: participants READ ONLY; confirmed_by_role and confirmation are server-set
-- by the backend so a buyer cannot forge a delivery confirmation that gates release. (Was FOR ALL.)
DROP POLICY IF EXISTS diaspora_safetrade_delivery_tenant_access ON public.diaspora_safetrade_delivery_confirmations;
CREATE POLICY diaspora_safetrade_delivery_tenant_access
  ON public.diaspora_safetrade_delivery_confirmations
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by));

-- ── Table-level grants: never PUBLIC; authenticated SELECT-only + service_role writes ──
REVOKE ALL ON TABLE public.diaspora_safetrade_disputes FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_dispute_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.diaspora_safetrade_delivery_confirmations FROM PUBLIC;
DO $grants$
BEGIN
  -- SELECT-only for authenticated on all three; every create/mutate is service_role via the backend
  -- (dispute lifecycle, evidence upload, delivery confirmation). Explicit write REVOKEs are
  -- defense-in-depth. (Hardening 2026-07-18: all three previously had authenticated INSERT/UPDATE.)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.diaspora_safetrade_disputes TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.diaspora_safetrade_disputes FROM authenticated;
    GRANT SELECT ON TABLE public.diaspora_safetrade_dispute_evidence TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.diaspora_safetrade_dispute_evidence FROM authenticated;
    GRANT SELECT ON TABLE public.diaspora_safetrade_delivery_confirmations TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.diaspora_safetrade_delivery_confirmations FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.diaspora_safetrade_disputes TO service_role;
    GRANT ALL ON TABLE public.diaspora_safetrade_dispute_evidence TO service_role;
    GRANT ALL ON TABLE public.diaspora_safetrade_delivery_confirmations TO service_role;
  END IF;
END;
$grants$;

COMMENT ON TABLE public.diaspora_safetrade_disputes
  IS 'SafeTrade dispute cases. An active dispute BLOCKS release (release policy ACTIVE_DISPUTE). Opening one places a temporary sandbox HOLD via the core transition RPC; this table never moves money.';
COMMENT ON TABLE public.diaspora_safetrade_dispute_evidence
  IS 'Append-only evidence/statements for a dispute. Visibility controls participant privacy; reviewers see all.';
COMMENT ON TABLE public.diaspora_safetrade_delivery_confirmations
  IS 'Buyer/reviewer delivery confirmations with signed-proof refs + dispute window + escalation. reputation_eligibility_emitted marks that an ELIGIBILITY EVENT was surfaced; never writes diaspora_reputation_records.';

-- +migrate Down
DROP TABLE IF EXISTS public.diaspora_safetrade_delivery_confirmations;
DROP TABLE IF EXISTS public.diaspora_safetrade_dispute_evidence;
DROP TABLE IF EXISTS public.diaspora_safetrade_disputes;
