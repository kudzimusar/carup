-- +migrate Up
-- CARUP-PAY-05-R1 — Paynow financial integrity, provider-state truth and onboarding, forward from the frozen PAY-05 migration.
--
-- PAY-05's own migration (20261103100000) is not edited. Each function below that it defined is its exact text plus bounded
-- hunks marked "PAY-05-R1" (backend/tests/helpers/pay05-r1-function-hunks.mjs, drift-tested). Rules this establishes:
--   * Paynow money counts only while Paynow's own latest evaluated word is a matching Paid CarUp applied. No operator closure
--     re-counts it, and a settlement outside CarUp caps it at what counted then. Receipts follow the count.
--   * After a settlement only a repeat of the settled evidence is recorded-only. New money opens a review and is never
--     allocated; a later Disputed or Refunded still acts on whatever counts.
--   * Disputed is always a dispute, and every dispute has an operator exit that counts nothing. Cancelled or Failed after money
--     is a review. A Refunded applies in full, keeping Paynow's figure as evidence, with one review per collection.
--   * A word that moves a payment forward is never superseded by read-ticket order.
--   * A status update's identity is the received Paynow hash plus a monotonic per-collection generation; a budget bounds the
--     reads status updates can trigger.
--   * A currency binds only through its integration's own reviewed settlement currency. No conversion, ever: real merchant
--     configuration and settlement reconciliation stay a separate Level 2 gate.
--   * An integration ID is reserved only with its key proved at connect; refusals are generic; a rejected ID cools down.
--   * An older read never overrides a newer closed or unrecognised word. A re-read refreshes the release check, and an operator
--     can open a review of a request nothing else can move, so every hold has an exit. Room freed goes to money waiting for it.
-- It rewrites no row. An integration verified before this migration holds no currency evidence and so fails closed.
BEGIN;

-- ─────────────────────────── 1. columns ───────────────────────────

ALTER TABLE public.pay05_paynow_transactions
  -- advances with each recorded status update; part of the next update's event identity
  ADD COLUMN IF NOT EXISTS status_update_generation bigint NOT NULL DEFAULT 0 CHECK (status_update_generation >= 0),
  -- the per-collection budget for reads a status update can trigger
  ADD COLUMN IF NOT EXISTS status_update_reads_window_start timestamptz,
  ADD COLUMN IF NOT EXISTS status_update_reads_in_window integer NOT NULL DEFAULT 0 CHECK (status_update_reads_in_window >= 0),
  -- each message's own share of that budget: { message hash: { since, reads } }, the last ten minutes only
  ADD COLUMN IF NOT EXISTS status_update_read_budgets jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- when Paynow was last read and showed what CarUp holds, or last asked, whether or not it answered
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_read_attempt_at timestamptz,
  -- when Paynow first reported money on this request, whatever became of that read
  ADD COLUMN IF NOT EXISTS money_reported_at timestamptz;

-- which signed message a status-update observation came from: a replay is recognised by it
ALTER TABLE public.pay05_paynow_observations
  ADD COLUMN IF NOT EXISTS message_hash text;

ALTER TABLE public.pay05_merchant_integrations
  -- this integration's own settlement currency as reviewed in the merchant's Paynow account; written once, at verification
  ADD COLUMN IF NOT EXISTS currency_evidence jsonb,
  -- Paynow test mode only: the merchant login e-mail its express requests must carry
  ADD COLUMN IF NOT EXISTS test_auth_email text;

-- a report repeated after an operator closed its review: recorded, never applied
ALTER TABLE public.pay05_paynow_observations DROP CONSTRAINT IF EXISTS pay05_paynow_observations_outcome_check;
ALTER TABLE public.pay05_paynow_observations ADD CONSTRAINT pay05_paynow_observations_outcome_check CHECK (
  outcome IN ('applied', 'review', 'superseded', 'stale_regression', 'after_settlement', 'after_close', 'after_review'));

-- an operator opened a review because nothing else could move the request (PFR-M1)
ALTER TABLE public.pay05_merchant_audit_events DROP CONSTRAINT IF EXISTS pay05_merchant_audit_events_event_type_check;
ALTER TABLE public.pay05_merchant_audit_events ADD CONSTRAINT pay05_merchant_audit_events_event_type_check CHECK (event_type IN (
  'merchant_registered', 'integration_registered', 'merchant_verified', 'integration_verified', 'merchant_rejected',
  'integration_rejected', 'merchant_suspended', 'integration_suspended', 'availability_changed', 'hold_released', 'review_opened'));
ALTER TABLE public.pay04_garage_payment_discrepancies DROP CONSTRAINT IF EXISTS pay04_garage_payment_discrepancies_detected_via_check;
ALTER TABLE public.pay04_garage_payment_discrepancies ADD CONSTRAINT pay04_garage_payment_discrepancies_detected_via_check CHECK (
  detected_via IN ('signed_webhook', 'provider_readback', 'reprojection', 'operator_review'));

ALTER TABLE public.pay05_merchant_integrations DROP CONSTRAINT IF EXISTS pay05_integration_test_auth_email;
ALTER TABLE public.pay05_merchant_integrations ADD CONSTRAINT pay05_integration_test_auth_email CHECK (
  test_auth_email IS NULL OR (mode = 'paynow_test' AND test_auth_email ~ '^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$'));

-- ─────────────────────────── 2. helpers ───────────────────────────

CREATE OR REPLACE FUNCTION public.pay05_settled_off_platform(p_collection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id AND settled_off_platform_at IS NOT NULL);
$$;

-- How far along a Paynow word is. Words with no place in that order (closed, unrecognised) are 0.
CREATE OR REPLACE FUNCTION public.pay05_paynow_money_rank(p_status text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_status WHEN 'created' THEN 1 WHEN 'sent' THEN 1 WHEN 'awaiting_delivery' THEN 2 WHEN 'delivered' THEN 2
                       WHEN 'paid' THEN 3 WHEN 'disputed' THEN 4 WHEN 'refunded' THEN 5 ELSE 0 END;
$$;

-- This collection's request was sent through an integration whose reviewed settlement currency is the collection's currency.
CREATE OR REPLACE FUNCTION public.pay05_collection_currency_bound(p_collection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.pay05_paynow_transactions t
                   JOIN public.pay04_garage_collections c ON c.id = t.collection_id
                   JOIN public.pay05_merchant_integrations i ON i.id = t.integration_row_id
                  WHERE t.collection_id = p_collection_id AND i.currency = c.currency
                    AND i.currency_evidence->>'settlement_currency' = c.currency);
$$;

-- A read ticket for a read a status update triggers. Each signed message has its own budget per collection, twelve in ten
-- minutes (Paynow resends a message at most ten times), so replaying one message cannot use up another's (PFR-M3). Sixty across
-- messages bounds the rest. Over budget the caller answers non-2xx and Paynow resends later; ordinary reads are unaffected.
CREATE OR REPLACE FUNCTION public.pay05_begin_status_update_read(p_collection_id uuid, p_message_hash text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_cutoff timestamptz := clock_timestamp() - interval '10 minutes';
  v_budgets jsonb;
  v_reads integer;
  v_all integer;
BEGIN
  IF coalesce(p_message_hash, '') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'PAY05_OBSERVATION_IDENTITY_INVALID'; END IF;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_budgets
    FROM jsonb_each(v_tx.status_update_read_budgets) e WHERE (e.value->>'since')::timestamptz >= v_cutoff;
  v_reads := coalesce((v_budgets->p_message_hash->>'reads')::integer, 0);
  v_all := CASE WHEN v_tx.status_update_reads_window_start IS NULL OR v_tx.status_update_reads_window_start < v_cutoff THEN 0
                ELSE v_tx.status_update_reads_in_window END;
  IF v_reads >= 12 OR v_all >= 60 THEN RAISE EXCEPTION 'PAY05_STATUS_UPDATE_READS_UNAVAILABLE'; END IF;
  UPDATE public.pay05_paynow_transactions SET
    status_update_reads_window_start = CASE WHEN v_all = 0 THEN clock_timestamp() ELSE status_update_reads_window_start END,
    status_update_reads_in_window = v_all + 1,
    status_update_read_budgets = v_budgets || jsonb_build_object(p_message_hash, jsonb_build_object(
      'since', coalesce(v_budgets->p_message_hash->>'since', clock_timestamp()::text), 'reads', v_reads + 1)),
    last_read_attempt_at = clock_timestamp()
   WHERE collection_id = p_collection_id;
  RETURN nextval('public.pay05_paynow_read_ticket_seq');
END $$;

-- When a read was last attempted, whether or not Paynow answered, so reads that fail keep their pace (PFR-L13). Its own call:
-- it holds this row for an instant and must never sit in front of the writers' lock order, so the read ticket does not do it.
CREATE OR REPLACE FUNCTION public.pay05_record_read_attempt(p_collection_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.pay05_paynow_transactions SET last_read_attempt_at = clock_timestamp() WHERE collection_id = p_collection_id;
$$;

-- A person who worked at this garage, though removed since: the workforce record outlives the membership.
CREATE OR REPLACE FUNCTION public.pay05_worked_at_garage(p_tenant_id uuid, p_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.garage_workforce_profiles WHERE tenant_id = p_tenant_id AND user_id = trim(p_actor_id));
$$;

-- An operator opens a review of a request that holds the invoice or that Paynow still has, past CarUp's time, when nothing else
-- can move it: Paynow keeps it in escrow, or Paynow can no longer be read (PFR-M1). A review counts nothing, and settling it
-- outside CarUp frees the room; later money is reviewed, never allocated.
CREATE OR REPLACE FUNCTION public.pay05_open_paynow_review(p_collection_id uuid, p_actor_id text, p_actor_role text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_disc jsonb;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_REVIEW_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  IF public.pay03b_payment_payer_conflict(v_probe.payment_reference, trim(p_actor_id)) OR public.pay05_worked_at_garage(v_probe.tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_REVIEW_SELF_DEALING_REFUSED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  IF NOT FOUND OR v_tx.initiation_state NOT IN ('attached', 'sending', 'unknown') THEN
    RAISE EXCEPTION 'PAY05_REVIEW_NOT_OPENABLE' USING DETAIL = 'not_attached';
  END IF;
  IF v_tx.settled_off_platform_at IS NOT NULL THEN RAISE EXCEPTION 'PAY05_REVIEW_NOT_OPENABLE' USING DETAIL = 'settled'; END IF;
  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY05_REVIEW_NOT_OPENABLE' USING DETAIL = v_p.status; END IF;
  IF v_c.expires_at > clock_timestamp() THEN RAISE EXCEPTION 'PAY05_REVIEW_NOT_OPENABLE' USING DETAIL = 'not_expired'; END IF;
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies WHERE collection_id = v_c.id AND status = 'open') THEN
    RAISE EXCEPTION 'PAY05_REVIEW_NOT_OPENABLE' USING DETAIL = 'review_open';
  END IF;
  v_disc := public.pay04_record_discrepancy(v_c, 'provider_status_unrecognized', v_c.amount,
    jsonb_build_object('reason', 'operator_opened', 'note', btrim(p_reason), 'opened_by', trim(p_actor_id),
                       'last_provider_status', v_tx.provider_status, 'initiation_state', v_tx.initiation_state), 'operator_review', NULL);
  PERFORM public.pay05_audit(v_c.tenant_id, v_c.merchant_account_id, v_tx.integration_row_id, 'review_opened', trim(p_actor_id), p_actor_role,
    jsonb_build_object('collection_id', v_c.id, 'reason', btrim(p_reason), 'last_provider_status', v_tx.provider_status));
  RETURN jsonb_build_object('discrepancy', v_disc);
END $$;

-- The operator's queue, chosen here: what still holds an invoice past CarUp's time or a stop, oldest first. Requests that finished
-- cannot crowd one out, however many there are (PFR-H5). A settlement marks the hold released, so settled requests are not here.
CREATE OR REPLACE FUNCTION public.pay05_held_collection_ids(p_limit integer)
RETURNS TABLE (collection_id uuid, total bigint) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.collection_id, count(*) OVER ()
    FROM public.pay05_paynow_transactions t
    JOIN public.pay04_garage_collections c ON c.id = t.collection_id
    JOIN public.payment_transactions p ON p.reference = c.payment_reference
   WHERE t.hold_released_at IS NULL AND t.initiation_state IN ('attached', 'sending', 'unknown') AND p.status = 'pending'
     AND (c.cancelled_at IS NOT NULL OR c.expires_at <= clock_timestamp())
   ORDER BY t.created_at, t.collection_id
   LIMIT greatest(least(coalesce(p_limit, 200), 500), 1);
$$;

-- ─────────────────────────── 3. PAY-05 functions, exact text + bounded R1 hunks ───────────────────────────

-- pay05_guard_integration: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_guard_integration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY05_INTEGRATION_IMMUTABLE'; END IF;
  IF NOT ((OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected', 'suspended'))
          OR (OLD.status = 'verified' AND NEW.status = 'suspended'))
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.merchant_account_id IS DISTINCT FROM OLD.merchant_account_id OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.integration_id IS DISTINCT FROM OLD.integration_id
     OR NEW.methods IS DISTINCT FROM OLD.methods OR NEW.credential_ciphertext IS DISTINCT FROM OLD.credential_ciphertext
     OR NEW.credential_iv IS DISTINCT FROM OLD.credential_iv OR NEW.credential_tag IS DISTINCT FROM OLD.credential_tag
     OR NEW.credential_key_version IS DISTINCT FROM OLD.credential_key_version
     OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint
     OR NEW.registered_by IS DISTINCT FROM OLD.registered_by OR NEW.registered_role IS DISTINCT FROM OLD.registered_role
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
     -- PAY-05-R1: a reviewed settlement currency is written once, by verification, and a verified integration has one
     OR NEW.test_auth_email IS DISTINCT FROM OLD.test_auth_email
     OR (OLD.currency_evidence IS NOT NULL AND NEW.currency_evidence IS DISTINCT FROM OLD.currency_evidence)
     OR (OLD.currency_evidence IS NULL AND NEW.currency_evidence IS NOT NULL AND NEW.status <> 'verified')
     OR (OLD.status = 'pending_verification' AND NEW.status = 'verified' AND NEW.currency_evidence IS NULL)
     OR (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at
         OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verification_evidence IS DISTINCT FROM OLD.verification_evidence)) THEN
    RAISE EXCEPTION 'PAY05_INTEGRATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

-- pay05_guard_paynow_transaction: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_guard_paynow_transaction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY05_TRANSACTION_IMMUTABLE'; END IF;
  IF NEW.collection_id IS DISTINCT FROM OLD.collection_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.integration_row_id IS DISTINCT FROM OLD.integration_row_id OR NEW.merchant_trace IS DISTINCT FROM OLD.merchant_trace
     OR NEW.method IS DISTINCT FROM OLD.method OR NEW.phone_masked IS DISTINCT FROM OLD.phone_masked
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.poll_url IS NOT NULL AND NEW.poll_url IS DISTINCT FROM OLD.poll_url)
     OR (OLD.hold_released_at IS NOT NULL AND (NEW.hold_released_at IS DISTINCT FROM OLD.hold_released_at
         OR NEW.hold_released_by IS DISTINCT FROM OLD.hold_released_by OR NEW.hold_release_reason IS DISTINCT FROM OLD.hold_release_reason))
     OR (OLD.settled_off_platform_at IS NOT NULL AND (NEW.settled_off_platform_at IS DISTINCT FROM OLD.settled_off_platform_at
         OR NEW.settled_off_platform_by IS DISTINCT FROM OLD.settled_off_platform_by
         OR NEW.settled_off_platform_note IS DISTINCT FROM OLD.settled_off_platform_note))
     OR (OLD.last_read_ticket IS NOT NULL AND (NEW.last_read_ticket IS NULL OR NEW.last_read_ticket < OLD.last_read_ticket))
     OR (OLD.last_trace_at IS NOT NULL AND (NEW.last_trace_at IS NULL OR NEW.last_trace_at < OLD.last_trace_at))
     OR (OLD.attached_after_close AND NOT NEW.attached_after_close)
     -- PAY-05-R1: the status-update generation only moves forward, and that Paynow reported money stays on record
     OR NEW.status_update_generation < OLD.status_update_generation
     OR (OLD.money_reported_at IS NOT NULL AND NEW.money_reported_at IS DISTINCT FROM OLD.money_reported_at)
     OR NOT (NEW.initiation_state = OLD.initiation_state
             OR (OLD.initiation_state = 'sending' AND NEW.initiation_state IN ('attached', 'refused', 'unknown'))
             -- PAY-05-R1: Paynow's refusal may arrive after a concurrent trace attempt marked the request unknown (ICR-M8)
             OR (OLD.initiation_state = 'unknown' AND NEW.initiation_state IN ('attached', 'traced_absent', 'refused'))
             -- Paynow's own signed update for a request CarUp closed as refused or absent binds it late
             OR (OLD.initiation_state IN ('refused', 'traced_absent') AND NEW.initiation_state = 'attached' AND NEW.attached_after_close)) THEN
    RAISE EXCEPTION 'PAY05_TRANSACTION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

-- pay05_assert_independent_reviewer: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_assert_independent_reviewer(
  p_acct public.pay04_garage_merchant_accounts, p_actor_id text, p_actor_role text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_VERIFICATION_AUTHORITY_REFUSED';
  END IF;
  IF trim(p_actor_id) = p_acct.registered_by
     OR EXISTS (SELECT 1 FROM public.tenant_users WHERE tenant_id = p_acct.tenant_id AND user_id = trim(p_actor_id))
     OR EXISTS (SELECT 1 FROM public.pay05_merchant_integrations WHERE merchant_account_id = p_acct.id AND registered_by = trim(p_actor_id))
     -- PAY-05-R1: a person who ever worked at this garage, though removed since: the workforce record outlives the membership (ICR-S3)
     OR EXISTS (SELECT 1 FROM public.garage_workforce_profiles WHERE tenant_id = p_acct.tenant_id AND user_id = trim(p_actor_id)) THEN
    RAISE EXCEPTION 'PAY05_REVIEWER_SEPARATION_REQUIRED';
  END IF;
END $$;

-- pay05_verified_integration: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_verified_integration(p_merchant_account_id uuid, p_currency text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT i.id FROM public.pay05_merchant_integrations i
    JOIN public.pay04_garage_merchant_accounts m ON m.id = i.merchant_account_id AND m.status = 'verified'
   WHERE i.merchant_account_id = p_merchant_account_id AND i.currency = p_currency AND i.status = 'verified'
     AND public.pay05_mode_permitted(i.mode)
     -- PAY-05-R1: only a reviewed merchant+currency configuration binds a currency (ICR-P1); Paynow itself reports none
     AND i.currency_evidence->>'settlement_currency' = i.currency
   ORDER BY i.verified_at DESC LIMIT 1;
$$;

-- pay04_invoice_money: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
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
             -- PAY-05-R1: money settled outside CarUp can never count here again, so it holds no room (ICR-M3)
             WHEN public.pay05_settled_off_platform(c.id) THEN 0
             WHEN (p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
                   -- PAY-05: an operator released this unpaid Paynow checkout's hold after an authenticated read
                   AND NOT (p.status = 'pending' AND public.pay05_hold_released(c.id)))
               OR EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q
                           WHERE q.collection_id = c.id AND q.status = 'open'
                             AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch',
                                                        'provider_disputed', 'provider_status_unrecognized'))
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

-- pay04_reproject_garage_collection: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
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
  v_other uuid;
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
               -- PAY-05: nor while Paynow holds it in a dispute or reported a status no one has reviewed
               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'provider_disputed',
                                          'provider_status_unrecognized')) THEN
    v_target := 0;
  END IF;

  -- PAY-05-R1: Paynow money counts only while Paynow's own latest evaluated word is a matching Paid CarUp applied. Closing a
  -- review or a canonical row still reading 'paid' never re-counts money Paynow reversed (ICR-M1).
  IF v_c.gateway = 'paynow_zimbabwe' AND public.pay05_latest_provider_status(v_c.id) IS DISTINCT FROM 'paid' THEN
    v_target := 0;
  END IF;
  v_current := public.pay04_collection_allocated(v_c.id);
  -- money an operator settled OFF the platform never starts counting here, even if room appears later
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id
               AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'resolved' AND q.resolution = 'settled_off_platform')
     -- PAY-05-R1: for every settled Paynow review type (ICR-M1)
     OR public.pay05_settled_off_platform(v_c.id) THEN
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
    WHERE collection_id = v_c.id AND discrepancy_type IN ('unallocated_provider_money', 'refund_after_resolution', 'provider_disputed') AND status = 'open';
    IF FOUND THEN
      PERFORM public.pay04_log(v_c, 'discrepancy_resolved', v_actor,
        jsonb_build_object('discrepancy_type', 'unallocated_provider_money|refund_after_resolution|provider_disputed', 'resolution', 'refunded_to_customer'));
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
  -- PAY-05-R1: room this just gave up may be what other Paynow money on the invoice is waiting for: it counts now, oldest first,
  -- only into the room there is (PFR-M4). The invoice lock is held, so the shared lock order holds. Settled money stays capped.
  IF v_delta < 0 AND v_c.gateway = 'paynow_zimbabwe' AND v_inv.status = 'issued' THEN
    FOR v_other IN SELECT q.collection_id FROM public.pay04_garage_payment_discrepancies q
                     JOIN public.pay04_garage_collections o ON o.id = q.collection_id
                    WHERE o.invoice_id = v_inv.id AND o.id <> v_c.id AND o.gateway = 'paynow_zimbabwe'
                      AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'open'
                    ORDER BY q.first_detected_at, q.collection_id LOOP
      PERFORM public.pay04_reproject_garage_collection(v_other, 'room_freed', NULL);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('counted_target', v_target, 'allocated', v_alloc, 'delta', v_delta, 'unallocated', v_unallocated,
    'receipt', v_receipt_out, 'discrepancy', v_discrepancy);
END $$;

-- pay04_resolve_garage_payment_discrepancy: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
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
  -- PAY-05-R1: nor a person who worked at this garage, though removed since (PFR-L10)
  IF v_c.gateway = 'paynow_zimbabwe' AND public.pay05_worked_at_garage(v_c.tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY04_RESOLUTION_SELF_DEALING_REFUSED';
  END IF;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_d.payment_reference;
  IF p_resolution = 'refunded_to_customer' THEN
    IF v_p.status <> 'refunded' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_REQUIRES_PROVIDER_REFUND'; END IF;
  ELSIF p_resolution = 'settled_off_platform' THEN
    IF v_d.discrepancy_type NOT IN ('unallocated_provider_money', 'provider_paid_after_close')
       -- PAY-05: Paynow paid a different amount, or reported a word no one recognises, and the garage settled it in Paynow or
       -- with the customer (independent review D3a)
       -- PAY-05-R1: and a dispute or an unverifiable currency, which then never count: the exit when Paynow says nothing more (ICR-M4, P1)
       AND NOT (v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type IN ('amount_mismatch', 'provider_status_unrecognized',
                                                                             'provider_disputed', 'currency_mismatch')) THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
  ELSIF p_resolution = 'provider_corrected' THEN
    IF v_d.discrepancy_type NOT IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'provider_disputed',
                                    'provider_status_unrecognized') THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
    -- PAY-05: a dispute is over only when Paynow itself reports the payment Paid again
    IF v_d.discrepancy_type = 'provider_disputed' AND public.pay05_latest_provider_status(v_d.collection_id) IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER';
    END IF;
    -- PAY-05-R1: "corrected" means Paynow corrected it: its own latest word is a matching Paid CarUp applied (ICR-M1)
    IF v_c.gateway = 'paynow_zimbabwe' AND public.pay05_latest_provider_status(v_d.collection_id) IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'PAY05_CORRECTION_NOT_CONFIRMED_BY_PROVIDER';
    END IF;
  ELSIF p_resolution = 'acknowledged' THEN
    -- the invoice already counts only what the provider says the garage keeps; the operator records the review
    IF v_d.discrepancy_type NOT IN ('refund_after_resolution', 'provider_status_unrecognized', 'provider_refund_unquantified',
                                    'provider_paid_after_close')
       -- PAY-05-R1: a dispute Paynow has since closed may be reviewed and closed; it never counts (ICR-M4)
       AND NOT (v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type = 'provider_disputed'
                AND public.pay05_latest_provider_status(v_d.collection_id) IN
                    ('cancelled', 'failed', 'refunded', 'review:cancelled', 'review:failed', 'review:refunded')) THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
    -- PAY-05-R1: not while Paynow's latest word reports money: it is settled outside CarUp, or Paynow itself corrects it. An
    -- acknowledged review would free the invoice for a second payment while Paynow still holds the first (PFR)
    IF v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type IN ('provider_status_unrecognized', 'provider_paid_after_close')
       AND replace(coalesce(public.pay05_latest_provider_status(v_d.collection_id), ''), 'review:', '') IN ('paid', 'awaiting_delivery', 'delivered', 'disputed') THEN
      RAISE EXCEPTION 'PAY05_REVIEW_MONEY_STILL_REPORTED';
    END IF;
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
  -- PAY-05: settled outside CarUp — the Paynow request's room is released and later reports of the same money are only
  -- recorded (independent review D3a)
  IF p_resolution = 'settled_off_platform' AND v_c.gateway = 'paynow_zimbabwe' THEN
    PERFORM public.pay05_mark_settled_off_platform(v_c.id, trim(p_actor_id), btrim(p_note));
  END IF;
  RETURN to_jsonb(v_d) || jsonb_build_object('projection',
    public.pay04_reproject_garage_collection(v_d.collection_id, 'discrepancy_resolved', NULL));
END $$;

-- pay05_register_paynow_merchant: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_register_paynow_merchant(
  p_tenant_id uuid, p_merchant_account_id uuid, p_actor_id text, p_display_name text, p_profile jsonb, p_integrations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_int public.pay05_merchant_integrations%ROWTYPE;
  v_item jsonb;
  v_currencies text[] := '{}';
  v_out jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    PERFORM public.garage_ops03_assert_admin(p_tenant_id, trim(p_actor_id));
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'PAY05_MERCHANT_AUTHORITY_REFUSED';
  END;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN RAISE EXCEPTION 'PAY05_PROFILE_INVALID'; END IF;
  IF p_integrations IS NULL OR jsonb_typeof(p_integrations) <> 'array' OR jsonb_array_length(p_integrations) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'PAY05_INTEGRATIONS_INVALID';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_integrations) LOOP
    IF coalesce(v_item->>'currency', '') NOT IN ('USD', 'ZWG') THEN RAISE EXCEPTION 'PAY05_CURRENCY_NOT_SUPPORTED'; END IF;
    IF NOT public.pay05_mode_permitted(v_item->>'mode') THEN RAISE EXCEPTION 'PAY05_MODE_NOT_PERMITTED'; END IF;
    IF (v_item->>'currency') = ANY (v_currencies) THEN RAISE EXCEPTION 'PAY05_DUPLICATE_CURRENCY'; END IF;
    -- PAY-05-R1: Paynow test mode authenticates express requests with the merchant's own login e-mail (ICR-P2)
    IF (v_item->>'mode') = 'paynow_test' AND coalesce(v_item->>'test_auth_email', '') !~ '^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$' THEN
      RAISE EXCEPTION 'PAY05_TEST_AUTH_EMAIL_REQUIRED';
    END IF;
    v_currencies := v_currencies || (v_item->>'currency');
  END LOOP;
  IF p_merchant_account_id IS NULL THEN RAISE EXCEPTION 'PAY05_MERCHANT_ID_REQUIRED'; END IF;
  BEGIN
    INSERT INTO public.pay04_garage_merchant_accounts (
      id, tenant_id, gateway, merchant_reference, display_name, currencies, status, authority_note, registered_by, registered_role)
    VALUES (p_merchant_account_id, p_tenant_id, 'paynow_zimbabwe', 'pnm_' || replace(gen_random_uuid()::text, '-', ''), btrim(p_display_name),
      (SELECT array_agg(c ORDER BY c) FROM unnest(v_currencies) AS c), 'pending_verification',
      'The garage connected its own Paynow merchant integration; pending CarUp verification.', trim(p_actor_id), 'garage_admin')
    RETURNING * INTO v_acct;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'PAY05_MERCHANT_ALREADY_CONNECTED';
  END;
  INSERT INTO public.pay05_merchant_profiles (
    merchant_account_id, tenant_id, legal_entity_name, registration_number, settlement_bank_name, settlement_account_last4,
    settlement_account_holder, attestation, attested_by)
  VALUES (v_acct.id, p_tenant_id, btrim(p_profile->>'legal_entity_name'), nullif(btrim(coalesce(p_profile->>'registration_number', '')), ''),
    btrim(p_profile->>'settlement_bank_name'), p_profile->>'settlement_account_last4', btrim(p_profile->>'settlement_account_holder'),
    btrim(p_profile->>'attestation'), trim(p_actor_id));
  PERFORM public.pay05_audit(p_tenant_id, v_acct.id, NULL, 'merchant_registered', trim(p_actor_id), 'garage_admin',
    jsonb_build_object('merchant_reference', v_acct.merchant_reference, 'currencies', to_jsonb(v_acct.currencies),
                       'legal_entity_name', btrim(p_profile->>'legal_entity_name')));
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_integrations) LOOP
    -- PAY-05-R1: an ID is reserved only with the key proved by an authenticated Paynow reply; another garage's verified ID stays
    -- theirs after a disconnect (ICR-M11); a rejected ID cools down for everyone; every refusal reads the same (ICR-S2)
    IF coalesce(v_item->'probe'->>'result', '') <> 'authenticated'
       OR coalesce(v_item->'probe'->>'credential_fingerprint', '') <> coalesce(v_item->>'fingerprint', '')
       OR EXISTS (SELECT 1 FROM public.pay05_merchant_integrations i
                   WHERE i.mode = v_item->>'mode' AND i.integration_id = v_item->>'integration_id'
                     AND ((i.tenant_id <> p_tenant_id AND i.verified_at IS NOT NULL)
                          OR (i.status = 'rejected' AND i.closed_at > clock_timestamp() - interval '1 hour'))) THEN
      RAISE EXCEPTION 'PAY05_INTEGRATION_NOT_ACCEPTED';
    END IF;
    BEGIN
      INSERT INTO public.pay05_merchant_integrations (
        tenant_id, merchant_account_id, mode, currency, integration_id, methods, credential_ciphertext, credential_iv,
        credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role, test_auth_email)
      VALUES (p_tenant_id, v_acct.id, v_item->>'mode', v_item->>'currency', v_item->>'integration_id',
        ARRAY(SELECT DISTINCT jsonb_array_elements_text(v_item->'methods') ORDER BY 1), v_item->>'ciphertext', v_item->>'iv',
        v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),
        'garage_admin', CASE WHEN v_item->>'mode' = 'paynow_test' THEN v_item->>'test_auth_email' END)
      RETURNING * INTO v_int;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PAY05_INTEGRATION_NOT_ACCEPTED';
    END;
    PERFORM public.pay05_audit(p_tenant_id, v_acct.id, v_int.id, 'integration_registered', trim(p_actor_id), 'garage_admin',
      jsonb_build_object('currency', v_int.currency, 'integration_id', v_int.integration_id, 'mode', v_int.mode,
                         'methods', to_jsonb(v_int.methods), 'credential_fingerprint', v_int.credential_fingerprint));
    v_out := v_out || jsonb_build_array(public.pay05_integration_view(v_int));
  END LOOP;
  RETURN jsonb_build_object('merchant', to_jsonb(v_acct), 'integrations', v_out);
END $$;

-- pay05_verify_paynow_merchant: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_verify_paynow_merchant(
  p_merchant_account_id uuid, p_actor_id text, p_actor_role text, p_evidence jsonb, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acct public.pay04_garage_merchant_accounts%ROWTYPE; v_int public.pay05_merchant_integrations%ROWTYPE; v_count integer := 0; v_currency jsonb;
BEGIN
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = p_merchant_account_id FOR UPDATE;
  IF NOT FOUND OR v_acct.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_FOUND'; END IF;
  PERFORM public.pay05_assert_independent_reviewer(v_acct, p_actor_id, p_actor_role);
  IF char_length(btrim(coalesce(p_note, ''))) < 10 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  IF v_acct.status <> 'pending_verification' THEN RAISE EXCEPTION 'PAY05_MERCHANT_NOT_PENDING' USING DETAIL = v_acct.status; END IF;
  -- Paynow's API reports no currency (independent review P3): the operator confirms each integration's currency
  -- configuration in the garage's Paynow account; CarUp cannot verify it with Paynow
  IF coalesce(p_evidence->>'legal_identity_reviewed', '') <> 'true' OR coalesce(p_evidence->>'settlement_account_reviewed', '') <> 'true'
     OR coalesce(p_evidence->>'currency_configuration_reviewed', '') <> 'true' THEN
    RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE';
  END IF;
  FOR v_int IN SELECT * FROM public.pay05_merchant_integrations
                 WHERE merchant_account_id = v_acct.id AND status = 'pending_verification' FOR UPDATE LOOP
    -- each integration's ID and key were proved together by an authenticated Paynow reply (the backend's credential probe)
    IF coalesce(p_evidence->'credential_probes'->v_int.id::text->>'result', '') <> 'authenticated'
       OR coalesce(p_evidence->'credential_probes'->v_int.id::text->>'credential_fingerprint', '') <> v_int.credential_fingerprint THEN
      RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE';
    END IF;
    -- PAY-05-R1: each integration's own settlement currency, reviewed in the merchant's Paynow account, must be this
    -- integration's currency; Paynow's API reports none and CarUp never converts (ICR-P1). A real mode also needs the fee
    -- handling attested: a fee-inclusive amount would make every payment an amount review (ICR-P3).
    v_currency := p_evidence->'currency_evidence'->v_int.id::text;
    IF coalesce(v_currency->>'settlement_currency', '') = '' OR char_length(btrim(coalesce(v_currency->>'reference', ''))) NOT BETWEEN 10 AND 200
       OR (v_int.mode <> 'simulator' AND v_currency->>'fee_handling' IS DISTINCT FROM 'amount_excludes_customer_fees') THEN
      RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE';
    END IF;
    IF v_currency->>'settlement_currency' <> v_int.currency THEN RAISE EXCEPTION 'PAY05_CURRENCY_EVIDENCE_MISMATCH'; END IF;
    UPDATE public.pay05_merchant_integrations SET status = 'verified', verified_by = trim(p_actor_id), verified_role = p_actor_role,
      verified_at = clock_timestamp(), verification_evidence = jsonb_build_object('credential_probe', p_evidence->'credential_probes'->v_int.id::text,
        'note', btrim(p_note)),
      currency_evidence = jsonb_build_object('settlement_currency', v_currency->>'settlement_currency', 'reference', btrim(v_currency->>'reference'),
        'fee_handling', v_currency->>'fee_handling', 'reviewed_by', trim(p_actor_id), 'reviewed_at', clock_timestamp())
     WHERE id = v_int.id RETURNING * INTO v_int;
    PERFORM public.pay05_audit(v_acct.tenant_id, v_acct.id, v_int.id, 'integration_verified', trim(p_actor_id), p_actor_role,
      jsonb_build_object('currency', v_int.currency, 'probe', p_evidence->'credential_probes'->v_int.id::text));
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE'; END IF;
  UPDATE public.pay04_garage_merchant_accounts SET status = 'verified' WHERE id = v_acct.id RETURNING * INTO v_acct;
  PERFORM public.pay05_audit(v_acct.tenant_id, v_acct.id, NULL, 'merchant_verified', trim(p_actor_id), p_actor_role,
    jsonb_build_object('legal_identity_reviewed', true, 'settlement_account_reviewed', true, 'currency_configuration_reviewed', true,
                       'note', btrim(p_note), 'integrations_verified', v_count));
  RETURN jsonb_build_object('merchant', to_jsonb(v_acct), 'integrations_verified', v_count);
END $$;

-- pay05_mark_paynow_initiation: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_mark_paynow_initiation(p_collection_id uuid, p_state text, p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_closed boolean := false;
BEGIN
  IF p_state NOT IN ('refused', 'unknown') THEN RAISE EXCEPTION 'PAY05_INITIATION_STATE_INVALID'; END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY05_TRANSACTION_NOT_FOUND'; END IF;
  IF v_tx.initiation_state = p_state THEN RETURN jsonb_build_object('replayed', true, 'initiation_state', v_tx.initiation_state); END IF;
  -- PAY-05-R1: Paynow's refusal may arrive after a concurrent trace attempt marked the request unknown (ICR-M8)
  IF v_tx.initiation_state NOT IN ('sending', 'unknown') THEN RAISE EXCEPTION 'PAY05_INITIATION_STATE_INVALID' USING DETAIL = v_tx.initiation_state; END IF;
  UPDATE public.pay05_paynow_transactions SET initiation_state = p_state, provider_error = left(p_error, 160), updated_at = clock_timestamp()
   WHERE collection_id = p_collection_id RETURNING * INTO v_tx;
  -- Paynow refused it: nothing waits at Paynow, so the payment closes now and its room is free — even if a stop arrived
  -- while the request was in flight (independent review S1: a stop alone never closes an unresolved request). Should
  -- Paynow's signed update ever show the request exists after all, it binds late into an operator review.
  IF p_state = 'refused' AND v_p.status = 'pending' AND v_c.provider_payment_id IS NULL THEN
    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE reference = v_p.reference;
    IF v_c.cancelled_at IS NULL THEN
      UPDATE public.pay04_garage_collections SET cancelled_at = clock_timestamp(), cancelled_by = 'provider:paynow_zimbabwe',
             cancel_reason = left('Paynow refused the payment request: ' || coalesce(nullif(btrim(p_error), ''), 'no reason given'), 300)
       WHERE id = v_c.id RETURNING * INTO v_c;
    END IF;
    PERFORM public.pay04_log(v_c, 'cancelled', 'provider:paynow_zimbabwe',
      jsonb_build_object('reason', 'refused by Paynow', 'closed_without_provider', true));
    v_closed := true;
  END IF;
  RETURN jsonb_build_object('replayed', false, 'initiation_state', v_tx.initiation_state, 'payment_closed', v_closed);
END $$;

-- pay05_apply_paynow_observation: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_apply_paynow_observation(
  p_collection_id uuid, p_via text, p_event_id text, p_provider_status text, p_raw_status text, p_amount_minor bigint,
  p_reference text, p_paynow_reference text, p_payment_id text, p_message_hash text DEFAULT NULL, p_read_ticket bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_acct public.pay04_garage_merchant_accounts%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_obs uuid;
  v_event_collection uuid;
  v_via text;
  v_money boolean;
  v_snapshot text;
  v_branch text;
  v_ignored text;
  v_result jsonb;
  v_disc jsonb := NULL;
  v_amount numeric;
  v_settled boolean;
  v_money_seen boolean;
  v_last public.pay05_paynow_observations%ROWTYPE;
BEGIN
  IF p_via NOT IN ('status_update', 'poll', 'trace', 'otp_reply') THEN RAISE EXCEPTION 'PAY05_OBSERVATION_SOURCE_INVALID'; END IF;
  IF (p_via = 'status_update') <> (p_message_hash IS NOT NULL AND p_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PAY05_OBSERVATION_IDENTITY_INVALID';
  END IF;
  IF p_provider_status NOT IN ('created', 'sent', 'awaiting_delivery', 'delivered', 'paid', 'cancelled', 'failed', 'disputed',
                               'refunded', 'unrecognized') THEN
    RAISE EXCEPTION 'PAY05_PROVIDER_STATUS_INVALID';
  END IF;
  IF p_read_ticket IS NOT NULL AND p_read_ticket <= 0 THEN RAISE EXCEPTION 'PAY05_READ_TICKET_INVALID'; END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  -- the lock order every garage-collection writer shares: invoice -> payment reference -> rows
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts WHERE id = v_c.merchant_account_id;
  IF v_tx.collection_id IS NULL OR v_c.provider_payment_id IS NULL OR v_tx.initiation_state IS DISTINCT FROM 'attached' THEN
    RAISE EXCEPTION 'PAY05_COLLECTION_NOT_ATTACHED';
  END IF;
  -- evidence that does not belong to THIS collection is refused, never applied
  IF p_payment_id IS DISTINCT FROM v_c.provider_payment_id OR p_reference IS DISTINCT FROM v_c.payment_reference THEN
    RAISE EXCEPTION 'PAY05_PROVIDER_BINDING_MISMATCH';
  END IF;
  -- a resend of a signed status update CarUp already recorded: nothing again
  IF p_event_id IS NOT NULL THEN
    SELECT collection_id INTO v_event_collection FROM public.pay05_paynow_observations WHERE event_id = p_event_id;
    IF FOUND THEN
      IF v_event_collection IS DISTINCT FROM v_c.id THEN RAISE EXCEPTION 'PAY05_EVENT_CROSS_COLLECTION_REPLAY'; END IF;
      RETURN jsonb_build_object('applied', false, 'duplicate_event', true, 'payment_status', v_p.status, 'provider_status', v_tx.provider_status);
    END IF;
  END IF;

  v_money := p_provider_status IN ('paid', 'awaiting_delivery', 'delivered', 'disputed');
  -- What this read may do (independent review D1, D3a). Paynow is read outside any lock, so arrival order is not
  -- Paynow's order: a read that started before the latest read CarUp evaluated is superseded; a pre-payment status after
  -- money is a lagging read (stale regression); after an operator settled the money outside CarUp, or once the payment
  -- is closed, a non-money status changes nothing. Each is recorded, never applied.
  -- PAY-05-R1: a ticket orders when CarUp asked, not when Paynow answered, so a word that moves the payment forward is never
  -- superseded (ICR-M7). After a settlement only a repeat of the settled evidence is recorded-only: anything else from Paynow
  -- is evaluated below, and money is reviewed, never allocated (ICR-M3).
  v_settled := v_tx.settled_off_platform_at IS NOT NULL;
  SELECT * INTO v_last FROM public.pay05_paynow_observations
   WHERE collection_id = v_c.id AND outcome IN ('applied', 'review') ORDER BY seq DESC LIMIT 1;
  -- whatever became of the read: a money word from an older read still means Paynow reported money
  v_money_seen := EXISTS (SELECT 1 FROM public.pay05_paynow_observations
                           WHERE collection_id = v_c.id AND provider_status IN ('paid', 'awaiting_delivery', 'delivered', 'disputed'));
  -- PAY-05-R1: a status update CarUp already recorded, read again and showing nothing new, writes no row and starts no new
  -- generation (PFR-M3). It is still a read: an older one in flight must not pass it, and its time is shown.
  IF p_via = 'status_update' AND p_provider_status = v_tx.provider_status AND p_amount_minor IS NOT DISTINCT FROM v_last.amount_minor
     AND EXISTS (SELECT 1 FROM public.pay05_paynow_observations WHERE collection_id = v_c.id AND message_hash = p_message_hash) THEN
    UPDATE public.pay05_paynow_transactions SET last_read_at = clock_timestamp(), last_status_update_hash = p_message_hash,
      last_read_ticket = CASE WHEN p_read_ticket IS NULL THEN last_read_ticket ELSE greatest(coalesce(last_read_ticket, p_read_ticket), p_read_ticket) END,
      updated_at = clock_timestamp()
     WHERE collection_id = v_c.id;
    RETURN jsonb_build_object('applied', false, 'unchanged', true, 'provider_status', v_tx.provider_status, 'payment_status', v_p.status);
  END IF;
  IF p_read_ticket IS NOT NULL AND v_tx.last_read_ticket IS NOT NULL AND p_read_ticket < v_tx.last_read_ticket
     AND (public.pay05_paynow_money_rank(p_provider_status) <= public.pay05_paynow_money_rank(v_tx.provider_status)
          -- PAY-05-R1: an unrecognised word, or Cancelled or Failed after money, is the newer read's answer and has no place in the
          -- order above: only a newer read moves past it. An older read's Paid never overrides it (PFR-H1).
          OR (public.pay05_paynow_money_rank(v_tx.provider_status) = 0
              AND (v_tx.provider_status = 'unrecognized' OR v_money_seen))) THEN
    v_ignored := 'superseded';
  ELSIF (p_provider_status IN ('created', 'sent')
         AND v_tx.provider_status IN ('awaiting_delivery', 'delivered', 'paid', 'disputed', 'refunded', 'cancelled', 'failed'))
     OR (p_provider_status IN ('awaiting_delivery', 'delivered') AND v_tx.provider_status IN ('paid', 'disputed', 'refunded')) THEN
    v_ignored := 'stale_regression';
  ELSIF v_settled AND (p_provider_status IN ('created', 'sent')
                       OR (p_provider_status = v_last.provider_status AND p_amount_minor IS NOT DISTINCT FROM v_last.amount_minor)) THEN
    v_ignored := 'after_settlement';
  -- PAY-05-R1: a Refunded on a closed payment always tells the operator, whether or not CarUp saw the money (PFR-L2); and once
  -- Paynow reported money on it, its newer words are evaluated, so the word CarUp holds is not a stale one
  ELSIF v_p.status = 'cancelled' AND NOT v_money AND p_provider_status <> 'refunded' AND NOT v_money_seen THEN
    v_ignored := 'after_close';
  -- PAY-05-R1: the same report again after an operator closed its review is recorded only: a re-read neither reopens the
  -- review nor takes the room back (ICR-M10); a different report is evaluated
  ELSIF v_last.outcome = 'review' AND p_provider_status = v_last.provider_status AND p_amount_minor IS NOT DISTINCT FROM v_last.amount_minor
        AND NOT EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies
                         WHERE collection_id = v_c.id AND status = 'open' AND discrepancy_type <> 'unallocated_provider_money') THEN
    v_ignored := 'after_review';
  END IF;

  v_amount := CASE WHEN p_amount_minor IS NULL THEN NULL ELSE (p_amount_minor::numeric / (10 ^ v_c.currency_scale)::numeric)::numeric(14,2) END;
  IF v_ignored IS NULL THEN
    -- PAY-05-R1: money after a close or a settlement is late money whatever its amount (ICR-M3, M9); Disputed is a dispute
    -- whatever its amount (ICR-M5); an unverifiable currency never reaches an allocation (ICR-P1); Cancelled or Failed after
    -- Paynow reported money is a review, not an applied close (ICR-M4); a refund of a closed payment tells the operator.
    IF v_money AND (v_p.status = 'cancelled' OR (v_settled AND p_provider_status <> 'disputed')) THEN
      v_branch := 'paid_after_close';
    ELSIF p_provider_status = 'disputed' THEN
      v_branch := 'disputed';
    ELSIF v_money AND NOT public.pay05_collection_currency_bound(v_c.id) THEN
      v_branch := 'currency_unverified';
    ELSIF v_money AND p_amount_minor IS DISTINCT FROM v_c.amount_minor THEN
      v_branch := 'amount_mismatch';
    ELSIF p_provider_status IN ('cancelled', 'failed') AND v_money_seen THEN
      v_branch := 'unrecognized';
    ELSIF p_provider_status = 'refunded' AND v_p.status = 'cancelled' THEN
      v_branch := 'refund_after_close';
    ELSE
      v_snapshot := CASE p_provider_status
        WHEN 'paid' THEN 'paid'
        WHEN 'refunded' THEN 'refunded'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'failed' THEN 'cancelled'
        WHEN 'unrecognized' THEN NULL
        ELSE 'pending' END;
      v_branch := CASE WHEN v_snapshot IS NULL
                          OR NOT ((v_p.status = 'pending' AND v_snapshot IN ('pending', 'paid', 'cancelled', 'refunded'))
                                  OR (v_p.status = 'paid' AND v_snapshot IN ('paid', 'refunded'))
                                  OR (v_p.status = 'refunded' AND v_snapshot = 'refunded')
                                  OR (v_p.status = 'cancelled' AND v_snapshot = 'cancelled'))
                       THEN 'unrecognized' ELSE 'snapshot' END;
    END IF;
  END IF;

  INSERT INTO public.pay05_paynow_observations (tenant_id, collection_id, event_id, via, provider_status, raw_status, amount_minor,
    paynow_reference, read_ticket, outcome, message_hash)
  VALUES (v_c.tenant_id, v_c.id, p_event_id, p_via, p_provider_status, left(p_raw_status, 160), p_amount_minor, left(p_paynow_reference, 64),
    p_read_ticket, coalesce(v_ignored, CASE WHEN v_branch = 'snapshot' THEN 'applied' ELSE 'review' END), p_message_hash)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_obs;
  IF v_obs IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'duplicate_event', true, 'payment_status', v_p.status, 'provider_status', v_tx.provider_status);
  END IF;
  -- PAY-05-R1: on record, whatever became of the read: a closed payment Paynow reported money on never reads as if it had not
  IF v_money AND v_tx.money_reported_at IS NULL THEN
    UPDATE public.pay05_paynow_transactions SET money_reported_at = clock_timestamp() WHERE collection_id = v_c.id RETURNING * INTO v_tx;
  END IF;
  -- PAY-05-R1: each recorded status update advances the collection's generation, which is part of the next update's identity
  -- (ICR-M2); the message counts as seen unless its confirming read was not evaluated, in which case a resend must read again
  IF p_via = 'status_update' THEN
    UPDATE public.pay05_paynow_transactions SET status_update_generation = status_update_generation + 1,
      last_status_update_hash = CASE WHEN coalesce(v_ignored, '') IN ('superseded', 'stale_regression') THEN last_status_update_hash ELSE p_message_hash END,
      updated_at = clock_timestamp()
     WHERE collection_id = v_c.id RETURNING * INTO v_tx;
  END IF;
  IF v_ignored IS NOT NULL THEN
    -- PAY-05-R1: a read that repeats what CarUp holds is still the newest read (PFR-H1) and the time Paynow was last read
    -- (PFR-L5). An older or lagging read is neither.
    IF v_ignored NOT IN ('superseded', 'stale_regression') THEN
      UPDATE public.pay05_paynow_transactions SET last_read_at = clock_timestamp(),
        last_read_ticket = CASE WHEN p_read_ticket IS NULL THEN last_read_ticket ELSE greatest(coalesce(last_read_ticket, p_read_ticket), p_read_ticket) END,
        updated_at = clock_timestamp()
       WHERE collection_id = v_c.id RETURNING * INTO v_tx;
    END IF;
    RETURN jsonb_build_object('applied', false, 'ignored', v_ignored, 'observation_id', v_obs, 'provider_status', v_tx.provider_status,
      'payment_status', v_p.status);
  END IF;
  -- the latest Paynow status CarUp evaluated (never one it ignored), and the newest read it considered
  UPDATE public.pay05_paynow_transactions SET provider_status = p_provider_status, provider_status_at = clock_timestamp(),
    paynow_reference = coalesce(paynow_reference, left(p_paynow_reference, 64)),
    last_read_at = clock_timestamp(),
    last_read_ticket = CASE WHEN p_read_ticket IS NULL THEN last_read_ticket ELSE greatest(coalesce(last_read_ticket, p_read_ticket), p_read_ticket) END,
    updated_at = clock_timestamp()
   WHERE collection_id = v_c.id RETURNING * INTO v_tx;

  v_via := CASE WHEN p_via = 'status_update' THEN 'signed_webhook' ELSE 'provider_readback' END;
  IF v_branch = 'amount_mismatch' THEN
    v_disc := public.pay04_record_discrepancy(v_c, 'amount_mismatch', v_amount,
      jsonb_build_object('observed_amount_minor', p_amount_minor, 'expected_amount_minor', v_c.amount_minor,
                         'observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'refused', 'amount_mismatch', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', NULL));
  ELSIF v_branch = 'paid_after_close' THEN
    -- Paynow took money after CarUp had closed this payment: never counted here; an operator settles it
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_paid_after_close', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status, 'attached_after_close', v_tx.attached_after_close,
                         'observed_amount_minor', p_amount_minor, 'after_settlement', v_settled), v_via, p_event_id);
    -- PAY-05-R1: evidence that disagrees with what was settled stops whatever part of it still counted
    v_result := jsonb_build_object('applied', false, 'refused', 'paid_after_close', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_paid_after_close', NULL));
  ELSIF v_branch = 'currency_unverified' THEN
    -- PAY-05-R1: this integration has no reviewed settlement currency: the money is recorded for an operator, never allocated
    v_disc := public.pay04_record_discrepancy(v_c, 'currency_mismatch', v_amount,
      jsonb_build_object('reason', 'currency_configuration_unverified', 'observed_status', p_provider_status,
                         'observed_amount_minor', p_amount_minor, 'via', p_via, 'event_id', p_event_id), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'refused', 'currency_unverified', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', NULL));
  ELSIF v_branch = 'refund_after_close' THEN
    -- PAY-05-R1: Paynow refunded money that CarUp had recorded as late money: the payment stays closed, the operator is told
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_refund_unquantified', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'observed_amount_minor', p_amount_minor, 'via', p_via,
                         'event_id', p_event_id, 'payment_status', v_p.status), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_refund_unquantified', 'discrepancy', v_disc);
  ELSIF v_branch = 'disputed' THEN
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_disputed', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status, 'observed_amount_minor', p_amount_minor), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_disputed', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_disputed', NULL));
  ELSIF v_branch = 'unrecognized' THEN
    -- a word Paynow does not document, or a step backwards from money: recorded for an operator, never applied
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_status_unrecognized', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'raw_status', left(p_raw_status, 160), 'via', p_via,
                         'event_id', p_event_id, 'payment_status', v_p.status), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_status_unrecognized', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_status_unrecognized', NULL));
  ELSE
    IF v_snapshot = 'paid' THEN
      -- Paynow reports the money released again: an open dispute is over (the provider says so)
      UPDATE public.pay04_garage_payment_discrepancies SET status = 'resolved', resolution = 'provider_corrected',
        resolved_by = 'provider:paynow_zimbabwe', resolved_role = 'provider_confirmation',
        resolution_note = 'Paynow reports the payment Paid again: the dispute is over.', resolved_at = clock_timestamp()
       WHERE collection_id = v_c.id AND discrepancy_type = 'provider_disputed' AND status = 'open';
      IF FOUND THEN
        PERFORM public.pay04_log(v_c, 'discrepancy_resolved', 'provider:paynow_zimbabwe',
          jsonb_build_object('discrepancy_type', 'provider_disputed', 'resolution', 'provider_corrected'));
      END IF;
    END IF;
    -- a Refunded whose amount did not parse is still the whole transaction refunded (independent review D3b): Paynow's
    -- "Refunded" names no refund amount, so the operator review below confirms it either way
    -- PAY-05-R1: and so is a Refunded with another figure: it applies in full and the figure is only evidence (ICR-M6)
    v_result := public.pay04_apply_garage_provider_snapshot(
      v_c.id, v_snapshot, v_c.provider_payment_id, NULL, NULL, NULL,
      CASE WHEN v_snapshot = 'refunded' THEN v_c.amount_minor ELSE p_amount_minor END,
      v_c.currency, v_acct.merchant_reference,
      CASE WHEN v_snapshot = 'refunded' THEN v_c.amount_minor ELSE NULL END,
      CASE WHEN v_snapshot = 'refunded' THEN 0 ELSE NULL END, NULL, NULL, v_via);
    -- PAY-05-R1: an observation recorded as applied really was: anything else aborts, nothing half-recorded (ICR-M6)
    IF (v_result->>'applied')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'PAY05_OBSERVATION_NOT_APPLIED' USING DETAIL = coalesce(v_result->>'refused', 'unknown');
    END IF;
    -- PAY-05-R1: one refund review per collection: an acknowledged one does not reopen on every re-read (ICR-M10)
    IF v_snapshot = 'refunded' AND NOT EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies
                                                WHERE collection_id = v_c.id AND discrepancy_type = 'provider_refund_unquantified' AND status = 'resolved') THEN
      -- Paynow's "Refunded" carries no amount and partial refunds are undocumented: CarUp counts nothing for this
      -- payment and asks an operator to confirm the refund in the merchant's Paynow records
      v_disc := public.pay04_record_discrepancy(v_c, 'provider_refund_unquantified', v_amount,
        jsonb_build_object('observed_status', p_provider_status, 'observed_amount_minor', p_amount_minor, 'via', p_via,
                           'event_id', p_event_id), v_via, p_event_id);
    END IF;
  END IF;
  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('observation_id', v_obs, 'provider_status', p_provider_status,
    'discrepancy', coalesce(v_disc, v_result->'discrepancy'),
    'payment_status', (SELECT status FROM public.payment_transactions WHERE reference = v_c.payment_reference));
END $$;

-- pay05_release_paynow_hold: PAY-05 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay05_release_paynow_hold(p_collection_id uuid, p_actor_id text, p_actor_role text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_probe public.pay04_garage_collections%ROWTYPE;
  v_c public.pay04_garage_collections%ROWTYPE;
  v_p public.payment_transactions%ROWTYPE;
  v_tx public.pay05_paynow_transactions%ROWTYPE;
  v_obs public.pay05_paynow_observations%ROWTYPE;
  v_m record;
  v_last text;
BEGIN
  IF coalesce(p_actor_role, '') NOT IN ('admin', 'super_admin') OR NOT public.pay03b_is_platform_admin(p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_RELEASE_AUTHORITY_REFUSED';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'PAY05_REASON_REQUIRED'; END IF;
  SELECT * INTO v_probe FROM public.pay04_garage_collections WHERE id = p_collection_id;
  IF NOT FOUND OR v_probe.gateway <> 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND'; END IF;
  -- PAY-05-R1: nor a person who worked at this garage, though removed since (PFR-L10)
  IF public.pay03b_payment_payer_conflict(v_probe.payment_reference, trim(p_actor_id)) OR public.pay05_worked_at_garage(v_probe.tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_RELEASE_SELF_DEALING_REFUSED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay04_inv:' || v_probe.invoice_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_probe.payment_reference));
  PERFORM 1 FROM public.garage_invoices WHERE id = v_probe.invoice_id FOR UPDATE;
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id FOR UPDATE;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_c.payment_reference FOR UPDATE;
  SELECT * INTO v_tx FROM public.pay05_paynow_transactions WHERE collection_id = v_c.id FOR UPDATE;
  IF NOT FOUND OR v_tx.initiation_state NOT IN ('attached', 'sending', 'unknown') THEN RAISE EXCEPTION 'PAY05_COLLECTION_NOT_ATTACHED'; END IF;
  IF v_tx.hold_released_at IS NOT NULL THEN RETURN jsonb_build_object('replayed', true, 'hold_released_at', v_tx.hold_released_at); END IF;
  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = v_p.status; END IF;
  -- PAY-05-R1: never while a review of this payment is open (ICR-M4, W6)
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies WHERE collection_id = v_c.id AND status = 'open') THEN
    RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = 'review_open';
  END IF;
  IF v_c.expires_at > clock_timestamp() THEN RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = 'not_expired'; END IF;
  IF v_tx.initiation_state IN ('sending', 'unknown') THEN
    -- a request Paynow never confirmed: released only after a FRESH trace attempt. If it exists after all, Paynow's
    -- signed update still binds it, and its money counts only into free room (otherwise unallocated, for an operator).
    IF v_tx.last_trace_at IS NULL OR v_tx.last_trace_at < clock_timestamp() - interval '15 minutes' THEN
      RAISE EXCEPTION 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_TRACE';
    END IF;
    v_last := 'unconfirmed:' || v_tx.initiation_state;
  ELSE
    -- PAY-05-R1: the latest read of any kind, including one recorded only because it repeats a word whose review closed (PFR-H2)
    SELECT * INTO v_obs FROM public.pay05_paynow_observations
     WHERE collection_id = v_c.id AND outcome IN ('applied', 'review', 'after_review') ORDER BY seq DESC LIMIT 1;
    IF NOT FOUND OR v_obs.observed_at < clock_timestamp() - interval '15 minutes' OR v_obs.provider_status NOT IN ('created', 'sent', 'cancelled', 'failed', 'unrecognized') THEN
      RAISE EXCEPTION 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ';
    END IF;
    v_last := v_obs.provider_status;
  END IF;
  UPDATE public.pay05_paynow_transactions SET hold_released_at = clock_timestamp(), hold_released_by = trim(p_actor_id),
    hold_release_reason = btrim(p_reason), updated_at = clock_timestamp()
   WHERE collection_id = v_c.id RETURNING * INTO v_tx;
  PERFORM public.pay04_log(v_c, 'hold_released', trim(p_actor_id), jsonb_build_object('reason', btrim(p_reason),
    'last_provider_status', v_last, 'observed_at', v_obs.observed_at, 'last_trace_at', v_tx.last_trace_at));
  PERFORM public.pay05_audit(v_c.tenant_id, v_c.merchant_account_id, v_tx.integration_row_id, 'hold_released', trim(p_actor_id),
    p_actor_role, jsonb_build_object('collection_id', v_c.id, 'reason', btrim(p_reason), 'last_provider_status', v_last));
  SELECT * INTO v_m FROM public.pay04_invoice_money(v_c.invoice_id);
  RETURN jsonb_build_object('replayed', false, 'hold_released_at', v_tx.hold_released_at, 'money', to_jsonb(v_m));
END $$;

-- pay04_guard_invoice_void: PAY-04 text + the hunks marked "PAY-05-R1" (drift-tested)
CREATE OR REPLACE FUNCTION public.pay04_guard_invoice_void()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_m record;
BEGIN
  IF OLD.status = 'issued' AND NEW.status = 'voided' THEN
    SELECT * INTO v_m FROM public.pay04_invoice_money(OLD.id);
    IF v_m.provider_paid <> 0 OR EXISTS (
         SELECT 1 FROM public.pay04_garage_collections c JOIN public.payment_transactions p ON p.reference = c.payment_reference
          WHERE c.invoice_id = OLD.id AND p.status IN ('paid', 'partially_refunded')
            -- PAY-05-R1: a Paynow row still reading paid that no longer counts holds nothing, once settled or once Paynow's latest
            -- word is not Paid (PFR-L9). Open reviews stay reserved, and refuse below. Later money is never counted on a void invoice.
            AND NOT (c.gateway = 'paynow_zimbabwe'
                     AND (public.pay05_settled_off_platform(c.id) OR public.pay05_latest_provider_status(c.id) IS DISTINCT FROM 'paid'))) THEN
      RAISE EXCEPTION 'PAY04_INVOICE_HAS_PROVIDER_PAYMENTS';
    END IF;
    IF v_m.provider_reserved <> 0 THEN RAISE EXCEPTION 'PAY04_INVOICE_HAS_PAYMENT_IN_PROGRESS'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- ─────────────────────────── 4. least privilege ───────────────────────────

REVOKE ALL ON FUNCTION public.pay05_settled_off_platform(uuid), public.pay05_paynow_money_rank(text),
  public.pay05_collection_currency_bound(uuid), public.pay05_worked_at_garage(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay05_begin_status_update_read(uuid, text), public.pay05_open_paynow_review(uuid, text, text, text),
  public.pay05_held_collection_ids(integer), public.pay05_record_read_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay05_begin_status_update_read(uuid, text), public.pay05_open_paynow_review(uuid, text, text, text),
  public.pay05_held_collection_ids(integer), public.pay05_record_read_attempt(uuid) TO service_role;
-- the identity sequences of PAY-05's own tables: no API role writes those tables, so none needs them
REVOKE ALL ON SEQUENCE public.pay05_merchant_audit_events_seq_seq, public.pay05_paynow_observations_seq_seq,
  public.pay05_provider_errors_seq_seq FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- +migrate Down
-- R1 never deletes evidence and never restores functions that would re-count reversed money (the PAY-05 rule).
DO $$ BEGIN RAISE EXCEPTION 'PAY05_RETAIN_PAYMENT_EVIDENCE'; END $$;
