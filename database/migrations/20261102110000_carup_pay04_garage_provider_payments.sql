-- CARUP-PAY-04-LR01 — provider-confirmed garage payments on the canonical ledger (Level 1: local simulator only).
--
-- TRUTH BOUNDARIES (read before changing anything here):
--   * Garage revenue belongs to the GARAGE. A provider-confirmed garage payment is a canonical public.payment_transactions
--     row with PAY-02 third-party semantics: product gar.invoice.customer_payment, category_b_third_party, funds owner
--     garage_business_tenant, legal beneficiary 'tenant:<garage>', settlement not_applicable_sandbox. CarUp is never the
--     beneficiary, and CarUp Japan's Stripe merchant can never collect it (only gateways registered here can).
--   * Declared payments stay where OPS07 put them: garage_payment_records, source 'garage_recorded_external' only. This
--     migration never writes there and never rewrites an OPS07 row.
--   * An invoice is an obligation. Provider money counts toward it only through the append-only ALLOCATION ledger, which
--     follows the canonical payment state and never exceeds what is still owed. Money the invoice cannot absorb is an
--     explicit, open discrepancy, never silently counted.
--   * Money in flight (a live checkout, a refund in progress, a reconciliation hold, an unresolved provider mismatch) is
--     RESERVED: neither a declared payment nor a new collection may commit it, and the invoice cannot be voided under it.
--   * PAY-03B F5 is REUSED, not copied: the transition rules, the sticky reconciliation hold, the exception record and
--     the governed operator resolution are F5's own functions. This migration re-creates four F5 functions with one
--     bounded garage branch each (identifier shapes for the garage simulator; the owner lock; the resolution re-projection;
--     the payer-conflict rule) — everything else in them is byte-identical to 20261101120000/20261101130000.
--   * Level 1 only: the one permitted gateway is the clearly-labelled local simulator, and only where the disposable
--     runtime guard enables it. A real garage merchant gateway (e.g. a Zimbabwe provider) needs Owner and provider
--     authority and a later migration; no live gateway value is accepted by any table here.
-- +migrate Up
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regprocedure('public.pay03b_payment_transition_target(public.payment_transactions,bigint,text,text,text,bigint,bigint,text[],text,text)') IS NULL
     OR to_regprocedure('public.pay03b_record_payment_hold(public.payment_transactions,bigint,text,text,text,text,text,text,bigint,bigint,text[],text,text)') IS NULL
     OR to_regprocedure('public.pay03b_after_payment_resolution(text)') IS NULL
     OR to_regclass('public.pay03b_subscription_invoices') IS NULL
     OR to_regprocedure('public.pay03b_is_platform_admin(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.pay02_commercial_products WHERE product_code = 'gar.invoice.customer_payment')
     OR to_regprocedure('public.garage_ops07_record_payment(uuid,uuid,numeric,text,text,text,timestamptz,text,text)') IS NULL
     OR to_regprocedure('public.pay04_set_garage_payment_instructions(uuid,text,text,text,text[],text[])') IS NULL THEN
    RAISE EXCEPTION 'PAY04_PROVIDER_PAYMENTS_REQUIRES_PAY03B_F5_PAY02_OPS07_AND_20261102100000';
  END IF;
END $$;

-- ─────────────────────────── 0. runtime guard (disposable environments only) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay04_runtime_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  garage_simulator_enabled boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL DEFAULT session_user
);
INSERT INTO public.pay04_runtime_guard (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
-- Who changed the guard and when is stamped by the database, never taken from the writer.
CREATE OR REPLACE FUNCTION public.pay04_stamp_runtime_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := session_user;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_stamp_runtime_guard ON public.pay04_runtime_guard;
CREATE TRIGGER trg_pay04_stamp_runtime_guard BEFORE UPDATE ON public.pay04_runtime_guard
  FOR EACH ROW EXECUTE FUNCTION public.pay04_stamp_runtime_guard();

CREATE OR REPLACE FUNCTION public.pay04_gateway_permitted(p_gateway text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_gateway = 'pay04_garage_provider_simulator'
     AND coalesce((SELECT garage_simulator_enabled FROM public.pay04_runtime_guard WHERE singleton), false);
$$;

-- ─────────────────────────── 1. the garage's merchant identity at a provider ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay04_garage_merchant_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  gateway text NOT NULL CHECK (gateway IN ('pay04_garage_provider_simulator')),
  merchant_reference text NOT NULL CHECK (merchant_reference ~ '^gsim_merchant_[A-Za-z0-9_]{4,64}$'),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
  currencies text[] NOT NULL CHECK (cardinality(currencies) >= 1),
  status text NOT NULL CHECK (status IN ('simulated', 'suspended')),
  authority_note text NOT NULL CHECK (char_length(btrim(authority_note)) BETWEEN 10 AND 500),
  registered_by text NOT NULL,
  registered_role text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  suspended_by text,
  suspended_reason text,
  suspended_at timestamptz,
  CONSTRAINT pay04_merchant_reference_unique UNIQUE (gateway, merchant_reference),
  CONSTRAINT pay04_merchant_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT pay04_merchant_suspension_truth CHECK (
    (status = 'suspended') = (suspended_at IS NOT NULL AND suspended_by IS NOT NULL AND suspended_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_one_live_merchant_per_garage_gateway
  ON public.pay04_garage_merchant_accounts (tenant_id, gateway) WHERE status <> 'suspended';

-- ─────────────────────────── 2. collections (one provider checkout for one invoice) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay04_garage_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  merchant_account_id uuid NOT NULL,
  gateway text NOT NULL CHECK (gateway IN ('pay04_garage_provider_simulator')),
  payer_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_scale smallint NOT NULL CHECK (currency_scale IN (0, 2)),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payment_reference text NOT NULL UNIQUE REFERENCES public.payment_transactions(reference),
  provider_checkout_id text CHECK (provider_checkout_id IS NULL OR provider_checkout_id ~ '^gsim_co_[A-Za-z0-9_]+$'),
  provider_payment_id text CHECK (provider_payment_id IS NULL OR provider_payment_id ~ '^sim_pi_gar_[A-Za-z0-9_]+$'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
  initiated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  last_provider_status text,
  last_observed_at timestamptz,
  -- the provider's latest refund figures (succeeded / pending), from the governed snapshot writer only
  observed_refunded_minor bigint CHECK (observed_refunded_minor IS NULL OR observed_refunded_minor >= 0),
  observed_pending_refund_minor bigint CHECK (observed_pending_refund_minor IS NULL OR observed_pending_refund_minor >= 0),
  CONSTRAINT pay04_collection_invoice_fk FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES public.garage_invoices(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay04_collection_merchant_fk FOREIGN KEY (merchant_account_id, tenant_id)
    REFERENCES public.pay04_garage_merchant_accounts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay04_collection_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT pay04_collection_payer_key_unique UNIQUE (payer_user_id, idempotency_key),
  CONSTRAINT pay04_collection_amount_minor_truth CHECK (amount_minor = round(amount * (10 ^ currency_scale))::bigint),
  CONSTRAINT pay04_collection_expiry_after_start CHECK (expires_at > initiated_at),
  CONSTRAINT pay04_collection_cancel_truth CHECK (
    (cancelled_at IS NULL) = (cancelled_by IS NULL) AND (cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_collection_checkout ON public.pay04_garage_collections (provider_checkout_id) WHERE provider_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_collection_payment ON public.pay04_garage_collections (provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay04_collections_invoice ON public.pay04_garage_collections (invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay04_collections_tenant ON public.pay04_garage_collections (tenant_id, initiated_at DESC);

-- ─────────────────────────── 3. allocation ledger (append-only) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay04_garage_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('allocation', 'deallocation')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cause text NOT NULL CHECK (cause ~ '^[a-z_:]{3,80}$'),
  provider_event_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pay04_allocation_collection_fk FOREIGN KEY (collection_id, tenant_id)
    REFERENCES public.pay04_garage_collections(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay04_allocation_invoice_fk FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES public.garage_invoices(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pay04_allocations_invoice ON public.pay04_garage_payment_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay04_allocations_collection ON public.pay04_garage_payment_allocations (collection_id, seq);

-- ─────────────────────────── 4. provider receipts (share the garage's RCT- counter) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay04_garage_provider_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  receipt_number text NOT NULL,
  invoice_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  payment_reference text NOT NULL REFERENCES public.payment_transactions(reference),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_source text NOT NULL CHECK (payment_source = 'provider_confirmed'),
  status text NOT NULL CHECK (status IN ('issued', 'voided')),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  voided_at timestamptz,
  void_reason text,
  CONSTRAINT pay04_receipt_number_unique UNIQUE (tenant_id, receipt_number),
  CONSTRAINT pay04_receipt_void_truth CHECK ((status = 'voided') = (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT pay04_receipt_collection_fk FOREIGN KEY (collection_id, tenant_id)
    REFERENCES public.pay04_garage_collections(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay04_receipt_invoice_fk FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES public.garage_invoices(id, tenant_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_one_live_receipt_per_collection
  ON public.pay04_garage_provider_receipts (collection_id) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS idx_pay04_receipts_invoice ON public.pay04_garage_provider_receipts (invoice_id);

-- ─────────────────────────── 5. collection history, provider event receipts, discrepancies ───────────────────────────

CREATE TABLE IF NOT EXISTS public.pay04_garage_collection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'initiated', 'provider_attached', 'provider_observed', 'allocated', 'deallocated', 'receipt_issued', 'receipt_voided',
    'refund_requested', 'cancelled', 'discrepancy_opened', 'discrepancy_observed', 'discrepancy_resolved')),
  actor text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pay04_event_collection_fk FOREIGN KEY (collection_id, tenant_id)
    REFERENCES public.pay04_garage_collections(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pay04_collection_events ON public.pay04_garage_collection_events (collection_id, seq);
CREATE INDEX IF NOT EXISTS idx_pay04_collection_events_invoice ON public.pay04_garage_collection_events (invoice_id, seq);

CREATE TABLE IF NOT EXISTS public.pay04_provider_event_receipts (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_gsim_[A-Za-z0-9_]+$'),
  gateway text NOT NULL,
  collection_id uuid NOT NULL REFERENCES public.pay04_garage_collections(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  resulting_state text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.pay04_garage_payment_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  payment_reference text NOT NULL REFERENCES public.payment_transactions(reference),
  discrepancy_type text NOT NULL CHECK (discrepancy_type IN (
    'unallocated_provider_money', 'amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'refund_after_resolution')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  detected_amount numeric(14,2),
  currency text,
  evidence jsonb NOT NULL,
  detected_via text NOT NULL CHECK (detected_via IN ('signed_webhook', 'provider_readback', 'reprojection')),
  provider_event_id text,
  first_detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_evidence jsonb,
  resolution text CHECK (resolution IS NULL OR resolution IN ('refunded_to_customer', 'settled_off_platform', 'provider_corrected',
                                                               'counted_on_invoice', 'acknowledged')),
  resolved_by text,
  resolved_role text,
  resolution_note text,
  resolved_at timestamptz,
  CONSTRAINT pay04_discrepancy_collection_fk FOREIGN KEY (collection_id, tenant_id)
    REFERENCES public.pay04_garage_collections(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pay04_discrepancy_open_truth CHECK ((status = 'open') = (resolution IS NULL)),
  CONSTRAINT pay04_discrepancy_resolution_attributed CHECK (
    status = 'open' OR (resolved_by IS NOT NULL AND resolved_role IS NOT NULL AND resolved_at IS NOT NULL
                        AND char_length(btrim(coalesce(resolution_note, ''))) >= 10))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_one_open_discrepancy_per_type
  ON public.pay04_garage_payment_discrepancies (collection_id, discrepancy_type) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_pay04_discrepancies_open ON public.pay04_garage_payment_discrepancies (status, first_detected_at DESC);

-- ─────────────────────────── 6. guards ───────────────────────────

CREATE OR REPLACE FUNCTION public.pay04_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'PAY04_APPEND_ONLY'; END $$;
DROP TRIGGER IF EXISTS trg_pay04_allocations_append_only ON public.pay04_garage_payment_allocations;
CREATE TRIGGER trg_pay04_allocations_append_only BEFORE UPDATE OR DELETE ON public.pay04_garage_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();
DROP TRIGGER IF EXISTS trg_pay04_events_append_only ON public.pay04_garage_collection_events;
CREATE TRIGGER trg_pay04_events_append_only BEFORE UPDATE OR DELETE ON public.pay04_garage_collection_events
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();
DROP TRIGGER IF EXISTS trg_pay04_event_receipts_append_only ON public.pay04_provider_event_receipts;
CREATE TRIGGER trg_pay04_event_receipts_append_only BEFORE UPDATE OR DELETE ON public.pay04_provider_event_receipts
  FOR EACH ROW EXECUTE FUNCTION public.pay04_append_only();

CREATE OR REPLACE FUNCTION public.pay04_guard_merchant_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE'; END IF;
  IF OLD.status <> 'simulated' OR NEW.status <> 'suspended'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.gateway IS DISTINCT FROM OLD.gateway
     OR NEW.merchant_reference IS DISTINCT FROM OLD.merchant_reference OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.currencies IS DISTINCT FROM OLD.currencies OR NEW.authority_note IS DISTINCT FROM OLD.authority_note
     OR NEW.registered_by IS DISTINCT FROM OLD.registered_by OR NEW.registered_role IS DISTINCT FROM OLD.registered_role
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_merchant_account ON public.pay04_garage_merchant_accounts;
CREATE TRIGGER trg_pay04_guard_merchant_account BEFORE UPDATE OR DELETE ON public.pay04_garage_merchant_accounts
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_merchant_account();

-- A collection's identity never changes; provider identifiers and the cancellation are written once.
CREATE OR REPLACE FUNCTION public.pay04_guard_collection()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY04_COLLECTION_IMMUTABLE'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.merchant_account_id IS DISTINCT FROM OLD.merchant_account_id OR NEW.gateway IS DISTINCT FROM OLD.gateway
     OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.currency_scale IS DISTINCT FROM OLD.currency_scale OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.initiated_at IS DISTINCT FROM OLD.initiated_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.provider_checkout_id IS NOT NULL AND NEW.provider_checkout_id IS DISTINCT FROM OLD.provider_checkout_id)
     OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
     OR (OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
         OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason))
     OR (OLD.last_observed_at IS NOT NULL AND (NEW.last_observed_at IS NULL OR NEW.last_observed_at < OLD.last_observed_at)) THEN
    RAISE EXCEPTION 'PAY04_COLLECTION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_collection ON public.pay04_garage_collections;
CREATE TRIGGER trg_pay04_guard_collection BEFORE UPDATE OR DELETE ON public.pay04_garage_collections
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_collection();

CREATE OR REPLACE FUNCTION public.pay04_guard_discrepancy()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY04_DISCREPANCY_IMMUTABLE'; END IF;
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'PAY04_DISCREPANCY_CLOSED_IMMUTABLE'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.collection_id IS DISTINCT FROM OLD.collection_id OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.discrepancy_type IS DISTINCT FROM OLD.discrepancy_type OR NEW.detected_amount IS DISTINCT FROM OLD.detected_amount
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.detected_via IS DISTINCT FROM OLD.detected_via OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.first_detected_at IS DISTINCT FROM OLD.first_detected_at THEN
    RAISE EXCEPTION 'PAY04_DISCREPANCY_EVIDENCE_IMMUTABLE';
  END IF;
  IF NEW.observation_count < OLD.observation_count OR NEW.last_observed_at < OLD.last_observed_at THEN
    RAISE EXCEPTION 'PAY04_DISCREPANCY_OBSERVATION_REGRESSION';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_discrepancy ON public.pay04_garage_payment_discrepancies;
CREATE TRIGGER trg_pay04_guard_discrepancy BEFORE UPDATE OR DELETE ON public.pay04_garage_payment_discrepancies
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_discrepancy();

-- ─────────────────────────── 7. derived money ───────────────────────────

CREATE OR REPLACE FUNCTION public.pay04_collection_allocated(p_collection_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(CASE WHEN kind = 'allocation' THEN amount ELSE -amount END), 0)::numeric(14,2)
    FROM public.pay04_garage_payment_allocations WHERE collection_id = p_collection_id;
$$;

-- A final partial refund (operator-verified through F5) and what the provider has reported since. The garage keeps for
-- certain only what is left after EVERY refund the provider reports, pending ones included (counted); what it keeps
-- only if the pending refunds fail is held (neither counted nor free for another payment). `extra_minor` is refund the
-- provider reports beyond the operator-verified figure — the operator is told. NULL figures when no verified evidence.
CREATE OR REPLACE FUNCTION public.pay04_partial_refund_position(p_collection public.pay04_garage_collections)
RETURNS TABLE (verified_minor bigint, counted_minor bigint, held_minor bigint, extra_minor bigint)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_refunded bigint; v_pending bigint;
BEGIN
  SELECT (e.resolution_evidence->>'verified_refunded_minor')::bigint INTO verified_minor
    FROM public.pay03b_payment_reconciliation_exceptions e
   WHERE e.payment_reference = p_collection.payment_reference AND e.status = 'resolved'
     AND e.resolution = 'revoke_access_partial_refund_final'
   ORDER BY e.resolved_at DESC LIMIT 1;
  IF verified_minor IS NULL OR verified_minor <= 0 OR verified_minor >= p_collection.amount_minor THEN
    verified_minor := NULL; RETURN NEXT; RETURN;
  END IF;
  v_refunded := greatest(verified_minor, coalesce(p_collection.observed_refunded_minor, 0));
  v_pending := coalesce(p_collection.observed_pending_refund_minor, 0);
  counted_minor := greatest(p_collection.amount_minor - v_refunded - v_pending, 0);
  held_minor := greatest(p_collection.amount_minor - v_refunded, 0) - counted_minor;
  extra_minor := least(v_refunded + v_pending, p_collection.amount_minor) - verified_minor;
  RETURN NEXT;
END $$;

-- The whole money picture of one invoice. 'reserved' is provider money in flight that nothing else may commit.
CREATE OR REPLACE FUNCTION public.pay04_invoice_money(p_invoice_id uuid)
RETURNS TABLE (
  invoice_id uuid, currency text, invoice_status text, total_amount numeric, declared_paid numeric, provider_paid numeric,
  paid_amount numeric, balance_amount numeric, provider_reserved numeric, uncommitted_balance numeric, payment_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH inv AS (SELECT * FROM public.garage_invoices WHERE id = p_invoice_id),
  d AS (SELECT COALESCE(sum(CASE WHEN r.kind = 'payment' THEN r.amount ELSE -r.amount END), 0) AS net
          FROM public.garage_payment_records r WHERE r.invoice_id = p_invoice_id),
  a AS (SELECT COALESCE(sum(CASE WHEN x.kind = 'allocation' THEN x.amount ELSE -x.amount END), 0) AS net
          FROM public.pay04_garage_payment_allocations x WHERE x.invoice_id = p_invoice_id),
  -- A pending checkout stays reserved until the PROVIDER says it is closed: a stop or CarUp's own expiry is not proof
  -- that it cannot still be paid. Refunds in progress, holds and disagreeing evidence are reserved too, and so are the
  -- pending refunds of a final partial refund (they may still fail and the money come back).
  r AS (
    SELECT COALESCE(sum(CASE
             WHEN p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
               OR EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q
                           WHERE q.collection_id = c.id AND q.status = 'open'
                             AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch'))
               THEN greatest(c.amount - public.pay04_collection_allocated(c.id), 0)
             WHEN p.status = 'partially_refunded'
               THEN coalesce((SELECT x.held_minor FROM public.pay04_partial_refund_position(c) x), 0)::numeric
                    / (10 ^ c.currency_scale)::numeric
             ELSE 0 END), 0) AS reserved
      FROM public.pay04_garage_collections c
      JOIN public.payment_transactions p ON p.reference = c.payment_reference
     WHERE c.invoice_id = p_invoice_id)
  SELECT inv.id, inv.currency, inv.status, inv.total_amount::numeric(14,2), d.net::numeric(14,2), a.net::numeric(14,2),
         (d.net + a.net)::numeric(14,2), (inv.total_amount - d.net - a.net)::numeric(14,2), r.reserved::numeric(14,2),
         greatest(inv.total_amount - d.net - a.net - r.reserved, 0)::numeric(14,2),
         CASE WHEN inv.status = 'voided' THEN 'voided'
              WHEN d.net + a.net = 0 THEN 'unpaid'
              WHEN d.net + a.net < inv.total_amount THEN 'partially_paid'
              ELSE 'paid' END
    FROM inv, d, a, r;
$$;

-- OPS07's derived balance, re-created with the SAME signature and vocabulary: declared net + provider allocated net.
-- For an invoice without provider allocations every value is identical to 20261024130000 (certified by fingerprint).
CREATE OR REPLACE FUNCTION public.garage_ops07_invoice_balance(p_invoice_id UUID)
RETURNS TABLE (total_amount NUMERIC, paid_amount NUMERIC, balance_amount NUMERIC, payment_status TEXT)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT i.total_amount::numeric(14,2),
         (COALESCE(p.net, 0) + COALESCE(a.net, 0))::numeric(14,2),
         (i.total_amount - COALESCE(p.net, 0) - COALESCE(a.net, 0))::numeric(14,2),
         CASE
           WHEN i.status = 'voided' THEN 'voided'
           WHEN COALESCE(p.net, 0) + COALESCE(a.net, 0) = 0 THEN 'unpaid'
           WHEN COALESCE(p.net, 0) + COALESCE(a.net, 0) < i.total_amount THEN 'partially_paid'
           ELSE 'paid'
         END
    FROM garage_invoices i
    LEFT JOIN LATERAL (
      SELECT sum(CASE WHEN r.kind = 'payment' THEN r.amount ELSE -r.amount END) AS net
        FROM garage_payment_records r WHERE r.invoice_id = i.id
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT sum(CASE WHEN x.kind = 'allocation' THEN x.amount ELSE -x.amount END) AS net
        FROM pay04_garage_payment_allocations x WHERE x.invoice_id = i.id
    ) a ON true
   WHERE i.id = p_invoice_id
$$;

-- An allocation row is written only by the governed writer and keeps every money invariant on its own.
CREATE OR REPLACE FUNCTION public.pay04_guard_allocation_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.pay04_garage_collections%ROWTYPE;
  v_inv public.garage_invoices%ROWTYPE;
  v_net numeric;
  v_declared numeric;
  v_provider numeric;
BEGIN
  IF coalesce(current_setting('carup.pay04_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'PAY04_ALLOCATION_REQUIRES_GOVERNED_WRITER';
  END IF;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = NEW.collection_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND OR v_c.invoice_id <> NEW.invoice_id OR v_c.currency <> NEW.currency THEN
    RAISE EXCEPTION 'PAY04_ALLOCATION_BINDING_INVALID';
  END IF;
  v_net := public.pay04_collection_allocated(v_c.id) + CASE WHEN NEW.kind = 'allocation' THEN NEW.amount ELSE -NEW.amount END;
  IF v_net < 0 OR v_net > v_c.amount THEN RAISE EXCEPTION 'PAY04_ALLOCATION_OUT_OF_RANGE'; END IF;
  IF NEW.kind = 'allocation' THEN
    SELECT * INTO v_inv FROM public.garage_invoices WHERE id = NEW.invoice_id;
    IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'PAY04_ALLOCATION_INVOICE_NOT_PAYABLE'; END IF;
    SELECT COALESCE(sum(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0) INTO v_declared
      FROM public.garage_payment_records WHERE invoice_id = NEW.invoice_id;
    SELECT COALESCE(sum(CASE WHEN kind = 'allocation' THEN amount ELSE -amount END), 0) INTO v_provider
      FROM public.pay04_garage_payment_allocations WHERE invoice_id = NEW.invoice_id;
    IF v_declared + v_provider + NEW.amount > v_inv.total_amount THEN
      RAISE EXCEPTION 'PAY04_OVER_ALLOCATION_REFUSED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_allocation_insert ON public.pay04_garage_payment_allocations;
CREATE TRIGGER trg_pay04_guard_allocation_insert BEFORE INSERT ON public.pay04_garage_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_allocation_insert();

-- A provider receipt exists only for money currently counted, from the governed writer, with a number no OPS07 receipt
-- of the garage holds. Afterwards it may only be voided.
CREATE OR REPLACE FUNCTION public.pay04_guard_provider_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY04_RECEIPTS_ARE_NEVER_DELETED'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('carup.pay04_writer', true), '') <> 'on' THEN
      RAISE EXCEPTION 'PAY04_RECEIPT_REQUIRES_GOVERNED_WRITER';
    END IF;
    IF NEW.status <> 'issued' OR NEW.amount <> public.pay04_collection_allocated(NEW.collection_id)
       OR EXISTS (SELECT 1 FROM public.garage_receipts WHERE tenant_id = NEW.tenant_id AND receipt_number = NEW.receipt_number) THEN
      RAISE EXCEPTION 'PAY04_RECEIPT_REQUIRES_COUNTED_PAYMENT';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'issued' OR NEW.status <> 'voided'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.collection_id IS DISTINCT FROM OLD.collection_id OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.payment_source IS DISTINCT FROM OLD.payment_source OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'PAY04_RECEIPT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_provider_receipt ON public.pay04_garage_provider_receipts;
CREATE TRIGGER trg_pay04_guard_provider_receipt BEFORE INSERT OR UPDATE OR DELETE ON public.pay04_garage_provider_receipts
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_provider_receipt();

-- OPS07 paths, guarded additively: a declared payment may not commit reserved money; an invoice cannot be voided while
-- provider money is counted, in flight or present.
CREATE OR REPLACE FUNCTION public.pay04_guard_declared_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_m record;
BEGIN
  IF NEW.kind <> 'payment' THEN RETURN NEW; END IF;
  SELECT * INTO v_m FROM public.pay04_invoice_money(NEW.invoice_id);
  IF NEW.amount > v_m.uncommitted_balance THEN
    RAISE EXCEPTION 'PAY04_PAYMENT_EXCEEDS_UNCOMMITTED_BALANCE'
      USING DETAIL = format('uncommitted=%s reserved=%s', v_m.uncommitted_balance, v_m.provider_reserved);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_declared_payment ON public.garage_payment_records;
CREATE TRIGGER trg_pay04_guard_declared_payment BEFORE INSERT ON public.garage_payment_records
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_declared_payment();

CREATE OR REPLACE FUNCTION public.pay04_guard_invoice_void()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_m record;
BEGIN
  IF OLD.status = 'issued' AND NEW.status = 'voided' THEN
    SELECT * INTO v_m FROM public.pay04_invoice_money(OLD.id);
    IF v_m.provider_paid <> 0 OR EXISTS (
         SELECT 1 FROM public.pay04_garage_collections c JOIN public.payment_transactions p ON p.reference = c.payment_reference
          WHERE c.invoice_id = OLD.id AND p.status IN ('paid', 'partially_refunded')) THEN
      RAISE EXCEPTION 'PAY04_INVOICE_HAS_PROVIDER_PAYMENTS';
    END IF;
    IF v_m.provider_reserved <> 0 THEN RAISE EXCEPTION 'PAY04_INVOICE_HAS_PAYMENT_IN_PROGRESS'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay04_guard_invoice_void ON public.garage_invoices;
CREATE TRIGGER trg_pay04_guard_invoice_void BEFORE UPDATE ON public.garage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pay04_guard_invoice_void();

-- ─────────────────────────── 8. PAY-03B F5, extended (one bounded garage branch per function) ───────────────────────────

-- 8a. Identifier shapes: the garage simulator shares the simulator shapes (sim_pi_/sim_re_); Stripe rows keep pi_/re_.
-- Byte-identical to 20261101120000 except the two identifier-shape CASE conditions (asserted by
-- backend/tests/pay04-f5-extension-drift.test.js).
CREATE OR REPLACE FUNCTION public.pay03b_payment_transition_target(
  p_row public.payment_transactions,
  p_amount_minor bigint,
  p_status text,
  p_intent_id text,
  p_refund_id text,
  p_refunded_minor bigint,
  p_pending_refund_minor bigint,
  p_refund_ids text[],
  p_mismatch text,
  p_detected_via text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_target text := p_status;
  v_retained boolean := false;
  v_ref text;
  v_intent_pattern text;
  v_refund_pattern text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  IF p_detected_via IS NOT NULL AND p_detected_via NOT IN ('signed_webhook', 'provider_readback') THEN
    RAISE EXCEPTION 'PAY03B_DETECTION_SOURCE_INVALID';
  END IF;

  -- A held or finally-revoked payment never returns to an access-granting state from a provider observation;
  -- only a provider-confirmed full refund (or the operator resolution RPC) moves it.
  IF p_row.status = 'reconciliation_hold' THEN
    IF p_status = 'refunded' THEN
      v_target := 'refunded';
    ELSIF p_status IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
      v_target := 'reconciliation_hold';
      v_retained := p_status <> 'reconciliation_hold';
    ELSE
      RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
    END IF;
  ELSIF p_row.status = 'partially_refunded' THEN
    IF p_status = 'refunded' THEN
      v_target := 'refunded';
    ELSIF p_status IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
      v_target := 'partially_refunded';
      v_retained := true;
    ELSE
      RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
    END IF;
  ELSIF NOT (
    (p_row.status = 'pending' AND p_status IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'paid' AND p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'refund_pending' AND p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'refunded' AND p_status = 'refunded')
    OR (p_row.status = 'cancelled' AND p_status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
  END IF;

  -- Provider identifier shapes are bound to the payment's gateway (the local UAT simulator never passes as Stripe).
  v_intent_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_pi_[A-Za-z0-9_]+$'
                           ELSE '^pi_[A-Za-z0-9_]+$' END;
  v_refund_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_re_[A-Za-z0-9_]+$'
                           ELSE '^(re|pyr)_[A-Za-z0-9_]+$' END;
  -- Leaving a hold (or a final partial refund) for 'refunded' requires the provider's full-refund evidence: a caller
  -- without amounts (for example the legacy PAY-01A writer) cannot close an exception as a "provider full refund".
  IF p_row.status IN ('reconciliation_hold', 'partially_refunded') AND v_target = 'refunded'
     AND (p_refunded_minor IS DISTINCT FROM p_amount_minor OR coalesce(p_pending_refund_minor, 0) <> 0) THEN
    RAISE EXCEPTION 'PAY03B_FULL_REFUND_EVIDENCE_REQUIRED';
  END IF;

  IF p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold') AND
    (p_intent_id IS NULL OR p_intent_id !~ v_intent_pattern) THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_REQUIRED';
  END IF;
  IF p_row.pay01a_intent_id IS NOT NULL AND p_intent_id IS NOT NULL
     AND p_intent_id IS DISTINCT FROM p_row.pay01a_intent_id THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_CHANGE_REFUSED';
  END IF;
  IF p_refund_id IS NOT NULL AND p_refund_id !~ v_refund_pattern THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_INVALID';
  END IF;
  IF p_row.pay01a_refund_id IS NOT NULL AND p_refund_id IS NOT NULL AND p_refund_id <> p_row.pay01a_refund_id THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_CHANGE_REFUSED';
  END IF;

  -- Policy-conflict evidence must be complete and internally consistent before it can hold a payment.
  IF p_status = 'reconciliation_hold' THEN
    IF p_mismatch IS NULL OR p_mismatch NOT IN ('partial_refund_succeeded', 'partial_refund_pending')
       OR p_amount_minor IS NULL OR p_amount_minor <= 0
       OR p_refunded_minor IS NULL OR p_pending_refund_minor IS NULL
       OR p_refunded_minor < 0 OR p_pending_refund_minor < 0
       OR p_refunded_minor + p_pending_refund_minor > p_amount_minor
       OR (p_mismatch = 'partial_refund_succeeded'
           AND (p_refunded_minor <= 0 OR p_refunded_minor >= p_amount_minor))
       OR (p_mismatch = 'partial_refund_pending'
           AND (p_refunded_minor <> 0 OR p_pending_refund_minor <= 0 OR p_pending_refund_minor >= p_amount_minor))
       OR p_refund_ids IS NULL OR cardinality(p_refund_ids) = 0
       OR p_detected_via IS NULL
       OR p_refund_id IS NOT NULL THEN
      RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_INVALID';
    END IF;
    FOREACH v_ref IN ARRAY p_refund_ids LOOP
      IF v_ref IS NULL OR v_ref !~ v_refund_pattern THEN
        RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_INVALID';
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('target_status', v_target, 'hold_retained', v_retained);
END $$;


-- 8b. Owner lock: garage collections serialize on their invoice before the payment-reference lock (as the writers do).
CREATE OR REPLACE FUNCTION public.pay03b_payment_owner_lock(p_reference text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_subscription uuid; v_invoice uuid;
BEGIN
  SELECT subscription_id INTO v_subscription FROM public.pay03b_subscription_invoices WHERE payment_reference = p_reference;
  IF v_subscription IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('carup_pay03b_sub:' || v_subscription::text));
  END IF;
  -- PAY-04: a garage collection's owner is its invoice
  SELECT invoice_id INTO v_invoice FROM public.pay04_garage_collections WHERE payment_reference = p_reference;
  IF v_invoice IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_invoice::text));
  END IF;
END $$;

-- 8c. After an operator resolution: re-project the garage invoice allocation and receipt in the same transaction.
CREATE OR REPLACE FUNCTION public.pay03b_after_payment_resolution(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_subscription uuid;
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_collection uuid;
BEGIN
  -- PAY-04: a garage collection (references are pay04_gar_*, never pay03b_inv_*, so the order is immaterial)
  SELECT id INTO v_collection FROM public.pay04_garage_collections WHERE payment_reference = p_reference;
  IF v_collection IS NOT NULL THEN
    RETURN public.pay04_reproject_garage_collection(v_collection, 'reconciliation_resolution', NULL);
  END IF;
  SELECT subscription_id INTO v_subscription FROM public.pay03b_subscription_invoices WHERE payment_reference = p_reference;
  IF v_subscription IS NULL THEN RETURN NULL; END IF;
  v_sub := public.pay03b_refresh_paid_coverage(v_subscription, 'reconciliation_resolution', NULL);
  RETURN jsonb_build_object('subscription_id', v_sub.id, 'paid_through', v_sub.paid_through,
    'access', public.pay03b_subscription_access(v_sub, clock_timestamp()));
END $$;

-- 8d. Separation of duties: the payer and every member of the beneficiary garage are conflicted.
CREATE OR REPLACE FUNCTION public.pay03b_payment_payer_conflict(p_reference text, p_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.payment_transactions WHERE reference = p_reference AND pay01a_actor_id = p_actor_id)
      OR EXISTS (SELECT 1 FROM public.pay03b_subscription_invoices i
                 JOIN public.tenant_users tu ON tu.tenant_id = i.owner_tenant_id
                 WHERE i.payment_reference = p_reference AND tu.user_id = p_actor_id)
      -- PAY-04
      OR EXISTS (SELECT 1 FROM public.pay04_garage_collections c
                 JOIN public.tenant_users tu ON tu.tenant_id = c.tenant_id
                 WHERE c.payment_reference = p_reference AND tu.user_id = p_actor_id);
$$;

-- ─────────────────────────── 9. internal helpers (no API role may call them) ───────────────────────────

CREATE OR REPLACE FUNCTION public.pay04_is_invoice_customer(p_invoice_id uuid, p_user_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.garage_invoices i JOIN public.service_cases c ON c.id = i.service_case_id
     WHERE i.id = p_invoice_id
       AND (c.requester_user_id = p_user_id
            OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.vin = c.vin AND v.owner_id = p_user_id)));
$$;

CREATE OR REPLACE FUNCTION public.pay04_log(
  p_collection public.pay04_garage_collections, p_event text, p_actor text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_vin text; v_role text;
BEGIN
  INSERT INTO public.pay04_garage_collection_events (tenant_id, invoice_id, collection_id, event_type, actor, detail)
  VALUES (p_collection.tenant_id, p_collection.invoice_id, p_collection.id, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
  SELECT c.vin INTO v_vin FROM public.garage_invoices i JOIN public.service_cases c ON c.id = i.service_case_id
   WHERE i.id = p_collection.invoice_id;
  SELECT role INTO v_role FROM public.users WHERE id = p_actor;
  INSERT INTO public.trust_audit_events (event_type, vin, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('GARAGE_PROVIDER_PAYMENT_' || upper(p_event), v_vin, 'service_relationship',
          jsonb_build_object('collection_id', p_collection.id, 'invoice_id', p_collection.invoice_id,
                             'payment_reference', p_collection.payment_reference) || coalesce(p_detail, '{}'::jsonb),
          CASE WHEN p_actor LIKE 'provider:%' THEN NULL ELSE p_actor END,
          CASE WHEN p_actor LIKE 'provider:%' THEN 'provider_confirmation' ELSE v_role END,
          p_collection.tenant_id::text,
          CASE WHEN p_actor LIKE 'provider:%' THEN 'system' ELSE 'user' END,
          '/api/garage/payments/provider');
END $$;

CREATE OR REPLACE FUNCTION public.pay04_record_discrepancy(
  p_collection public.pay04_garage_collections, p_type text, p_amount numeric, p_evidence jsonb, p_via text, p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_row public.pay04_garage_payment_discrepancies%ROWTYPE; v_event text;
BEGIN
  UPDATE public.pay04_garage_payment_discrepancies SET
    observation_count = observation_count + 1,
    last_observed_at = greatest(last_observed_at, clock_timestamp()),
    last_evidence = p_evidence
  WHERE collection_id = p_collection.id AND discrepancy_type = p_type AND status = 'open'
  RETURNING * INTO v_row;
  IF FOUND THEN
    v_event := 'discrepancy_observed';
  ELSE
    INSERT INTO public.pay04_garage_payment_discrepancies (
      tenant_id, invoice_id, collection_id, payment_reference, discrepancy_type, detected_amount, currency, evidence,
      detected_via, provider_event_id)
    VALUES (p_collection.tenant_id, p_collection.invoice_id, p_collection.id, p_collection.payment_reference, p_type,
      p_amount, p_collection.currency, p_evidence, p_via, p_event_id)
    RETURNING * INTO v_row;
    v_event := 'discrepancy_opened';
  END IF;
  PERFORM public.pay04_log(p_collection, v_event, 'provider:' || p_collection.gateway,
    jsonb_build_object('discrepancy_id', v_row.id, 'discrepancy_type', p_type, 'amount', p_amount::text));
  RETURN jsonb_build_object('discrepancy_id', v_row.id, 'discrepancy_type', p_type, 'event', v_event);
END $$;

-- The single re-projection of one collection onto its invoice: allocation follows the canonical payment state, never
-- exceeds what the invoice still owes, and the collection holds exactly one live receipt equal to the counted amount
-- (or none). The caller holds the invoice advisory lock and the payment-reference lock.
CREATE OR REPLACE FUNCTION public.pay04_reproject_garage_collection(p_collection_id uuid, p_cause text, p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_inv public.garage_invoices%ROWTYPE;
  v_receipt public.pay04_garage_provider_receipts%ROWTYPE;
  v_target numeric;
  v_current numeric;
  v_alloc numeric;
  v_delta numeric;
  v_room numeric;
  v_declared numeric;
  v_provider numeric;
  v_pos record;
  v_unallocated numeric;
  v_receipt_out jsonb := NULL;
  v_discrepancy jsonb := NULL;
  v_actor text;
BEGIN
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  SELECT * INTO v_inv FROM public.garage_invoices WHERE id = v_c.invoice_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference;
  v_actor := 'provider:' || v_c.gateway;
  PERFORM set_config('carup.pay04_writer', 'on', true);

  IF v_p.status = 'paid' THEN
    v_target := v_c.amount;
  ELSIF v_p.status = 'partially_refunded' THEN
    -- the operator's verified final partial refund is a floor, never a licence to ignore what the provider reports later
    SELECT * INTO v_pos FROM public.pay04_partial_refund_position(v_c);
    IF v_pos.verified_minor IS NULL THEN RAISE EXCEPTION 'PAY04_PARTIAL_REFUND_EVIDENCE_MISSING'; END IF;
    v_target := (v_pos.counted_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2);
    IF v_pos.extra_minor > 0 THEN
      v_discrepancy := public.pay04_record_discrepancy(v_c, 'refund_after_resolution',
        (v_pos.extra_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2),
        jsonb_build_object('verified_refunded_minor', v_pos.verified_minor, 'observed_refunded_minor', v_c.observed_refunded_minor,
                           'observed_pending_refund_minor', v_c.observed_pending_refund_minor, 'cause', p_cause),
        'reprojection', p_event_id);
    END IF;
  ELSE
    -- pending, cancelled, refund_pending, refunded, reconciliation_hold: nothing counts (fail closed)
    v_target := 0;
  END IF;
  -- nothing counts while the provider's own evidence disagrees with the collection (a later mismatch un-counts)
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id AND q.status = 'open'
               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch')) THEN
    v_target := 0;
  END IF;

  v_current := public.pay04_collection_allocated(v_c.id);
  -- money an operator settled OFF the platform never starts counting here, even if room appears later
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id
               AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'resolved' AND q.resolution = 'settled_off_platform') THEN
    v_target := least(v_target, v_current);
  END IF;
  IF v_inv.status <> 'issued' THEN
    v_alloc := least(v_current, v_target);
  ELSE
    SELECT COALESCE(sum(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0) INTO v_declared
      FROM public.garage_payment_records WHERE invoice_id = v_inv.id;
    SELECT COALESCE(sum(CASE WHEN kind = 'allocation' THEN amount ELSE -amount END), 0) INTO v_provider
      FROM public.pay04_garage_payment_allocations WHERE invoice_id = v_inv.id;
    v_room := v_inv.total_amount - v_declared - (v_provider - v_current);
    v_alloc := greatest(least(v_target, v_room), 0);
  END IF;
  v_delta := v_alloc - v_current;
  IF v_delta > 0 THEN
    INSERT INTO public.pay04_garage_payment_allocations (tenant_id, invoice_id, collection_id, kind, amount, currency, cause, provider_event_id)
    VALUES (v_c.tenant_id, v_c.invoice_id, v_c.id, 'allocation', v_delta, v_c.currency, p_cause, p_event_id);
    PERFORM public.pay04_log(v_c, 'allocated', v_actor, jsonb_build_object('amount', v_delta::text, 'cause', p_cause));
  ELSIF v_delta < 0 THEN
    INSERT INTO public.pay04_garage_payment_allocations (tenant_id, invoice_id, collection_id, kind, amount, currency, cause, provider_event_id)
    VALUES (v_c.tenant_id, v_c.invoice_id, v_c.id, 'deallocation', -v_delta, v_c.currency, p_cause, p_event_id);
    PERFORM public.pay04_log(v_c, 'deallocated', v_actor, jsonb_build_object('amount', (-v_delta)::text, 'cause', p_cause));
  END IF;

  SELECT * INTO v_receipt FROM public.pay04_garage_provider_receipts
   WHERE collection_id = v_c.id AND status = 'issued' FOR UPDATE;
  IF FOUND AND (v_alloc = 0 OR v_receipt.amount <> v_alloc) THEN
    UPDATE public.pay04_garage_provider_receipts SET status = 'voided', voided_at = clock_timestamp(), void_reason = p_cause
     WHERE id = v_receipt.id;
    PERFORM public.pay04_log(v_c, 'receipt_voided', v_actor,
      jsonb_build_object('receipt_number', v_receipt.receipt_number, 'amount', v_receipt.amount::text, 'cause', p_cause));
    v_receipt_out := jsonb_build_object('voided', v_receipt.receipt_number);
    v_receipt := NULL;
  END IF;
  IF v_alloc > 0 AND v_receipt.id IS NULL THEN
    INSERT INTO public.pay04_garage_provider_receipts (
      tenant_id, receipt_number, invoice_id, collection_id, payment_reference, amount, currency, payment_source, status)
    VALUES (v_c.tenant_id, public.garage_ops07_next_number(v_c.tenant_id, 'receipt'), v_c.invoice_id, v_c.id,
      v_c.payment_reference, v_alloc, v_c.currency, 'provider_confirmed', 'issued')
    RETURNING * INTO v_receipt;
    PERFORM public.pay04_log(v_c, 'receipt_issued', v_actor,
      jsonb_build_object('receipt_number', v_receipt.receipt_number, 'amount', v_receipt.amount::text));
    v_receipt_out := coalesce(v_receipt_out, '{}'::jsonb) || jsonb_build_object('issued', v_receipt.receipt_number);
  END IF;

  v_unallocated := v_target - v_alloc;
  IF v_unallocated > 0 THEN
    v_discrepancy := public.pay04_record_discrepancy(v_c, 'unallocated_provider_money', v_unallocated,
      jsonb_build_object('payment_status', v_p.status, 'counted_target', v_target::text, 'allocated', v_alloc::text,
                         'invoice_status', v_inv.status, 'cause', p_cause), 'reprojection', p_event_id);
  END IF;
  IF v_p.status = 'refunded' THEN
    UPDATE public.pay04_garage_payment_discrepancies SET
      status = 'resolved', resolution = 'refunded_to_customer', resolved_by = v_actor, resolved_role = 'provider_confirmation',
      resolution_note = 'Provider confirmed a full refund of this payment to the customer.', resolved_at = clock_timestamp()
    WHERE collection_id = v_c.id AND discrepancy_type IN ('unallocated_provider_money', 'refund_after_resolution') AND status = 'open';
    IF FOUND THEN
      PERFORM public.pay04_log(v_c, 'discrepancy_resolved', v_actor,
        jsonb_build_object('discrepancy_type', 'unallocated_provider_money|refund_after_resolution', 'resolution', 'refunded_to_customer'));
    END IF;
  ELSIF v_target > 0 AND v_alloc = v_target THEN
    -- the money now counts in full: an "uncounted money" flag left from before is stale, close it with the reason
    UPDATE public.pay04_garage_payment_discrepancies SET
      status = 'resolved', resolution = 'counted_on_invoice', resolved_by = v_actor, resolved_role = 'reprojection',
      resolution_note = 'The provider money now counts on the invoice.', resolved_at = clock_timestamp()
    WHERE collection_id = v_c.id AND discrepancy_type = 'unallocated_provider_money' AND status = 'open';
    IF FOUND THEN
      PERFORM public.pay04_log(v_c, 'discrepancy_resolved', v_actor,
        jsonb_build_object('discrepancy_type', 'unallocated_provider_money', 'resolution', 'counted_on_invoice'));
    END IF;
  END IF;
  PERFORM set_config('carup.pay04_writer', '', true);
  RETURN jsonb_build_object('counted_target', v_target, 'allocated', v_alloc, 'delta', v_delta, 'unallocated', v_unallocated,
    'receipt', v_receipt_out, 'discrepancy', v_discrepancy);
END $$;

-- ─────────────────────────── 10. governed writers (service_role only) ───────────────────────────

-- 10a. A platform operator registers a garage's merchant identity (Level 1: simulated only, runtime-guarded).
CREATE OR REPLACE FUNCTION public.pay04_register_garage_merchant_account(
  p_tenant_id uuid, p_gateway text, p_merchant_reference text, p_display_name text, p_currencies text[],
  p_actor_id text, p_actor_role text, p_authority_note text)
RETURNS public.pay04_garage_merchant_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.pay04_garage_merchant_accounts%ROWTYPE; v_code text; v_currencies text[];
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_AUTHORITY_REFUSED';
  END IF;
  IF NOT public.pay04_gateway_permitted(p_gateway) THEN RAISE EXCEPTION 'PAY04_GATEWAY_NOT_PERMITTED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND type = 'garage' AND status = 'active') THEN
    RAISE EXCEPTION 'PAY04_GARAGE_NOT_ACTIVE';
  END IF;
  SELECT array_agg(DISTINCT upper(btrim(c)) ORDER BY upper(btrim(c))) INTO v_currencies FROM unnest(coalesce(p_currencies, '{}'::text[])) AS c;
  IF v_currencies IS NULL THEN RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_INVALID'; END IF;
  FOREACH v_code IN ARRAY v_currencies LOOP
    IF public.garage_ops04_currency_scale(v_code) IS NULL THEN RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_INVALID'; END IF;
  END LOOP;
  BEGIN
    INSERT INTO public.pay04_garage_merchant_accounts (
      tenant_id, gateway, merchant_reference, display_name, currencies, status, authority_note, registered_by, registered_role)
    VALUES (p_tenant_id, p_gateway, btrim(p_merchant_reference), btrim(p_display_name), v_currencies, 'simulated',
      btrim(p_authority_note), trim(p_actor_id), p_actor_role)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_EXISTS';
  END;
  INSERT INTO public.trust_audit_events (event_type, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('GARAGE_MERCHANT_ACCOUNT_REGISTERED', 'service_relationship',
    jsonb_build_object('merchant_account_id', v_row.id, 'gateway', v_row.gateway, 'merchant_reference', v_row.merchant_reference,
                       'currencies', to_jsonb(v_row.currencies), 'status', v_row.status, 'authority_note', v_row.authority_note),
    trim(p_actor_id), p_actor_role, p_tenant_id::text, 'user', '/api/admin/garage-payments/merchant-accounts');
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.pay04_suspend_garage_merchant_account(
  p_account_id uuid, p_actor_id text, p_actor_role text, p_reason text)
RETURNS public.pay04_garage_merchant_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.pay04_garage_merchant_accounts%ROWTYPE;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'PAY04_REASON_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.pay04_garage_merchant_accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_NOT_FOUND'; END IF;
  IF v_row.status = 'suspended' THEN RETURN v_row; END IF;
  UPDATE public.pay04_garage_merchant_accounts SET status = 'suspended', suspended_by = trim(p_actor_id),
    suspended_reason = btrim(p_reason), suspended_at = clock_timestamp() WHERE id = p_account_id RETURNING * INTO v_row;
  INSERT INTO public.trust_audit_events (event_type, trust_fact, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route)
  VALUES ('GARAGE_MERCHANT_ACCOUNT_SUSPENDED', 'service_relationship',
    jsonb_build_object('merchant_account_id', v_row.id, 'reason', v_row.suspended_reason),
    trim(p_actor_id), p_actor_role, v_row.tenant_id::text, 'user', '/api/admin/garage-payments/merchant-accounts');
  RETURN v_row;
END $$;

-- 10b. The customer starts paying an invoice through the garage's provider merchant. Idempotent per (payer, key).
CREATE OR REPLACE FUNCTION public.pay04_begin_garage_collection(
  p_invoice_id uuid, p_payer_user_id text, p_amount numeric, p_currency text, p_idempotency_key text,
  p_ttl_seconds integer DEFAULT 1800)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv public.garage_invoices%ROWTYPE;
  v_existing public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
  v_m record;
  v_scale integer;
BEGIN
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'PAY04_IDEMPOTENCY_KEY_INVALID';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'PAY04_COLLECTION_TTL_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || coalesce(p_invoice_id::text, '')));
  SELECT * INTO v_inv FROM public.garage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_INVOICE_NOT_FOUND'; END IF;

  SELECT * INTO v_existing FROM public.pay04_garage_collections
   WHERE payer_user_id = trim(p_payer_user_id) AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id <> p_invoice_id OR v_existing.amount <> p_amount OR v_existing.currency <> upper(coalesce(p_currency, '')) THEN
      RAISE EXCEPTION 'PAY04_IDEMPOTENCY_CONFLICT';
    END IF;
    SELECT * INTO v_m FROM public.pay04_invoice_money(p_invoice_id);
    RETURN jsonb_build_object('collection', to_jsonb(v_existing), 'payment_reference', v_existing.payment_reference,
      'replayed', true, 'money', to_jsonb(v_m));
  END IF;

  IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'PAY04_INVOICE_NOT_PAYABLE'; END IF;
  IF NOT public.pay04_is_invoice_customer(v_inv.id, trim(p_payer_user_id)) THEN RAISE EXCEPTION 'PAY04_PAYER_NOT_CUSTOMER'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = v_inv.tenant_id AND user_id = trim(p_payer_user_id)) THEN
    RAISE EXCEPTION 'PAY04_PAYER_IS_GARAGE_MEMBER';
  END IF;
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts
   WHERE tenant_id = v_inv.tenant_id AND status = 'simulated' ORDER BY registered_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_GARAGE_MERCHANT_NOT_AVAILABLE'; END IF;
  IF NOT public.pay04_gateway_permitted(v_acct.gateway) THEN RAISE EXCEPTION 'PAY04_GATEWAY_NOT_PERMITTED'; END IF;
  IF upper(coalesce(p_currency, '')) <> v_inv.currency THEN RAISE EXCEPTION 'PAY04_CURRENCY_MISMATCH'; END IF;
  IF NOT (v_inv.currency = ANY (v_acct.currencies)) THEN RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED'; END IF;
  v_scale := public.garage_ops04_currency_scale(v_inv.currency);
  IF v_scale IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, v_scale) THEN
    RAISE EXCEPTION 'PAY04_AMOUNT_INVALID';
  END IF;
  SELECT * INTO v_m FROM public.pay04_invoice_money(v_inv.id);
  IF p_amount > v_m.uncommitted_balance THEN
    RAISE EXCEPTION 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE'
      USING DETAIL = format('uncommitted=%s reserved=%s', v_m.uncommitted_balance, v_m.provider_reserved);
  END IF;

  INSERT INTO public.payment_transactions (
    gateway, amount, currency, reference, status, pay01a_actor_id, pay01a_account_id,
    pay02_product_code, pay02_product_version, pay02_commercial_category, pay02_funds_owner,
    pay02_legal_beneficiary, pay02_settlement_status)
  VALUES (v_acct.gateway, p_amount, v_inv.currency, 'pay04_gar_' || gen_random_uuid()::text, 'pending',
    trim(p_payer_user_id), v_acct.merchant_reference,
    'gar.invoice.customer_payment', 1, 'category_b_third_party', 'garage_business_tenant',
    'tenant:' || v_inv.tenant_id::text, 'not_applicable_sandbox')
  RETURNING * INTO v_payment;
  INSERT INTO public.pay04_garage_collections (
    tenant_id, invoice_id, merchant_account_id, gateway, payer_user_id, currency, currency_scale, amount, amount_minor,
    payment_reference, idempotency_key, expires_at)
  VALUES (v_inv.tenant_id, v_inv.id, v_acct.id, v_acct.gateway, trim(p_payer_user_id), v_inv.currency, v_scale, p_amount,
    round(p_amount * (10 ^ v_scale))::bigint, v_payment.reference, p_idempotency_key,
    clock_timestamp() + make_interval(secs => p_ttl_seconds))
  RETURNING * INTO v_c;
  PERFORM public.pay04_log(v_c, 'initiated', trim(p_payer_user_id),
    jsonb_build_object('amount', p_amount::text, 'currency', v_inv.currency, 'merchant_account_id', v_acct.id,
                       'expires_at', v_c.expires_at));
  SELECT * INTO v_m FROM public.pay04_invoice_money(v_inv.id);
  RETURN jsonb_build_object('collection', to_jsonb(v_c), 'payment_reference', v_payment.reference, 'replayed', false,
    'money', to_jsonb(v_m));
END $$;

-- 10c. Bind the provider's checkout and payment identifiers once (after the adapter created the checkout).
CREATE OR REPLACE FUNCTION public.pay04_attach_garage_collection(
  p_collection_id uuid, p_provider_checkout_id text, p_provider_payment_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_probe public.pay04_garage_collections%ROWTYPE; v_c public.pay04_garage_collections%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  IF coalesce(p_provider_checkout_id, '') !~ '^gsim_co_[A-Za-z0-9_]+$' OR coalesce(p_provider_payment_id, '') !~ '^sim_pi_gar_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'PAY04_PROVIDER_REFERENCE_INVALID';
  END IF;
  IF v_c.provider_payment_id IS NOT NULL THEN
    IF v_c.provider_payment_id <> p_provider_payment_id OR v_c.provider_checkout_id <> p_provider_checkout_id THEN
      RAISE EXCEPTION 'PAY04_PROVIDER_REFERENCE_CHANGE_REFUSED';
    END IF;
    RETURN jsonb_build_object('collection', to_jsonb(v_c), 'replayed', true);
  END IF;
  -- a stopped or expired collection has released (or is releasing) its room: a live checkout must never bind to it
  IF v_c.cancelled_at IS NOT NULL OR v_c.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'PAY04_COLLECTION_CLOSED'; END IF;
  UPDATE public.pay04_garage_collections SET provider_checkout_id = p_provider_checkout_id, provider_payment_id = p_provider_payment_id
   WHERE id = v_c.id RETURNING * INTO v_c;
  UPDATE public.payment_transactions SET pay01a_checkout_id = p_provider_checkout_id, pay01a_intent_id = p_provider_payment_id,
         updated_at = now()
   WHERE reference = v_c.payment_reference AND pay01a_intent_id IS NULL AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_CANONICAL_PAYMENT_BINDING_REFUSED'; END IF;
  PERFORM public.pay04_log(v_c, 'provider_attached', 'provider:' || v_c.gateway,
    jsonb_build_object('provider_checkout_id', p_provider_checkout_id, 'provider_payment_id', p_provider_payment_id));
  RETURN jsonb_build_object('collection', to_jsonb(v_c), 'replayed', false);
END $$;

-- 10d. The single governed provider-state writer for garage collections (signed webhook or fresh provider readback).
CREATE OR REPLACE FUNCTION public.pay04_apply_garage_provider_snapshot(
  p_collection_id uuid, p_status text, p_provider_payment_id text, p_refund_id text,
  p_event_id text, p_event_type text, p_amount_minor bigint, p_currency text, p_merchant_reference text,
  p_refunded_minor bigint, p_pending_refund_minor bigint, p_refund_ids text[], p_mismatch text, p_detected_via text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_prior text;
  v_transition jsonb;
  v_target text;
  v_record jsonb;
  v_projection jsonb;
  v_event_collection uuid;
  v_disc jsonb;
BEGIN
  IF p_detected_via IS NULL OR p_detected_via NOT IN ('signed_webhook', 'provider_readback') THEN
    RAISE EXCEPTION 'PAY03B_DETECTION_SOURCE_INVALID';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  -- lock order shared by every garage-collection writer and by F5's resolution (owner lock): invoice -> reference -> rows
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = v_c.merchant_account_id;
  IF v_p.gateway IS DISTINCT FROM v_c.gateway OR v_p.pay02_funds_owner IS DISTINCT FROM 'garage_business_tenant' THEN
    RAISE EXCEPTION 'PAY04_CANONICAL_PAYMENT_INVALID';
  END IF;
  IF v_c.provider_payment_id IS NULL THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_ATTACHED'; END IF;
  IF p_provider_payment_id IS DISTINCT FROM v_c.provider_payment_id THEN
    RAISE EXCEPTION 'PAY04_PROVIDER_PAYMENT_BINDING_MISMATCH';
  END IF;

  -- Evidence that does not belong to this collection is recorded, never applied.
  IF p_merchant_reference IS DISTINCT FROM v_acct.merchant_reference THEN
    v_disc := public.pay04_record_discrepancy(v_c, 'merchant_mismatch', NULL,
      jsonb_build_object('observed_merchant_reference', p_merchant_reference, 'observed_status', p_status,
                         'event_id', p_event_id), p_detected_via, p_event_id);
    -- recorded, never applied — and money this collection already counted stops counting until it is resolved
    v_projection := public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', p_event_id);
    RETURN jsonb_build_object('applied', false, 'refused', 'merchant_mismatch', 'discrepancy', v_disc,
      'payment_status', v_p.status, 'projection', v_projection);
  END IF;
  IF p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold') THEN
    IF p_currency IS NULL OR p_amount_minor IS NULL THEN RAISE EXCEPTION 'PAY04_PROVIDER_AMOUNT_REQUIRED'; END IF;
    IF upper(p_currency) <> v_c.currency THEN
      v_disc := public.pay04_record_discrepancy(v_c, 'currency_mismatch', NULL,
        jsonb_build_object('observed_currency', upper(p_currency), 'observed_amount_minor', p_amount_minor,
                           'observed_status', p_status, 'event_id', p_event_id), p_detected_via, p_event_id);
      v_projection := public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', p_event_id);
      RETURN jsonb_build_object('applied', false, 'refused', 'currency_mismatch', 'discrepancy', v_disc,
        'payment_status', v_p.status, 'projection', v_projection);
    END IF;
    IF p_amount_minor <> v_c.amount_minor THEN
      v_disc := public.pay04_record_discrepancy(v_c, 'amount_mismatch',
        (p_amount_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2),
        jsonb_build_object('observed_amount_minor', p_amount_minor, 'expected_amount_minor', v_c.amount_minor,
                           'observed_status', p_status, 'event_id', p_event_id), p_detected_via, p_event_id);
      v_projection := public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', p_event_id);
      RETURN jsonb_build_object('applied', false, 'refused', 'amount_mismatch', 'discrepancy', v_disc,
        'payment_status', v_p.status, 'projection', v_projection);
    END IF;
  END IF;

  -- 1) validate and compute with F5 (no writes); 2) claim the provider event once; 3) record and apply.
  v_transition := public.pay03b_payment_transition_target(
    v_p, v_c.amount_minor, p_status, p_provider_payment_id, p_refund_id,
    p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_mismatch, p_detected_via);
  v_target := v_transition->>'target_status';

  IF p_event_id IS NOT NULL THEN
    IF p_event_id !~ '^evt_gsim_[A-Za-z0-9_]+$' OR p_event_type IS NULL THEN RAISE EXCEPTION 'PAY04_EVENT_IDENTITY_INVALID'; END IF;
    INSERT INTO public.pay04_provider_event_receipts (event_id, gateway, collection_id, event_type, resulting_state)
    VALUES (p_event_id, v_c.gateway, v_c.id, p_event_type, v_target)
    ON CONFLICT (event_id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT collection_id INTO v_event_collection FROM public.pay04_provider_event_receipts WHERE event_id = p_event_id;
      IF v_event_collection IS DISTINCT FROM v_c.id THEN RAISE EXCEPTION 'PAY04_EVENT_CROSS_COLLECTION_REPLAY'; END IF;
      RETURN jsonb_build_object('applied', false, 'duplicate_event', true, 'payment_status', v_p.status);
    END IF;
  END IF;

  v_record := public.pay03b_record_payment_hold(
    v_p, v_c.amount_minor, v_target, p_status, p_provider_payment_id, p_refund_id, p_event_id, p_event_type,
    p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_mismatch, p_detected_via);

  v_prior := v_p.status;
  IF v_p.status IN ('reconciliation_hold', 'partially_refunded') AND v_target IS DISTINCT FROM v_p.status THEN
    PERFORM set_config('carup.pay03b_hold_release', 'on', true);
  END IF;
  UPDATE public.payment_transactions SET
    status = v_target,
    pay01a_refund_id = CASE WHEN v_target = 'reconciliation_hold' THEN pay01a_refund_id
                            ELSE coalesce(pay01a_refund_id, p_refund_id) END,
    updated_at = now()
  WHERE reference = v_p.reference RETURNING * INTO v_p;
  PERFORM set_config('carup.pay03b_hold_release', '', true);

  UPDATE public.pay04_garage_collections SET last_provider_status = p_status,
    last_observed_at = greatest(coalesce(last_observed_at, clock_timestamp()), clock_timestamp()),
    -- a plain 'paid' report carries no refunds; otherwise keep the provider's latest figures (absent = unchanged)
    observed_refunded_minor = CASE WHEN p_status = 'paid' THEN coalesce(p_refunded_minor, 0)
                                   ELSE coalesce(p_refunded_minor, observed_refunded_minor) END,
    observed_pending_refund_minor = CASE WHEN p_status = 'paid' THEN coalesce(p_pending_refund_minor, 0)
                                         ELSE coalesce(p_pending_refund_minor, observed_pending_refund_minor) END
   WHERE id = v_c.id RETURNING * INTO v_c;
  PERFORM public.pay04_log(v_c, 'provider_observed', 'provider:' || v_c.gateway,
    jsonb_build_object('observed_status', p_status, 'prior_payment_status', v_prior, 'payment_status', v_target,
                       'event_id', p_event_id, 'detected_via', p_detected_via, 'hold_retained', v_transition->'hold_retained'));
  v_projection := public.pay04_reproject_garage_collection(v_c.id, 'provider_' || v_target, p_event_id);
  RETURN jsonb_build_object('applied', true, 'duplicate_event', false, 'prior_payment_status', v_prior,
    'payment_status', v_target, 'hold_retained', (v_transition->>'hold_retained')::boolean,
    'projection', v_projection) || v_record;
END $$;

-- 10e. The GARAGE (the merchant) refunds a provider-confirmed payment in full. The provider confirms the refund later.
CREATE OR REPLACE FUNCTION public.pay04_request_garage_collection_refund(
  p_collection_id uuid, p_actor_user_id text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_projection jsonb;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  PERFORM public.garage_ops03_assert_admin(v_probe.tenant_id, p_actor_user_id);
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'PAY04_REASON_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  IF v_p.status = 'refund_pending' THEN
    RETURN jsonb_build_object('replayed', true, 'payment_status', v_p.status, 'payment_reference', v_p.reference,
      'request_seq', (SELECT count(*) FROM public.pay04_garage_collection_events
                       WHERE collection_id = v_c.id AND event_type = 'refund_requested'));
  END IF;
  IF v_p.status <> 'paid' THEN RAISE EXCEPTION 'PAY04_REFUND_NOT_ALLOWED' USING DETAIL = v_p.status; END IF;
  PERFORM public.pay03b_payment_transition_target(
    v_p, v_c.amount_minor, 'refund_pending', v_c.provider_payment_id, NULL, NULL, NULL, NULL, NULL, NULL);
  UPDATE public.payment_transactions SET status = 'refund_pending', updated_at = now()
   WHERE reference = v_p.reference RETURNING * INTO v_p;
  PERFORM public.pay04_log(v_c, 'refund_requested', trim(p_actor_user_id), jsonb_build_object('reason', btrim(p_reason)));
  v_projection := public.pay04_reproject_garage_collection(v_c.id, 'refund_requested', NULL);
  RETURN jsonb_build_object('replayed', false, 'payment_status', v_p.status, 'payment_reference', v_p.reference,
    'provider_payment_id', v_c.provider_payment_id, 'amount_minor', v_c.amount_minor, 'currency', v_c.currency,
    'projection', v_projection,
    'request_seq', (SELECT count(*) FROM public.pay04_garage_collection_events
                     WHERE collection_id = v_c.id AND event_type = 'refund_requested'));
END $$;

-- 10f. The payer or the garage stops a checkout that has not been paid (who and why). The reservation is NOT released
--      here: the canonical payment stays 'pending' — and its room held — until the PROVIDER confirms the checkout closed
--      (or reports it paid, which then counts in that held room). A collection that never reached the provider has
--      nothing to confirm: its canonical payment closes at once.
CREATE OR REPLACE FUNCTION public.pay04_cancel_garage_collection(p_collection_id uuid, p_actor_user_id text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  IF trim(coalesce(p_actor_user_id, '')) <> v_probe.payer_user_id AND NOT EXISTS (
       SELECT 1 FROM public.tenants t JOIN public.tenant_users tu ON tu.tenant_id = t.id
        WHERE t.id = v_probe.tenant_id AND t.type = 'garage' AND t.status = 'active'
          AND tu.user_id = trim(p_actor_user_id) AND tu.role = 'admin') THEN
    RAISE EXCEPTION 'PAY04_CANCEL_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'PAY04_REASON_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  IF v_c.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('replayed', true, 'collection', to_jsonb(v_c)); END IF;
  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_CANCELLABLE' USING DETAIL = v_p.status; END IF;
  UPDATE public.pay04_garage_collections SET cancelled_at = clock_timestamp(), cancelled_by = trim(p_actor_user_id),
         cancel_reason = btrim(p_reason)
   WHERE id = v_c.id RETURNING * INTO v_c;
  IF v_c.provider_payment_id IS NULL THEN
    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE reference = v_p.reference;
  END IF;
  PERFORM public.pay04_log(v_c, 'cancelled', trim(p_actor_user_id), jsonb_build_object('reason', btrim(p_reason),
    'closed_without_provider', v_c.provider_payment_id IS NULL));
  RETURN jsonb_build_object('replayed', false, 'collection', to_jsonb(v_c),
    'payment_status', CASE WHEN v_c.provider_payment_id IS NULL THEN 'cancelled' ELSE v_p.status END);
END $$;

-- 10f2. A collection that never reached the provider (no checkout was attached) and whose time ran out is closed by CarUp:
--       there is no provider object that could still be paid. An attached one is closed only by a provider read.
CREATE OR REPLACE FUNCTION public.pay04_close_expired_unattached_collection(p_collection_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  IF v_c.provider_payment_id IS NOT NULL THEN RAISE EXCEPTION 'PAY04_COLLECTION_ATTACHED'; END IF;
  IF v_p.status <> 'pending' THEN RETURN jsonb_build_object('replayed', true, 'payment_status', v_p.status); END IF;
  IF v_c.expires_at > clock_timestamp() THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_EXPIRED'; END IF;
  PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE reference = v_p.reference;
  IF v_c.cancelled_at IS NULL THEN
    UPDATE public.pay04_garage_collections SET cancelled_at = clock_timestamp(), cancelled_by = 'system:expiry',
           cancel_reason = 'Expired before the provider checkout existed'
     WHERE id = v_c.id RETURNING * INTO v_c;
  END IF;
  PERFORM public.pay04_log(v_c, 'cancelled', 'system:expiry', jsonb_build_object('reason', 'expired before reaching the provider',
    'closed_without_provider', true));
  RETURN jsonb_build_object('replayed', false, 'payment_status', 'cancelled', 'collection', to_jsonb(v_c));
END $$;

-- 10f3. Re-project every counting collection of one invoice (room changed, e.g. a declared payment was reversed), in the
--       shared lock order. Money that can now count is counted; a stale "uncounted" flag closes itself.
CREATE OR REPLACE FUNCTION public.pay04_reproject_invoice(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c record; v_out jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.garage_invoices WHERE id = p_invoice_id) THEN RAISE EXCEPTION 'PAY04_INVOICE_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || p_invoice_id::text));
  FOR v_c IN SELECT c.id, c.payment_reference FROM public.pay04_garage_collections c
               JOIN public.payment_transactions p ON p.reference = c.payment_reference
              WHERE c.invoice_id = p_invoice_id AND p.status IN ('paid', 'partially_refunded')
              ORDER BY c.initiated_at, c.id LOOP
    PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_c.payment_reference));
    v_out := v_out || jsonb_build_array(jsonb_build_object('collection_id', v_c.id,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'room_changed', NULL)));
  END LOOP;
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'reprojected', v_out);
END $$;

-- 10g. Operator closure of a discrepancy: platform administrator, separated from the payer and the garage, written note.
CREATE OR REPLACE FUNCTION public.pay04_resolve_garage_payment_discrepancy(
  p_discrepancy_id uuid, p_resolution text, p_actor_id text, p_actor_role text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_d public.pay04_garage_payment_discrepancies%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY04_RESOLUTION_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 10 THEN RAISE EXCEPTION 'PAY04_RESOLUTION_NOTE_REQUIRED'; END IF;
  SELECT * INTO v_d FROM public.pay04_garage_payment_discrepancies WHERE id = p_discrepancy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_DISCREPANCY_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_d.invoice_id::text));
  SELECT * INTO v_d FROM public.pay04_garage_payment_discrepancies WHERE id = p_discrepancy_id FOR UPDATE;
  IF v_d.status <> 'open' THEN RAISE EXCEPTION 'PAY04_DISCREPANCY_NOT_OPEN'; END IF;
  IF public.pay03b_payment_payer_conflict(v_d.payment_reference, trim(p_actor_id)) THEN
    RAISE EXCEPTION 'PAY04_RESOLUTION_SELF_DEALING_REFUSED';
  END IF;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = v_d.collection_id;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_d.payment_reference;
  IF p_resolution = 'refunded_to_customer' THEN
    IF v_p.status <> 'refunded' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_REQUIRES_PROVIDER_REFUND'; END IF;
  ELSIF p_resolution = 'settled_off_platform' THEN
    IF v_d.discrepancy_type <> 'unallocated_provider_money' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
  ELSIF p_resolution = 'provider_corrected' THEN
    IF v_d.discrepancy_type NOT IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch') THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
  ELSIF p_resolution = 'acknowledged' THEN
    -- the invoice already counts only what the provider says the garage keeps; the operator records the review
    IF v_d.discrepancy_type <> 'refund_after_resolution' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
  ELSE
    RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
  END IF;
  UPDATE public.pay04_garage_payment_discrepancies SET status = 'resolved', resolution = p_resolution,
    resolved_by = trim(p_actor_id), resolved_role = p_actor_role, resolution_note = btrim(p_note), resolved_at = clock_timestamp()
   WHERE id = v_d.id RETURNING * INTO v_d;
  PERFORM public.pay04_log(v_c, 'discrepancy_resolved', trim(p_actor_id),
    jsonb_build_object('discrepancy_id', v_d.id, 'discrepancy_type', v_d.discrepancy_type, 'resolution', p_resolution));
  -- the closure can change what counts (a mismatch closed as corrected lets the money count again): re-project now,
  -- in the shared lock order (the invoice lock is held; the reference lock next)
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_d.payment_reference));
  RETURN to_jsonb(v_d) || jsonb_build_object('projection',
    public.pay04_reproject_garage_collection(v_d.collection_id, 'discrepancy_resolved', NULL));
END $$;

-- ─────────────────────────── 11. privacy and least privilege ───────────────────────────

ALTER TABLE public.pay04_runtime_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_garage_merchant_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_garage_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_garage_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_garage_provider_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_garage_collection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_provider_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay04_garage_payment_discrepancies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pay04_runtime_guard, public.pay04_garage_merchant_accounts, public.pay04_garage_collections,
  public.pay04_garage_payment_allocations, public.pay04_garage_provider_receipts, public.pay04_garage_collection_events,
  public.pay04_provider_event_receipts, public.pay04_garage_payment_discrepancies
  FROM PUBLIC, anon, authenticated, service_role;
-- The backend reads. Every write goes through the SECURITY DEFINER writers above.
GRANT SELECT ON TABLE public.pay04_runtime_guard, public.pay04_garage_merchant_accounts, public.pay04_garage_collections,
  public.pay04_garage_payment_allocations, public.pay04_garage_provider_receipts, public.pay04_garage_collection_events,
  public.pay04_provider_event_receipts, public.pay04_garage_payment_discrepancies
  TO service_role;

REVOKE ALL ON FUNCTION
  public.pay04_append_only(), public.pay04_guard_merchant_account(), public.pay04_guard_collection(),
  public.pay04_guard_discrepancy(), public.pay04_guard_allocation_insert(), public.pay04_guard_provider_receipt(),
  public.pay04_guard_declared_payment(), public.pay04_guard_invoice_void(),
  public.pay04_collection_allocated(uuid), public.pay04_is_invoice_customer(uuid,text),
  public.pay04_log(public.pay04_garage_collections,text,text,jsonb),
  public.pay04_record_discrepancy(public.pay04_garage_collections,text,numeric,jsonb,text,text),
  public.pay04_reproject_garage_collection(uuid,text,text),
  public.pay04_partial_refund_position(public.pay04_garage_collections), public.pay04_stamp_runtime_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.pay04_gateway_permitted(text), public.pay04_invoice_money(uuid),
  public.pay04_register_garage_merchant_account(uuid,text,text,text,text[],text,text,text),
  public.pay04_suspend_garage_merchant_account(uuid,text,text,text),
  public.pay04_begin_garage_collection(uuid,text,numeric,text,text,integer),
  public.pay04_attach_garage_collection(uuid,text,text),
  public.pay04_apply_garage_provider_snapshot(uuid,text,text,text,text,text,bigint,text,text,bigint,bigint,text[],text,text),
  public.pay04_request_garage_collection_refund(uuid,text,text),
  public.pay04_cancel_garage_collection(uuid,text,text),
  public.pay04_close_expired_unattached_collection(uuid), public.pay04_reproject_invoice(uuid),
  public.pay04_resolve_garage_payment_discrepancy(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.pay04_gateway_permitted(text), public.pay04_invoice_money(uuid),
  public.pay04_register_garage_merchant_account(uuid,text,text,text,text[],text,text,text),
  public.pay04_suspend_garage_merchant_account(uuid,text,text,text),
  public.pay04_begin_garage_collection(uuid,text,numeric,text,text,integer),
  public.pay04_attach_garage_collection(uuid,text,text),
  public.pay04_apply_garage_provider_snapshot(uuid,text,text,text,text,text,bigint,text,text,bigint,bigint,text[],text,text),
  public.pay04_request_garage_collection_refund(uuid,text,text),
  public.pay04_cancel_garage_collection(uuid,text,text),
  public.pay04_close_expired_unattached_collection(uuid), public.pay04_reproject_invoice(uuid),
  public.pay04_resolve_garage_payment_discrepancy(uuid,text,text,text,text)
  TO service_role;

COMMIT;

-- +migrate Down
-- PAY-04 never deletes payment evidence, receipts or allocations, and never restores an OPS07 balance that would ignore
-- provider money that is already counted, in an automatic rollback (the same rule as PAY-03B F5).
DO $$ BEGIN RAISE EXCEPTION 'PAY04_RETAIN_PAYMENT_EVIDENCE'; END $$;
