-- CARUP-PAY-04-LR01 — provider-confirmed garage payments (migration 20261102110000) on real PostgreSQL.
--
--   G   gateway + merchant authority: runtime-guarded simulator only; platform operator registers; never CarUp Stripe
--   A   initiation authority: the invoice's customer only (not a garage member, not an outsider); currency, precision,
--       uncommitted balance; idempotent per (payer, key); the canonical row is third-party money of the garage
--   R   reservation: money in flight cannot be committed by a declared payment, a second collection or a void
--   L   lifecycle on F5: attach once, provider-confirmed paid -> allocation + receipt, replay-safe, cross-collection replay
--       refused, garage refund -> refund_pending (deallocated, receipt voided) -> refunded
--   H   F5 hold: provider partial refund holds and deallocates; direct release refused; operator final partial refund
--       re-projects the remainder; operator restore re-allocates; separation of duties includes garage members
--   D   discrepancies: merchant / amount / currency mismatch recorded, never applied; late money the invoice cannot
--       absorb is unallocated + open; a provider-confirmed refund closes it
--   I   invariants: append-only ledger and history, one live receipt per collection equal to the counted amount, shared
--       gapless receipt numbering, no over-allocation even for a direct writer, no stock movement, least privilege
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY04_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ p_pattern THEN
      RAISE EXCEPTION 'PAY04_SMOKE_WRONG_ERROR: expected % got % (sql: %)', p_pattern, SQLERRM, left(p_sql, 200);
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY04_SMOKE_EXPECTED_FAILURE: % (sql: %)', p_pattern, left(p_sql, 200);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PAY04_SMOKE_CHECK_FAILED: %', p_what; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.garage(p_prefix text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid; v_branch uuid; v_profile uuid;
BEGIN
  INSERT INTO users (id, name, email, role, join_date) VALUES
    (p_prefix || '-admin', p_prefix || '-admin', p_prefix || '-admin@example.invalid', 'owner', '2026-01-01'),
    (p_prefix || '-mech', p_prefix || '-mech', p_prefix || '-mech@example.invalid', 'owner', '2026-01-01');
  INSERT INTO tenants (name, type, status) VALUES (p_prefix || ' Garage', 'garage', 'active') RETURNING id INTO v_tenant;
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (v_tenant, p_prefix || '-admin', 'admin'), (v_tenant, p_prefix || '-mech', 'admin');
  INSERT INTO garage_branches (tenant_id, name, branch_code, timezone, is_active)
    VALUES (v_tenant, p_prefix || ' Central', upper(p_prefix) || '-C', 'Africa/Harare', true) RETURNING id INTO v_branch;
  INSERT INTO garage_workforce_profiles (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
    VALUES (v_tenant, p_prefix || '-mech', upper(p_prefix) || '-M', 'employee', 'active', '2026-10-01', p_prefix || '-admin') RETURNING id INTO v_profile;
  INSERT INTO garage_workforce_branch_assignments (tenant_id, workforce_profile_id, branch_id, is_primary, assigned_by_user_id)
    VALUES (v_tenant, v_profile, v_branch, true, p_prefix || '-admin');
  UPDATE tenant_users SET role = 'mechanic' WHERE tenant_id = v_tenant AND user_id = p_prefix || '-mech';
  RETURN v_tenant;
END $$;

-- A completed, owner-authorized job invoiced for p_amount (one labour line from its service record). Returns the invoice.
CREATE OR REPLACE FUNCTION pg_temp.invoice(p_tenant uuid, p_prefix text, p_vin text, p_customer text, p_amount numeric, p_currency text DEFAULT 'USD')
RETURNS garage_invoices LANGUAGE plpgsql AS $$
DECLARE v_branch uuid; v_case uuid; v_wo uuid; v_rec uuid; v_inv garage_invoices%ROWTYPE;
BEGIN
  SELECT id INTO v_branch FROM garage_branches WHERE tenant_id = p_tenant LIMIT 1;
  INSERT INTO service_cases (vin, garage_tenant_id, branch_id, requester_user_id, status)
    VALUES (p_vin, p_tenant, v_branch, p_customer, 'accepted') RETURNING id INTO v_case;
  INSERT INTO mechanic_work_orders (tenant_id, vin, customer_id, service_case_id, branch_id, status, owner_authorization)
    VALUES (p_tenant, p_vin, p_customer, v_case, v_branch, 'In Progress', 'pending') RETURNING id INTO v_wo;
  PERFORM mechanic_work_order_decide_authorization(v_wo, p_vin, p_customer, 'owner', NULL, 'owner', 'authorized', NULL);
  INSERT INTO work_order_assignments (work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
    VALUES (v_wo, p_tenant, p_prefix || '-mech', p_prefix || '-admin');
  UPDATE service_cases SET status = 'active' WHERE id = v_case;
  INSERT INTO service_records (work_order_id, service_case_id, tenant_id, vin, work_performed, service_authority, total_cost, currency, recorded_by_user_id, performed_at)
    VALUES (v_wo, v_case, p_tenant, p_vin, 'Service', 'garage_stated', p_amount, p_currency, p_prefix || '-mech', now()) RETURNING id INTO v_rec;
  PERFORM garage_ops05_complete_job(p_tenant, v_case, p_prefix || '-admin');
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(p_tenant, v_wo, p_currency,
    jsonb_build_array(jsonb_build_object('category','labour','description','Workshop service','quantity',1,'unit_price',p_amount,
                                         'source_kind','service_record','source_id',v_rec)), NULL, NULL, NULL, p_prefix || '-admin');
  RETURN v_inv;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.collection(p_begin jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT (p_begin->'collection'->>'id')::uuid;
$$;
CREATE OR REPLACE FUNCTION pg_temp.attach(p_collection uuid) RETURNS void LANGUAGE sql AS $$
  SELECT pay04_attach_garage_collection(p_collection, 'gsim_co_' || replace(p_collection::text, '-', ''),
                                        'sim_pi_gar_' || replace(p_collection::text, '-', ''));
$$;
CREATE OR REPLACE FUNCTION pg_temp.pid(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT 'sim_pi_gar_' || replace(p_collection::text, '-', '');
$$;
-- Apply a provider snapshot for a collection with the merchant's own reference and the collection's own amount.
CREATE OR REPLACE FUNCTION pg_temp.snap(p_collection uuid, p_status text, p_event text,
  p_refund_id text DEFAULT NULL, p_refunded bigint DEFAULT NULL, p_pending bigint DEFAULT NULL, p_refund_ids text[] DEFAULT NULL,
  p_mismatch text DEFAULT NULL, p_amount_minor bigint DEFAULT NULL, p_currency text DEFAULT NULL, p_merchant text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pay04_apply_garage_provider_snapshot(
    c.id, p_status, pg_temp.pid(c.id), p_refund_id, p_event, CASE WHEN p_event IS NULL THEN NULL ELSE 'gsim.' || p_status END,
    coalesce(p_amount_minor, c.amount_minor), coalesce(p_currency, c.currency), coalesce(p_merchant, a.merchant_reference),
    p_refunded, p_pending, p_refund_ids, p_mismatch, 'signed_webhook')
  FROM pay04_garage_collections c JOIN pay04_garage_merchant_accounts a ON a.id = c.merchant_account_id
  WHERE c.id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.money(p_invoice uuid) RETURNS record LANGUAGE sql AS $$
  SELECT m FROM pay04_invoice_money(p_invoice) m;
$$;
CREATE OR REPLACE FUNCTION pg_temp.status(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT p.status FROM pay04_garage_collections c JOIN payment_transactions p ON p.reference = c.payment_reference WHERE c.id = p_collection;
$$;

-- ═══════════════════════════ G, A, R, L ═══════════════════════════
DO $$
DECLARE
  g uuid; g2 uuid; v_acct pay04_garage_merchant_accounts%ROWTYPE;
  inv garage_invoices%ROWTYPE; inv_void garage_invoices%ROWTYPE; inv_zwg garage_invoices%ROWTYPE;
  b jsonb; b2 jsonb; c1 uuid; c2 uuid; v_pay payment_transactions%ROWTYPE; v_m record; v_res jsonb;
  v_moves bigint; v_receipts_before int; v_counter bigint;
BEGIN
  INSERT INTO users (id, name, email, role, join_date) VALUES
    ('p4p-cust', 'p4p-cust', 'p4p-cust@example.invalid', 'owner', '2026-01-01'),
    ('p4p-out', 'p4p-out', 'p4p-out@example.invalid', 'owner', '2026-01-01'),
    ('p4p-op', 'p4p-op', 'p4p-op@example.invalid', 'admin', '2026-01-01');
  INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id) VALUES ('PAY04PROVVIN000001', 'Toyota', 'Fortuner', 2021, 40000, 1000, 'p4p-cust');
  g := pg_temp.garage('p4p');
  g2 := pg_temp.garage('p4q');
  SELECT count(*) INTO v_moves FROM garage_stock_movements;

  -- G: the simulator gateway is refused until the disposable runtime guard enables it; CarUp's Stripe never qualifies.
  PERFORM pg_temp.expect(format($q$SELECT pay04_register_garage_merchant_account(%L, 'pay04_garage_provider_simulator', 'gsim_merchant_p4p_main', 'P4P Garage (simulated)', ARRAY['USD'], 'p4p-op', 'admin', 'Level 1 simulation for PAY-04 smoke')$q$, g), 'PAY04_GATEWAY_NOT_PERMITTED');
  UPDATE pay04_runtime_guard SET garage_simulator_enabled = true, note = 'disposable PAY-04 certification', updated_at = clock_timestamp();
  PERFORM pg_temp.expect(format($q$SELECT pay04_register_garage_merchant_account(%L, 'stripe_carup_japan_sandbox', 'gsim_merchant_p4p_main', 'CarUp Japan', ARRAY['USD'], 'p4p-op', 'admin', 'must never collect garage money')$q$, g), 'PAY04_GATEWAY_NOT_PERMITTED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_register_garage_merchant_account(%L, 'pay04_garage_provider_simulator', 'gsim_merchant_p4p_main', 'P4P Garage', ARRAY['USD'], 'p4p-admin', 'admin', 'garage admin is not the platform')$q$, g), 'PAY04_MERCHANT_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_register_garage_merchant_account(%L, 'pay04_garage_provider_simulator', 'gsim_merchant_p4p_main', 'P4P Garage', ARRAY['USD'], 'p4p-op', 'owner', 'claimed role is not admin')$q$, g), 'PAY04_MERCHANT_AUTHORITY_REFUSED');
  v_acct := pay04_register_garage_merchant_account(g, 'pay04_garage_provider_simulator', 'gsim_merchant_p4p_main', 'P4P Garage (simulated)',
    ARRAY['usd'], 'p4p-op', 'admin', 'Level 1 simulation for the PAY-04 certification');
  PERFORM pg_temp.check(v_acct.status = 'simulated' AND v_acct.currencies = ARRAY['USD'], 'merchant registered as simulated USD');
  PERFORM pg_temp.expect(format($q$SELECT pay04_register_garage_merchant_account(%L, 'pay04_garage_provider_simulator', 'gsim_merchant_p4p_second', 'Second', ARRAY['USD'], 'p4p-op', 'admin', 'one live account per garage and gateway')$q$, g), 'PAY04_MERCHANT_ACCOUNT_EXISTS');
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_merchant_accounts SET merchant_reference = ''gsim_merchant_hijack'' WHERE id = %L', v_acct.id), 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE G PASS: runtime-guarded simulator only, platform-operator registration, CarUp Stripe refused, immutable merchant identity';

  inv := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 200);
  inv_zwg := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 50, 'ZWG');

  -- A: who may pay, in what, how much.
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-out', 10, 'USD', 'p4p-key-out-0001')$q$, inv.id), 'PAY04_PAYER_NOT_CUSTOMER');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-admin', 10, 'USD', 'p4p-key-adm-0001')$q$, inv.id), 'PAY04_PAYER_NOT_CUSTOMER');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 10, 'ZWG', 'p4p-key-cur-0001')$q$, inv.id), 'PAY04_CURRENCY_MISMATCH');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 10, 'ZWG', 'p4p-key-cur-0002')$q$, inv_zwg.id), 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 10.005, 'USD', 'p4p-key-prc-0001')$q$, inv.id), 'PAY04_AMOUNT_INVALID');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 200.01, 'USD', 'p4p-key-big-0001')$q$, inv.id), 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 10, 'USD', 'short')$q$, inv.id), 'PAY04_IDEMPOTENCY_KEY_INVALID');

  b := pay04_begin_garage_collection(inv.id, 'p4p-cust', 120, 'USD', 'p4p-key-main-0001');
  c1 := pg_temp.collection(b);
  SELECT * INTO v_pay FROM payment_transactions WHERE reference = b->>'payment_reference';
  PERFORM pg_temp.check(v_pay.reference ~ '^pay04_gar_' AND v_pay.gateway = 'pay04_garage_provider_simulator' AND v_pay.status = 'pending'
    AND v_pay.amount = 120 AND v_pay.currency = 'USD' AND v_pay.pay01a_actor_id = 'p4p-cust'
    AND v_pay.pay01a_account_id = 'gsim_merchant_p4p_main' AND v_pay.pay02_product_code = 'gar.invoice.customer_payment'
    AND v_pay.pay02_product_version = 1 AND v_pay.pay02_commercial_category = 'category_b_third_party'
    AND v_pay.pay02_funds_owner = 'garage_business_tenant' AND v_pay.pay02_legal_beneficiary = 'tenant:' || g::text
    AND v_pay.pay02_settlement_status = 'not_applicable_sandbox', 'canonical row is third-party garage money');
  v_res := pay04_begin_garage_collection(inv.id, 'p4p-cust', 120, 'USD', 'p4p-key-main-0001');
  PERFORM pg_temp.check((v_res->>'replayed')::boolean AND pg_temp.collection(v_res) = c1, 'same key replays the same collection');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 121, 'USD', 'p4p-key-main-0001')$q$, inv.id), 'PAY04_IDEMPOTENCY_CONFLICT');
  PERFORM pg_temp.check((SELECT count(*) FROM payment_transactions WHERE reference LIKE 'pay04_gar_%') = 1, 'one canonical row for the replayed key');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE A PASS: customer-only initiation, currency and precision, idempotent per payer key, canonical third-party row';

  -- R: 120 in flight is reserved.
  v_m := pg_temp.money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 120 AND v_m.uncommitted_balance = 80 AND v_m.paid_amount = 0 AND v_m.payment_status = 'unpaid', 'reservation');
  PERFORM pg_temp.expect(format($q$SELECT garage_ops07_record_payment(%L, %L, 100, 'USD', 'cash', NULL, now(), 'p4p-admin', 'p4p-cash-0001')$q$, g, inv.id), 'PAY04_PAYMENT_EXCEEDS_UNCOMMITTED_BALANCE');
  PERFORM garage_ops07_record_payment(g, inv.id, 80, 'USD', 'cash', 'till 1', now(), 'p4p-admin', 'p4p-cash-0002');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p4p-cust', 1, 'USD', 'p4p-key-more-0001')$q$, inv.id), 'PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE');
  inv_void := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 30);
  b2 := pay04_begin_garage_collection(inv_void.id, 'p4p-cust', 30, 'USD', 'p4p-key-void-0001');
  PERFORM pg_temp.expect(format($q$SELECT garage_ops07_void_invoice(%L, %L, 'customer changed their mind', 'p4p-admin')$q$, g, inv_void.id), 'PAY04_INVOICE_HAS_PAYMENT_IN_PROGRESS');
  PERFORM pay04_cancel_garage_collection(pg_temp.collection(b2), 'p4p-cust', 'Will pay at the counter');
  PERFORM garage_ops07_void_invoice(g, inv_void.id, 'customer changed their mind', 'p4p-admin');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE R PASS: in-flight money reserved against declared payments, new collections and void; cancel releases it';

  -- L: attach once, then the provider confirms.
  PERFORM pg_temp.expect(format($q$SELECT pay04_attach_garage_collection(%L, 'cs_test_123', 'pi_123')$q$, c1), 'PAY04_PROVIDER_REFERENCE_INVALID');
  PERFORM pg_temp.expect(format($q$SELECT pg_temp.snap(%L::uuid, 'paid', 'evt_gsim_early_0001')$q$, c1), 'PAY04_COLLECTION_NOT_ATTACHED');
  PERFORM pg_temp.attach(c1);
  PERFORM pg_temp.attach(c1);
  PERFORM pg_temp.expect(format($q$SELECT pay04_attach_garage_collection(%L, 'gsim_co_other', 'sim_pi_gar_other')$q$, c1), 'PAY04_PROVIDER_REFERENCE_CHANGE_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_apply_garage_provider_snapshot(%L, 'paid', 'pi_stripe_shape', NULL, NULL, NULL, 12000, 'USD', 'gsim_merchant_p4p_main', NULL, NULL, NULL, NULL, 'signed_webhook')$q$, c1), 'PAY04_PROVIDER_PAYMENT_BINDING_MISMATCH');

  SELECT count(*) INTO v_receipts_before FROM garage_receipts WHERE tenant_id = g;
  v_res := pg_temp.snap(c1, 'paid', 'evt_gsim_paid_0001');
  PERFORM pg_temp.check((v_res->>'applied')::boolean AND v_res->>'payment_status' = 'paid', 'provider paid applied');
  v_m := pg_temp.money(inv.id);
  PERFORM pg_temp.check(v_m.declared_paid = 80 AND v_m.provider_paid = 120 AND v_m.paid_amount = 200 AND v_m.balance_amount = 0
    AND v_m.provider_reserved = 0 AND v_m.payment_status = 'paid', 'invoice paid by declared 80 + provider 120');
  PERFORM pg_temp.check((SELECT payment_status FROM garage_ops07_invoice_balance(inv.id)) = 'paid'
    AND (SELECT paid_amount FROM garage_ops07_invoice_balance(inv.id)) = 200, 'OPS07 balance counts provider allocation');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued' AND amount = 120
    AND payment_source = 'provider_confirmed') = 1, 'one live provider receipt for the counted 120');
  SELECT last_number INTO v_counter FROM garage_document_counters WHERE tenant_id = g AND doc_type = 'receipt';
  PERFORM pg_temp.check((SELECT receipt_number FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued')
    = 'RCT-' || lpad(v_counter::text, 6, '0') AND v_counter = v_receipts_before + 1, 'provider receipt takes the next shared RCT number');

  -- replay: nothing moves
  v_res := pg_temp.snap(c1, 'paid', 'evt_gsim_paid_0001');
  PERFORM pg_temp.check((v_res->>'duplicate_event')::boolean, 'replayed event is a duplicate');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_payment_allocations WHERE collection_id = c1) = 1
    AND (SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1) = 1, 'replay changed nothing');
  -- a fresh readback of the same truth (no event id) is idempotent too
  PERFORM pay04_apply_garage_provider_snapshot(c1, 'paid', pg_temp.pid(c1), NULL, NULL, NULL, 12000, 'USD', 'gsim_merchant_p4p_main', NULL, NULL, NULL, NULL, 'provider_readback');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_payment_allocations WHERE collection_id = c1) = 1, 'readback idempotent');

  -- garage refund (only the garage admin), refund_pending deallocates and voids the receipt, provider confirms the refund
  PERFORM pg_temp.expect(format($q$SELECT pay04_request_garage_collection_refund(%L, 'p4p-cust', 'I would like my money back')$q$, c1), 'GARAGE_OPS03_ADMIN_REQUIRED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_request_garage_collection_refund(%L, 'p4q-admin', 'Another garage cannot refund')$q$, c1), 'GARAGE_OPS03_ADMIN_REQUIRED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_request_garage_collection_refund(%L, 'p4p-admin', 'short')$q$, c1), 'PAY04_REASON_REQUIRED');
  v_res := pay04_request_garage_collection_refund(c1, 'p4p-admin', 'Customer was charged twice for the same job');
  PERFORM pg_temp.check(v_res->>'payment_status' = 'refund_pending', 'refund pending');
  v_m := pg_temp.money(inv.id);
  PERFORM pg_temp.check(v_m.provider_paid = 0 AND v_m.provider_reserved = 120 AND v_m.uncommitted_balance = 0
    AND v_m.payment_status = 'partially_paid', 'refund in progress deallocates and stays reserved');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued') = 0, 'receipt voided on refund');
  v_res := pay04_request_garage_collection_refund(c1, 'p4p-admin', 'Customer was charged twice for the same job');
  PERFORM pg_temp.check((v_res->>'replayed')::boolean, 'refund request replay');
  PERFORM pg_temp.snap(c1, 'refunded', 'evt_gsim_refunded_0001', 'sim_re_gar_' || replace(c1::text, '-', ''));
  PERFORM pg_temp.check(pg_temp.status(c1) = 'refunded', 'provider confirmed the refund');
  v_m := pg_temp.money(inv.id);
  PERFORM pg_temp.check(v_m.provider_paid = 0 AND v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 120 AND v_m.payment_status = 'partially_paid', 'refunded money releases the reservation');
  PERFORM pg_temp.expect(format($q$SELECT pg_temp.snap(%L::uuid, 'paid', 'evt_gsim_regress_0001')$q$, c1), 'PAY01A_STATUS_REGRESSION_REFUSED');
  PERFORM pg_temp.check((SELECT count(*) FROM garage_stock_movements) = v_moves, 'provider flows moved no stock');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE L PASS: attach once, confirmed money allocated with the next shared receipt number, replay-safe, garage refund lifecycle';
END $$;

-- ═══════════════════════════ H: F5 hold, operator resolution, separation of duties ═══════════════════════════
DO $$
DECLARE
  g uuid; inv1 garage_invoices%ROWTYPE; inv2 garage_invoices%ROWTYPE; c1 uuid; c2 uuid; v_res jsonb; v_m record;
  v_exc pay03b_payment_reconciliation_exceptions%ROWTYPE; v_ref text;
BEGIN
  SELECT id INTO g FROM tenants WHERE name = 'p4p Garage';
  INSERT INTO users (id, name, email, role, join_date) VALUES ('p4p-op-member', 'p4p-op-member', 'p4p-op-member@example.invalid', 'admin', '2026-01-01');
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (g, 'p4p-op-member', 'member');

  -- H1: provider reports a PARTIAL refund (against the full-refund-only policy) -> F5 hold, fail closed.
  inv1 := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 120);
  c1 := pg_temp.collection(pay04_begin_garage_collection(inv1.id, 'p4p-cust', 120, 'USD', 'p4p-key-hold-0001'));
  PERFORM pg_temp.attach(c1);
  PERFORM pg_temp.snap(c1, 'paid', 'evt_gsim_hold_paid_0001');
  v_res := pg_temp.snap(c1, 'reconciliation_hold', 'evt_gsim_hold_0001', NULL, 3000, 0, ARRAY['sim_re_gar_partial_0001'], 'partial_refund_succeeded');
  PERFORM pg_temp.check(v_res->>'payment_status' = 'reconciliation_hold' AND v_res->>'reconciliation_exception_event' = 'opened', 'hold opened via F5');
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c1;
  SELECT * INTO v_exc FROM pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref AND status = 'open';
  PERFORM pg_temp.check(v_exc.gateway = 'pay04_garage_provider_simulator' AND v_exc.provider_account_id = 'gsim_merchant_p4p_main'
    AND v_exc.detected_refunded_minor = 3000 AND v_exc.payment_amount_minor = 12000, 'F5 exception carries the garage merchant evidence');
  v_m := pg_temp.money(inv1.id);
  PERFORM pg_temp.check(v_m.provider_paid = 0 AND v_m.provider_reserved = 120 AND v_m.payment_status = 'unpaid', 'held money is not counted and stays reserved');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued') = 0, 'held receipt voided');
  PERFORM pg_temp.expect(format('UPDATE payment_transactions SET status = ''paid'' WHERE reference = %L', v_ref), 'PAY03B_HOLD_RELEASE_REQUIRES_GOVERNED_PATH');
  -- a later provider 'paid' observation never lifts a hold (sticky)
  v_res := pg_temp.snap(c1, 'paid', 'evt_gsim_hold_paid_0002');
  PERFORM pg_temp.check(v_res->>'payment_status' = 'reconciliation_hold' AND (v_res->>'hold_retained')::boolean, 'hold is sticky');

  -- H2: separation of duties — garage admins are not platform operators; a platform operator who is a garage member is conflicted.
  PERFORM pg_temp.expect(format($q$SELECT pay03b_resolve_payment_reconciliation_exception(%L, 'revoke_access_partial_refund_final', 'p4p-admin', 'admin', 'Garage keeps the remaining 90 USD', 'reconciliation_hold', 3000, 0, ARRAY['sim_re_gar_partial_0001'], clock_timestamp())$q$, v_exc.id), 'PAY03B_RESOLUTION_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay03b_resolve_payment_reconciliation_exception(%L, 'revoke_access_partial_refund_final', 'p4p-op-member', 'admin', 'Garage keeps the remaining 90 USD', 'reconciliation_hold', 3000, 0, ARRAY['sim_re_gar_partial_0001'], clock_timestamp())$q$, v_exc.id), 'PAY03B_RESOLUTION_SELF_DEALING_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay03b_resolve_payment_reconciliation_exception(%L, 'revoke_access_partial_refund_final', 'p4p-cust', 'admin', 'Payer cannot resolve their own payment', 'reconciliation_hold', 3000, 0, ARRAY['sim_re_gar_partial_0001'], clock_timestamp())$q$, v_exc.id), 'PAY03B_RESOLUTION_AUTHORITY_REFUSED');

  -- H3: the operator confirms the partial refund is final -> partially_refunded; the remaining 90 counts, with a new receipt.
  v_res := pay03b_resolve_payment_reconciliation_exception(v_exc.id, 'revoke_access_partial_refund_final', 'p4p-op', 'admin',
    'Garage refunded 30 USD directly at the provider; the remaining 90 USD stands', 'reconciliation_hold', 3000, 0,
    ARRAY['sim_re_gar_partial_0001'], clock_timestamp());
  PERFORM pg_temp.check(v_res->>'payment_status' = 'partially_refunded' AND (v_res->'sync'->>'allocated')::numeric = 90, 'F5 resolution re-projected the garage allocation');
  v_m := pg_temp.money(inv1.id);
  PERFORM pg_temp.check(v_m.provider_paid = 90 AND v_m.provider_reserved = 0 AND v_m.balance_amount = 30 AND v_m.payment_status = 'partially_paid', 'remainder counts');
  PERFORM pg_temp.check((SELECT amount FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued') = 90
    AND (SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1) = 2, 'new live receipt for the remaining 90; the first stays voided');

  -- H4: another hold that the operator restores (the provider shows no refund after all) -> full allocation again.
  inv2 := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 60);
  c2 := pg_temp.collection(pay04_begin_garage_collection(inv2.id, 'p4p-cust', 60, 'USD', 'p4p-key-hold-0002'));
  PERFORM pg_temp.attach(c2);
  PERFORM pg_temp.snap(c2, 'paid', 'evt_gsim_hold2_paid_0001');
  PERFORM pg_temp.snap(c2, 'reconciliation_hold', 'evt_gsim_hold2_0001', NULL, 0, 1000, ARRAY['sim_re_gar_pending_0001'], 'partial_refund_pending');
  SELECT * INTO v_exc FROM pay03b_payment_reconciliation_exceptions
   WHERE payment_reference = (SELECT payment_reference FROM pay04_garage_collections WHERE id = c2) AND status = 'open';
  v_res := pay03b_resolve_payment_reconciliation_exception(v_exc.id, 'restore_access_provider_unrefunded', 'p4p-op', 'admin',
    'The pending partial refund was cancelled at the provider', 'paid', 0, 0, ARRAY[]::text[], clock_timestamp());
  PERFORM pg_temp.check(v_res->>'payment_status' = 'paid' AND (SELECT provider_paid FROM pay04_invoice_money(inv2.id)) = 60
    AND (SELECT payment_status FROM pay04_invoice_money(inv2.id)) = 'paid', 'restore re-allocates the full amount');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE H PASS: F5 partial-refund hold reused, sticky, governed release only, operator final/restore re-project the garage invoice, garage members conflicted';
END $$;

-- ═══════════════════════════ D: discrepancies ═══════════════════════════
DO $$
DECLARE
  g uuid; inv garage_invoices%ROWTYPE; inv_late garage_invoices%ROWTYPE; c uuid; c_late uuid; v_res jsonb; v_m record; v_d uuid;
BEGIN
  SELECT id INTO g FROM tenants WHERE name = 'p4p Garage';
  inv := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 75);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p4p-cust', 75, 'USD', 'p4p-key-disc-0001'));
  PERFORM pg_temp.attach(c);

  -- evidence from another merchant, in another currency or for another amount is recorded and never applied
  v_res := pg_temp.snap(c, 'paid', 'evt_gsim_disc_m_0001', p_merchant => 'gsim_merchant_someone_else');
  PERFORM pg_temp.check(NOT (v_res->>'applied')::boolean AND v_res->>'refused' = 'merchant_mismatch' AND pg_temp.status(c) = 'pending', 'merchant mismatch refused');
  v_res := pg_temp.snap(c, 'paid', 'evt_gsim_disc_c_0001', p_currency => 'ZWG');
  PERFORM pg_temp.check(v_res->>'refused' = 'currency_mismatch' AND pg_temp.status(c) = 'pending', 'currency mismatch refused');
  v_res := pg_temp.snap(c, 'paid', 'evt_gsim_disc_a_0001', p_amount_minor => 7400);
  PERFORM pg_temp.check(v_res->>'refused' = 'amount_mismatch' AND pg_temp.status(c) = 'pending', 'amount mismatch refused');
  v_res := pg_temp.snap(c, 'paid', 'evt_gsim_disc_a_0002', p_amount_minor => 7400);
  PERFORM pg_temp.check((SELECT observation_count FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'amount_mismatch' AND status = 'open') = 2, 'repeat observation counted, one open record');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND status = 'open') = 3, 'three open discrepancies');
  -- an open mismatch keeps the money reserved even after the checkout would have expired
  PERFORM pg_temp.check((SELECT provider_reserved FROM pay04_invoice_money(inv.id)) = 75, 'mismatch keeps the reservation');
  SELECT id INTO v_d FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'amount_mismatch';
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_payment_discrepancies SET detected_amount = 75 WHERE id = %L', v_d), 'PAY04_DISCREPANCY_EVIDENCE_IMMUTABLE');
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'provider_corrected', 'p4p-admin', 'admin', 'Garage says it is fine')$q$, v_d), 'PAY04_RESOLUTION_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'provider_corrected', 'p4p-op-member', 'admin', 'Conflicted operator')$q$, v_d), 'PAY04_RESOLUTION_SELF_DEALING_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'settled_off_platform', 'p4p-op', 'admin', 'Not applicable to a mismatch')$q$, v_d), 'PAY04_RESOLUTION_INVALID');
  PERFORM pay04_resolve_garage_payment_discrepancy(v_d, 'provider_corrected', 'p4p-op', 'admin', 'Provider support confirmed the 74.00 event was a test artefact');
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'provider_corrected', 'p4p-op', 'admin', 'Second closure attempt')$q$, v_d), 'PAY04_DISCREPANCY_NOT_OPEN');
  -- the correct evidence then applies normally
  v_res := pg_temp.snap(c, 'paid', 'evt_gsim_disc_ok_0001');
  PERFORM pg_temp.check((v_res->>'applied')::boolean AND (SELECT provider_paid FROM pay04_invoice_money(inv.id)) = 75, 'correct evidence applies');

  -- late money: the customer's checkout is cancelled, the garage records cash for the whole invoice, then the provider
  -- confirms the old checkout. Truth: the money arrived (paid) but the invoice cannot absorb it -> unallocated + open.
  inv_late := pg_temp.invoice(g, 'p4p', 'PAY04PROVVIN000001', 'p4p-cust', 40);
  c_late := pg_temp.collection(pay04_begin_garage_collection(inv_late.id, 'p4p-cust', 40, 'USD', 'p4p-key-late-0001'));
  PERFORM pg_temp.attach(c_late);
  PERFORM pay04_cancel_garage_collection(c_late, 'p4p-admin', 'Customer paid cash at the counter');
  PERFORM garage_ops07_record_payment(g, inv_late.id, 40, 'USD', 'cash', 'till 2', now(), 'p4p-admin', 'p4p-cash-late-0001');
  v_res := pg_temp.snap(c_late, 'paid', 'evt_gsim_late_0001');
  PERFORM pg_temp.check(pg_temp.status(c_late) = 'paid' AND (v_res->'projection'->>'allocated')::numeric = 0
    AND (v_res->'projection'->>'unallocated')::numeric = 40, 'late money is recorded, not counted');
  v_m := pg_temp.money(inv_late.id);
  PERFORM pg_temp.check(v_m.paid_amount = 40 AND v_m.declared_paid = 40 AND v_m.provider_paid = 0 AND v_m.payment_status = 'paid', 'no overpayment counted');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_payment_discrepancies WHERE collection_id = c_late AND discrepancy_type = 'unallocated_provider_money' AND status = 'open' AND detected_amount = 40) = 1, 'unallocated discrepancy open');
  PERFORM pg_temp.expect(format($q$SELECT garage_ops07_void_invoice(%L, %L, 'trying to hide the late money', 'p4p-admin')$q$, g, inv_late.id), 'GARAGE_OPS07_INVOICE_HAS_PAYMENTS|PAY04_INVOICE_HAS_PROVIDER_PAYMENTS');
  -- the garage refunds the late payment; the provider confirms; the discrepancy closes itself with provider evidence
  PERFORM pay04_request_garage_collection_refund(c_late, 'p4p-admin', 'Customer already paid this invoice in cash');
  PERFORM pg_temp.snap(c_late, 'refunded', 'evt_gsim_late_refund_0001', 'sim_re_gar_late_0001');
  PERFORM pg_temp.check((SELECT resolution FROM pay04_garage_payment_discrepancies WHERE collection_id = c_late AND discrepancy_type = 'unallocated_provider_money') = 'refunded_to_customer', 'provider refund closes the unallocated discrepancy');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE D PASS: merchant/currency/amount mismatches recorded never applied, operator closure governed, late money unallocated until refunded';
END $$;

-- ═══════════════════════════ I: invariants and least privilege ═══════════════════════════
DO $$
DECLARE g uuid; v_alloc pay04_garage_payment_allocations%ROWTYPE; v_receipt pay04_garage_provider_receipts%ROWTYPE; v_t text; v_f text;
BEGIN
  SELECT id INTO g FROM tenants WHERE name = 'p4p Garage';
  SELECT * INTO v_alloc FROM pay04_garage_payment_allocations WHERE tenant_id = g ORDER BY seq LIMIT 1;
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_payment_allocations SET amount = 1 WHERE id = %L', v_alloc.id), 'PAY04_APPEND_ONLY');
  PERFORM pg_temp.expect(format('DELETE FROM pay04_garage_payment_allocations WHERE id = %L', v_alloc.id), 'PAY04_APPEND_ONLY');
  PERFORM pg_temp.expect(format('DELETE FROM pay04_garage_collection_events WHERE tenant_id = %L', g), 'PAY04_APPEND_ONLY');
  PERFORM pg_temp.expect(format('DELETE FROM pay04_provider_event_receipts WHERE gateway = %L', 'pay04_garage_provider_simulator'), 'PAY04_APPEND_ONLY');
  -- even a direct writer (table owner) cannot over-allocate or allocate outside the governed writer
  PERFORM pg_temp.expect(format($q$INSERT INTO pay04_garage_payment_allocations (tenant_id, invoice_id, collection_id, kind, amount, currency, cause) VALUES (%L, %L, %L, 'allocation', 1, 'USD', 'manual_attempt')$q$, v_alloc.tenant_id, v_alloc.invoice_id, v_alloc.collection_id), 'PAY04_ALLOCATION_REQUIRES_GOVERNED_WRITER');
  PERFORM set_config('carup.pay04_writer', 'on', true);
  PERFORM pg_temp.expect(format($q$INSERT INTO pay04_garage_payment_allocations (tenant_id, invoice_id, collection_id, kind, amount, currency, cause) VALUES (%L, %L, %L, 'allocation', 999, 'USD', 'manual_attempt')$q$, v_alloc.tenant_id, v_alloc.invoice_id, v_alloc.collection_id), 'PAY04_ALLOCATION_OUT_OF_RANGE|PAY04_OVER_ALLOCATION_REFUSED');
  PERFORM set_config('carup.pay04_writer', '', true);
  SELECT * INTO v_receipt FROM pay04_garage_provider_receipts WHERE tenant_id = g AND status = 'issued' LIMIT 1;
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_provider_receipts SET amount = amount + 1 WHERE id = %L', v_receipt.id), 'PAY04_RECEIPT_IMMUTABLE');
  PERFORM pg_temp.expect(format('DELETE FROM pay04_garage_provider_receipts WHERE id = %L', v_receipt.id), 'PAY04_RECEIPTS_ARE_NEVER_DELETED');
  -- extending a checkout would extend its reservation; re-pointing it would move money between payers
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_collections SET expires_at = expires_at + interval ''1 day'' WHERE tenant_id = %L', g), 'PAY04_COLLECTION_IMMUTABLE');
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_collections SET payer_user_id = ''p4p-out'' WHERE tenant_id = %L', g), 'PAY04_COLLECTION_IMMUTABLE');
  PERFORM pg_temp.expect(format('DELETE FROM pay04_garage_collections WHERE tenant_id = %L', g), 'PAY04_COLLECTION_IMMUTABLE');
  PERFORM pg_temp.expect(format('UPDATE garage_payment_records SET source = ''provider_confirmed'' WHERE tenant_id = %L', g), 'GARAGE_OPS07_APPEND_ONLY');

  -- every live receipt equals its collection's counted amount; receipt numbers are unique across both receipt tables
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay04_garage_provider_receipts r WHERE r.status = 'issued'
    AND r.amount <> pay04_collection_allocated(r.collection_id)), 'live receipts equal counted money');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay04_garage_payment_allocations a GROUP BY a.collection_id
    HAVING sum(CASE WHEN a.kind = 'allocation' THEN a.amount ELSE -a.amount END) < 0), 'no negative allocation');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM garage_invoices i CROSS JOIN LATERAL garage_ops07_invoice_balance(i.id) b
    WHERE b.paid_amount > i.total_amount), 'no invoice counts more than its total');
  PERFORM pg_temp.check(NOT EXISTS (SELECT receipt_number FROM garage_receipts WHERE tenant_id = g
    INTERSECT SELECT receipt_number FROM pay04_garage_provider_receipts WHERE tenant_id = g), 'receipt numbers unique across both kinds');
  PERFORM pg_temp.check((SELECT count(*) FROM garage_payment_records WHERE source <> 'garage_recorded_external') = 0, 'OPS07 source vocabulary untouched');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM payment_transactions WHERE reference LIKE 'pay04_gar_%'
    AND (gateway <> 'pay04_garage_provider_simulator' OR pay02_funds_owner <> 'garage_business_tenant' OR pay02_legal_beneficiary NOT LIKE 'tenant:%')), 'garage money never CarUp money');

  -- least privilege
  FOREACH v_t IN ARRAY ARRAY['pay04_runtime_guard','pay04_garage_merchant_accounts','pay04_garage_collections','pay04_garage_payment_allocations',
      'pay04_garage_provider_receipts','pay04_garage_collection_events','pay04_provider_event_receipts','pay04_garage_payment_discrepancies'] LOOP
    PERFORM pg_temp.check(NOT has_table_privilege('anon', v_t, 'SELECT') AND NOT has_table_privilege('authenticated', v_t, 'SELECT')
      AND has_table_privilege('service_role', v_t, 'SELECT') AND NOT has_table_privilege('service_role', v_t, 'INSERT')
      AND NOT has_table_privilege('service_role', v_t, 'UPDATE') AND NOT has_table_privilege('service_role', v_t, 'DELETE')
      AND (SELECT relrowsecurity FROM pg_class WHERE relname = v_t), 'privileges on ' || v_t);
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['pay04_begin_garage_collection(uuid,text,numeric,text,text,integer)', 'pay04_attach_garage_collection(uuid,text,text)',
      'pay04_apply_garage_provider_snapshot(uuid,text,text,text,text,text,bigint,text,text,bigint,bigint,text[],text,text)',
      'pay04_request_garage_collection_refund(uuid,text,text)', 'pay04_cancel_garage_collection(uuid,text,text)',
      'pay04_resolve_garage_payment_discrepancy(uuid,text,text,text,text)', 'pay04_invoice_money(uuid)',
      'pay04_register_garage_merchant_account(uuid,text,text,text,text[],text,text,text)', 'pay04_suspend_garage_merchant_account(uuid,text,text,text)'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege('anon', v_f, 'EXECUTE') AND NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
      AND has_function_privilege('service_role', v_f, 'EXECUTE'), 'execute on ' || v_f);
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['pay04_reproject_garage_collection(uuid,text,text)', 'pay04_collection_allocated(uuid)',
      'pay04_record_discrepancy(pay04_garage_collections,text,numeric,jsonb,text,text)', 'pay04_log(pay04_garage_collections,text,text,jsonb)'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege('service_role', v_f, 'EXECUTE') AND NOT has_function_privilege('authenticated', v_f, 'EXECUTE'), 'internal ' || v_f);
  END LOOP;
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE I PASS: append-only ledger and history, governed-writer-only allocation, receipts = counted money, shared numbering, least privilege';
END $$;

-- ═══════════════════════════ N: notification identity (its own trigger, never the shared function) ═══════════════════════════
DO $$
DECLARE v_key text := 'pay04-smoke-collection:pay04-smoke-recipient';
BEGIN
  INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.confirmed', jsonb_build_object('notificationKey', v_key));
  PERFORM pg_temp.check((SELECT dedupe_key FROM domain_events WHERE event_type = 'garage.payment.confirmed' AND payload->>'notificationKey' = v_key)
    = 'garage.payment.confirmed:' || v_key, 'confirmed event keyed by its own trigger');
  PERFORM pg_temp.expect(format($q$INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.confirmed', jsonb_build_object('notificationKey', %L))$q$, v_key), 'duplicate key|unique');
  INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.refunded', jsonb_build_object('notificationKey', v_key));
  -- the shared function still keys the OPS07 event, untouched by PAY-04
  INSERT INTO domain_events (event_type, payload) VALUES ('garage.payment.recorded', jsonb_build_object('notificationKey', v_key));
  PERFORM pg_temp.check((SELECT dedupe_key FROM domain_events WHERE event_type = 'garage.payment.recorded' AND payload->>'notificationKey' = v_key)
    = 'garage.payment.recorded:' || v_key, 'OPS07 event keyed by the shared function');
  RAISE NOTICE 'PAY04_PROVIDER_SMOKE N PASS: confirmed/refunded notifications are once-only by their own trigger; the shared function is untouched';
END $$;

UPDATE pay04_runtime_guard SET garage_simulator_enabled = false, note = 'disposable PAY-04 certification finished', updated_at = clock_timestamp();
DO $$ BEGIN
  RAISE NOTICE 'PAY04_GARAGE_PROVIDER_PAYMENTS_POSTGRES_SMOKE_PASS: third-party garage money on the canonical ledger, F5 reused, reservations, discrepancies, invariants';
END $$;
