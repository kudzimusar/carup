-- CARUP-PAY-05-R1 — financial integrity of Paynow money on real PostgreSQL (migration 20261104100000).
--
-- Each block is one independent scenario on its own garage, so a run with ON_ERROR_STOP off reports every failure.
--   A  money counts only while Paynow's own latest word is a matching Paid; no closure re-counts; receipts follow
--   B  after a settlement outside CarUp only repeats of the settled evidence are recorded-only; new money opens a review
--   D  disputes: always a dispute whatever the amount; every dispute has an exit; a close after money is a review
--   F  a Paynow Refunded applies in full; Paynow's figure is evidence; one refund review per collection
--   G  read order: a word that moves the payment forward is never superseded by ticket order
--   I  lost replies, late money and the invoice's room
--   K  onboarding: an integration ID is reserved only with a proved key; generic refusal; cool-down; previous owner
--   L  currency authority: only a reviewed merchant+currency configuration can bind USD or ZWG; fail closed
--   N  status-update identity columns, read budget and least privilege
DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY05_R1_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ p_pattern THEN
      RAISE EXCEPTION 'PAY05_R1_WRONG_ERROR: expected % got % (sql: %)', p_pattern, SQLERRM, left(p_sql, 220);
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY05_R1_EXPECTED_FAILURE: % (sql: %)', p_pattern, left(p_sql, 220);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PAY05_R1_CHECK_FAILED: %', p_what; END IF;
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

CREATE OR REPLACE FUNCTION pg_temp.invoice(p_tenant uuid, p_prefix text, p_amount numeric, p_currency text DEFAULT 'USD')
RETURNS garage_invoices LANGUAGE plpgsql AS $$
DECLARE v_branch uuid; v_case uuid; v_wo uuid; v_rec uuid; v_inv garage_invoices%ROWTYPE;
BEGIN
  SELECT id INTO v_branch FROM garage_branches WHERE tenant_id = p_tenant LIMIT 1;
  INSERT INTO service_cases (vin, garage_tenant_id, branch_id, requester_user_id, status)
    VALUES ('PAY05R1PAYNOWVIN01', p_tenant, v_branch, 'r1-cust', 'accepted') RETURNING id INTO v_case;
  INSERT INTO mechanic_work_orders (tenant_id, vin, customer_id, service_case_id, branch_id, status, owner_authorization)
    VALUES (p_tenant, 'PAY05R1PAYNOWVIN01', 'r1-cust', v_case, v_branch, 'In Progress', 'pending') RETURNING id INTO v_wo;
  PERFORM mechanic_work_order_decide_authorization(v_wo, 'PAY05R1PAYNOWVIN01', 'r1-cust', 'owner', NULL, 'owner', 'authorized', NULL);
  INSERT INTO work_order_assignments (work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
    VALUES (v_wo, p_tenant, p_prefix || '-mech', p_prefix || '-admin');
  UPDATE service_cases SET status = 'active' WHERE id = v_case;
  INSERT INTO service_records (work_order_id, service_case_id, tenant_id, vin, work_performed, service_authority, total_cost, currency, recorded_by_user_id, performed_at)
    VALUES (v_wo, v_case, p_tenant, 'PAY05R1PAYNOWVIN01', 'Service', 'garage_stated', p_amount, p_currency, p_prefix || '-mech', now()) RETURNING id INTO v_rec;
  PERFORM garage_ops05_complete_job(p_tenant, v_case, p_prefix || '-admin');
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(p_tenant, v_wo, p_currency,
    jsonb_build_array(jsonb_build_object('category','labour','description','Workshop service','quantity',1,'unit_price',p_amount,
                                         'source_kind','service_record','source_id',v_rec)), NULL, NULL, NULL, p_prefix || '-admin');
  RETURN v_inv;
END $$;

-- A sealed-key fixture: only the SHAPE the backend's AES-256-GCM seal produces, plus the probe the backend ran at connect.
CREATE OR REPLACE FUNCTION pg_temp.integration(p_currency text, p_id text, p_methods text[], p_mode text DEFAULT 'simulator')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('currency', p_currency, 'integration_id', p_id, 'mode', p_mode, 'methods', to_jsonb(p_methods),
    'ciphertext', 'U0VBTEVELUtFWS1GSVhUVVJFLU5PVC1BLUtFWQ==', 'iv', 'AAECAwQFBgcICQoL', 'tag', 'AAECAwQFBgcICQoLDA0ODw==',
    'key_version', 1, 'fingerprint', lpad(p_id, 16, '0'),
    'probe', jsonb_build_object('result', 'authenticated', 'credential_fingerprint', lpad(p_id, 16, '0')));
$$;
CREATE OR REPLACE FUNCTION pg_temp.profile(p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('legal_entity_name', p_name, 'registration_number', '1234/2026', 'settlement_bank_name', 'CBZ Bank',
    'settlement_account_last4', '4321', 'settlement_account_holder', p_name,
    'attestation', 'I confirm this Paynow merchant account and its settlement account belong to this garage business.');
$$;
CREATE OR REPLACE FUNCTION pg_temp.register(p_tenant uuid, p_prefix text, p_integrations jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT ((pay05_register_paynow_merchant(p_tenant, gen_random_uuid(), p_prefix || '-admin', upper(p_prefix) || ' Garage',
    pg_temp.profile(upper(p_prefix) || ' Motors (Pvt) Ltd'), p_integrations))->'merchant'->>'id')::uuid;
$$;
-- The evidence an operator gives: complete, with each integration's probe and its own reviewed settlement currency.
CREATE OR REPLACE FUNCTION pg_temp.evidence(p_acct uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('legal_identity_reviewed', true, 'settlement_account_reviewed', true, 'currency_configuration_reviewed', true,
    'credential_probes', (SELECT jsonb_object_agg(id::text, jsonb_build_object('result', 'authenticated', 'credential_fingerprint', credential_fingerprint, 'probed_at', now()))
                            FROM pay05_merchant_integrations WHERE merchant_account_id = p_acct),
    'currency_evidence', (SELECT jsonb_object_agg(id::text, jsonb_build_object('settlement_currency', currency, 'reference', 'Simulated Paynow merchant settlement page reviewed'))
                            FROM pay05_merchant_integrations WHERE merchant_account_id = p_acct));
$$;
CREATE OR REPLACE FUNCTION pg_temp.merchant(p_tenant uuid, p_prefix text, p_usd_id text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_acct uuid;
BEGIN
  v_acct := pg_temp.register(p_tenant, p_prefix, jsonb_build_array(pg_temp.integration('USD', p_usd_id, ARRAY['web', 'ecocash', 'innbucks', 'omari'])));
  PERFORM pay05_verify_paynow_merchant(v_acct, 'r1-op', 'admin', pg_temp.evidence(v_acct), 'Reviewed the simulated merchant.');
  RETURN v_acct;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.start(p_invoice uuid, p_amount numeric, p_key text, p_ttl int DEFAULT 1800) RETURNS uuid LANGUAGE sql AS $$
  SELECT (pay04_begin_garage_collection(p_invoice, 'r1-cust', p_amount, 'USD', p_key, p_ttl)->'collection'->>'id')::uuid;
$$;
CREATE OR REPLACE FUNCTION pg_temp.trace(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT left(replace(p_collection::text, '-', ''), 32);
$$;
CREATE OR REPLACE FUNCTION pg_temp.poll(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT 'http://127.0.0.1:5061/Interface/CheckPayment/?guid=' || p_collection::text;
$$;
CREATE OR REPLACE FUNCTION pg_temp.pid(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT 'pn_poll_' || left(encode(sha256(convert_to(pg_temp.poll(p_collection), 'UTF8')), 'hex'), 40);
$$;
CREATE OR REPLACE FUNCTION pg_temp.send_attach(p_collection uuid, p_method text DEFAULT 'ecocash') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pay05_record_paynow_sending(p_collection, pg_temp.trace(p_collection), p_method, NULL);
  PERFORM pay05_attach_paynow_collection(p_collection, pg_temp.trace(p_collection), pg_temp.poll(p_collection), pg_temp.pid(p_collection),
    jsonb_build_object('paynow_reference', '9510'));
END $$;
-- An authenticated Paynow read of a collection: its own reference and, by default, its own amount.
CREATE OR REPLACE FUNCTION pg_temp.read(p_collection uuid, p_status text, p_amount_minor bigint DEFAULT NULL, p_ticket bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pay05_apply_paynow_observation(c.id, 'poll', NULL, p_status, initcap(replace(p_status, '_', ' ')),
    coalesce(p_amount_minor, c.amount_minor), c.payment_reference, '9510', pg_temp.pid(c.id), NULL, p_ticket)
  FROM pay04_garage_collections c WHERE c.id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.resolve(p_collection uuid, p_type text, p_resolution text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pay04_resolve_garage_payment_discrepancy(
    (SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = p_collection AND discrepancy_type = p_type AND status = 'open'),
    p_resolution, 'r1-op', 'admin', 'The operator reviewed the Paynow merchant records for this payment.');
$$;
CREATE OR REPLACE FUNCTION pg_temp.resolve_sql(p_collection uuid, p_type text, p_resolution text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, %L, 'r1-op', 'admin', 'The operator reviewed the Paynow merchant records for this payment.')$q$,
    (SELECT id FROM pay04_garage_payment_discrepancies WHERE collection_id = p_collection AND discrepancy_type = p_type AND status = 'open'), p_resolution);
$$;
CREATE OR REPLACE FUNCTION pg_temp.cash(p_tenant uuid, p_invoice uuid, p_amount numeric, p_prefix text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM garage_ops07_record_payment(p_tenant, p_invoice, p_amount, 'USD', 'cash', upper(p_prefix) || '-CASH', now(), p_prefix || '-admin', p_prefix || '-cash-key-1');
END $$;
CREATE OR REPLACE FUNCTION pg_temp.status(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT p.status FROM pay04_garage_collections c JOIN payment_transactions p ON p.reference = c.payment_reference WHERE c.id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.counted(p_collection uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT pay04_collection_allocated(p_collection);
$$;
CREATE OR REPLACE FUNCTION pg_temp.live_receipts(p_collection uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = p_collection AND status = 'issued';
$$;
CREATE OR REPLACE FUNCTION pg_temp.all_receipts(p_collection uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.allocations(p_collection uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM pay04_garage_payment_allocations WHERE collection_id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.open_disc(p_collection uuid, p_type text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pay04_garage_payment_discrepancies WHERE collection_id = p_collection AND discrepancy_type = p_type AND status = 'open');
$$;
CREATE OR REPLACE FUNCTION pg_temp.disc_count(p_collection uuid, p_type text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM pay04_garage_payment_discrepancies WHERE collection_id = p_collection AND discrepancy_type = p_type;
$$;
CREATE OR REPLACE FUNCTION pg_temp.last_outcome(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT outcome FROM pay05_paynow_observations WHERE collection_id = p_collection ORDER BY seq DESC LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION pg_temp.expired(p_collection uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE pay04_garage_collections SET initiated_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute' WHERE id = p_collection;
  SET LOCAL session_replication_role = origin;
END $$;

DO $$
BEGIN
  INSERT INTO users (id, name, email, role, join_date) VALUES
    ('r1-cust', 'r1-cust', 'r1-cust@example.invalid', 'owner', '2026-01-01'),
    ('r1-op', 'r1-op', 'r1-op@example.invalid', 'admin', '2026-01-01')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id)
    VALUES ('PAY05R1PAYNOWVIN01', 'Toyota', 'Hilux', 2020, 60000, 1000, 'r1-cust') ON CONFLICT (vin) DO NOTHING;
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = true, paynow_available = true WHERE singleton;
END $$;

-- ═══════════════════════════ A. what counts ═══════════════════════════

-- A1 (ICR-M1): a post-Paid reversal settled outside CarUp stays uncounted, receipts stay voided, cash can be recorded, and
-- Paynow's later Refunded still acts on the canonical row.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1a1');
  PERFORM pg_temp.merchant(g, 'r1a1', '51001');
  inv := pg_temp.invoice(g, 'r1a1', 50.00);
  c := pg_temp.start(inv.id, 50.00, 'r1a1-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.counted(c) = 50 AND pg_temp.live_receipts(c) = 1, 'A1 Paid counts with one receipt');
  PERFORM pg_temp.read(c, 'unrecognized');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0 AND pg_temp.open_disc(c, 'provider_status_unrecognized'), 'A1 the reversal de-counts and opens a review');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'settled_off_platform');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'A1 a settlement never re-counts money Paynow reversed');
  PERFORM pg_temp.check(pg_temp.live_receipts(c) = 0 AND pg_temp.all_receipts(c) = 1, 'A1 no receipt is issued for money that does not count');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_paid = 0 AND v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 50, 'A1 the room is free');
  PERFORM pg_temp.cash(g, inv.id, 50.00, 'r1a1');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.declared_paid = 50 AND v_m.paid_amount = 50 AND v_m.payment_status = 'paid', 'A1 the cash the garage really received can be recorded');
  v_res := pg_temp.read(c, 'refunded');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.status(c) = 'refunded' AND pg_temp.counted(c) = 0, 'A1 a later Refunded still acts on the canonical row');
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_refund_unquantified'), 'A1 the refund asks an operator to confirm');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.paid_amount = 50 AND v_m.provider_paid = 0, 'A1 the refund does not touch the cash');
  RAISE NOTICE 'PAY05_R1 A1 PASS';
END $$;

-- A2 (ICR-M1, finance A): a later read of a different amount, settled: never counts again.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record;
BEGIN
  g := pg_temp.garage('r1a2');
  PERFORM pg_temp.merchant(g, 'r1a2', '51002');
  inv := pg_temp.invoice(g, 'r1a2', 25.00);
  c := pg_temp.start(inv.id, 25.00, 'r1a2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'paid', 2400);
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'A2 the mismatch de-counts');
  PERFORM pg_temp.resolve(c, 'amount_mismatch', 'settled_off_platform');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'A2 settlement does not re-count');
  PERFORM pg_temp.cash(g, inv.id, 25.00, 'r1a2');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.paid_amount = 25 AND v_m.provider_paid = 0, 'A2 only the cash counts');
  RAISE NOTICE 'PAY05_R1 A2 PASS';
END $$;

-- A3 (ICR-M1): every permitted closure of a post-Paid reversal leaves the money uncounted; none claims a correction.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record;
BEGIN
  g := pg_temp.garage('r1a3');
  PERFORM pg_temp.merchant(g, 'r1a3', '51003');
  inv := pg_temp.invoice(g, 'r1a3', 30.00);
  c := pg_temp.start(inv.id, 30.00, 'r1a3-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.check(pg_temp.status(c) = 'paid' AND pg_temp.counted(c) = 0 AND pg_temp.open_disc(c, 'provider_status_unrecognized'), 'A3 Cancelled after Paid is a review');
  PERFORM pg_temp.expect(pg_temp.resolve_sql(c, 'provider_status_unrecognized', 'provider_corrected'), 'PAY05_CORRECTION_NOT_CONFIRMED_BY_PROVIDER');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'acknowledged');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0 AND pg_temp.all_receipts(c) = 1, 'A3 acknowledging does not re-count');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.uncommitted_balance = 30 AND v_m.provider_reserved = 0, 'A3 the room is free once the review is closed');
  RAISE NOTICE 'PAY05_R1 A3 PASS';
END $$;

-- A4: Paynow's OWN later matching Paid is what re-counts (nothing else), with exactly one live receipt.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_net numeric;
BEGIN
  g := pg_temp.garage('r1a4');
  PERFORM pg_temp.merchant(g, 'r1a4', '51004');
  inv := pg_temp.invoice(g, 'r1a4', 30.00);
  c := pg_temp.start(inv.id, 30.00, 'r1a4-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'unrecognized');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'acknowledged');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'A4 closure alone does not re-count');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.counted(c) = 30 AND pg_temp.live_receipts(c) = 1, 'A4 Paynow''s own matching Paid counts again with one live receipt');
  SELECT sum(CASE WHEN kind = 'allocation' THEN amount ELSE -amount END) INTO v_net FROM pay04_garage_payment_allocations WHERE collection_id = c;
  PERFORM pg_temp.check(v_net = 30, 'A4 allocation net equals the counted amount');
  RAISE NOTICE 'PAY05_R1 A4 PASS';
END $$;

-- A5 (idempotency): replays of Paid and of a closure create no second allocation or receipt.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_disc uuid;
BEGIN
  g := pg_temp.garage('r1a5');
  PERFORM pg_temp.merchant(g, 'r1a5', '51005');
  inv := pg_temp.invoice(g, 'r1a5', 40.00);
  c := pg_temp.start(inv.id, 40.00, 'r1a5-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pay04_reproject_garage_collection(c, 'replay', NULL);
  PERFORM pg_temp.check(pg_temp.allocations(c) = 1 AND pg_temp.all_receipts(c) = 1 AND pg_temp.counted(c) = 40, 'A5 three Paids, one allocation, one receipt');
  PERFORM pg_temp.read(c, 'unrecognized');
  SELECT id INTO v_disc FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'provider_status_unrecognized' AND status = 'open';
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'settled_off_platform');
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'settled_off_platform', 'r1-op', 'admin', 'Replaying the same settlement.')$q$, v_disc), 'PAY04_DISCREPANCY_NOT_OPEN');
  PERFORM pay04_reproject_garage_collection(c, 'replay', NULL);
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.all_receipts(c) = 1 AND pg_temp.allocations(c) = 2, 'A5 replayed closure and reprojection add nothing');
  RAISE NOTICE 'PAY05_R1 A5 PASS';
END $$;

-- A7: provider_corrected means Paynow itself corrected it: refused until a matching Paid was applied, and then it counts.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid;
BEGIN
  g := pg_temp.garage('r1a7');
  PERFORM pg_temp.merchant(g, 'r1a7', '51007');
  inv := pg_temp.invoice(g, 'r1a7', 18.00);
  c := pg_temp.start(inv.id, 18.00, 'r1a7-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid', 1799);
  PERFORM pg_temp.expect(pg_temp.resolve_sql(c, 'amount_mismatch', 'provider_corrected'), 'PAY05_CORRECTION_NOT_CONFIRMED_BY_PROVIDER');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'A7 the matching Paid waits for the review');
  PERFORM pg_temp.resolve(c, 'amount_mismatch', 'provider_corrected');
  PERFORM pg_temp.check(pg_temp.counted(c) = 18 AND pg_temp.live_receipts(c) = 1, 'A7 once corrected by Paynow it counts');
  RAISE NOTICE 'PAY05_R1 A7 PASS';
END $$;

-- A8: a plain Paid still counts in full with a receipt of exactly that amount (the partly-counted case is B3).
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_r numeric;
BEGIN
  g := pg_temp.garage('r1a8');
  PERFORM pg_temp.merchant(g, 'r1a8', '51008');
  inv := pg_temp.invoice(g, 'r1a8', 25.00);
  c := pg_temp.start(inv.id, 25.00, 'r1a8-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.counted(c) = 25, 'A8 counted');
  SELECT amount INTO v_r FROM pay04_garage_provider_receipts WHERE collection_id = c AND status = 'issued';
  PERFORM pg_temp.check(v_r = 25, 'A8 receipt equals what counts');
  RAISE NOTICE 'PAY05_R1 A8 PASS';
END $$;

-- ═══════════════════════════ B. after a settlement ═══════════════════════════

-- B1 (ICR-M3 4A): new money after a settlement is never dropped and never allocated: it opens a review.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb; v_m record; v_d pay04_garage_payment_discrepancies%ROWTYPE;
BEGIN
  g := pg_temp.garage('r1b1');
  PERFORM pg_temp.merchant(g, 'r1b1', '52001');
  inv := pg_temp.invoice(g, 'r1b1', 35.00);
  c := pg_temp.start(inv.id, 35.00, 'r1b1-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'unrecognized');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'settled_off_platform');
  PERFORM pg_temp.cash(g, inv.id, 35.00, 'r1b1');
  v_res := pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL, 'B1 Paid after settlement is evaluated');
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_paid_after_close'), 'B1 it opens a review');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.all_receipts(c) = 0 AND pg_temp.allocations(c) = 0, 'B1 it is never allocated');
  SELECT * INTO v_d FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'provider_paid_after_close';
  PERFORM pg_temp.check(v_d.detected_amount = 35 AND v_d.evidence->>'observed_status' = 'paid', 'B1 the review carries Paynow''s figure');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.paid_amount = 35 AND v_m.provider_paid = 0 AND v_m.provider_reserved = 0, 'B1 the invoice stays paid by the cash');
  -- the audit trail names it
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pay04_garage_collection_events WHERE collection_id = c AND event_type = 'discrepancy_opened' AND detail->>'discrepancy_type' = 'provider_paid_after_close'), 'B1 canonical audit event');
  -- a repeat of the same report adds nothing new
  v_res := pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(v_res->>'ignored' = 'after_settlement' AND pg_temp.disc_count(c, 'provider_paid_after_close') = 1, 'B1 the same report again is recorded only');
  PERFORM pg_temp.resolve(c, 'provider_paid_after_close', 'settled_off_platform');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.all_receipts(c) = 0, 'B1 closing the review counts nothing');
  RAISE NOTICE 'PAY05_R1 B1 PASS';
END $$;

-- B2 (ICR-M3 4B): the right amount after a wrong amount was settled is new money too.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1b2');
  PERFORM pg_temp.merchant(g, 'r1b2', '52002');
  inv := pg_temp.invoice(g, 'r1b2', 18.00);
  c := pg_temp.start(inv.id, 18.00, 'r1b2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid', 1799);
  PERFORM pg_temp.resolve(c, 'amount_mismatch', 'settled_off_platform');
  PERFORM pg_temp.cash(g, inv.id, 18.00, 'r1b2');
  v_res := pg_temp.read(c, 'paid', 1799);
  PERFORM pg_temp.check(v_res->>'ignored' = 'after_settlement' AND NOT pg_temp.open_disc(c, 'provider_paid_after_close'), 'B2 a repeat of the settled evidence opens nothing');
  v_res := pg_temp.read(c, 'paid', 1800);
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.open_disc(c, 'provider_paid_after_close'), 'B2 the correct amount now is new money: a review');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.all_receipts(c) = 0, 'B2 never allocated');
  RAISE NOTICE 'PAY05_R1 B2 PASS';
END $$;

-- B3 / B4 (ICR-M3 h2a/h2b): where money still counts after a settlement, a later Disputed or Refunded still acts on it.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; c2 uuid; v_res jsonb; v_m record;
BEGIN
  g := pg_temp.garage('r1b3');
  PERFORM pg_temp.merchant(g, 'r1b3', '52003');
  inv := pg_temp.invoice(g, 'r1b3', 30.00);
  -- an operator-released checkout left its room free; the customer's second checkout takes 15 of it; the first then pays 30
  c := pg_temp.start(inv.id, 30.00, 'r1b3-key-0000001', 60);
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'sent');
  PERFORM pg_temp.expired(c);
  PERFORM pay05_release_paynow_hold(c, 'r1-op', 'admin', 'Unpaid request past its time.');
  PERFORM pg_temp.cash(g, inv.id, 15.00, 'r1b3');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.counted(c) = 15 AND pg_temp.open_disc(c, 'unallocated_provider_money'), 'B3 15 counts, 15 unallocated');
  PERFORM pg_temp.resolve(c, 'unallocated_provider_money', 'settled_off_platform');
  PERFORM pg_temp.check(pg_temp.counted(c) = 15 AND pg_temp.live_receipts(c) = 1, 'B3 the part that counted keeps counting');
  v_res := pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(v_res->>'ignored' = 'after_settlement' AND pg_temp.counted(c) = 15, 'B3 the settled evidence repeated changes nothing');
  v_res := pg_temp.read(c, 'disputed');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.open_disc(c, 'provider_disputed'), 'B3 a later Disputed opens a dispute');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'B3 and de-counts');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 15, 'B3 settled money reserves nothing');
  v_res := pg_temp.read(c, 'refunded');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.status(c) = 'refunded' AND pg_temp.counted(c) = 0, 'B3 a later Refunded applies');
  RAISE NOTICE 'PAY05_R1 B3 PASS';
END $$;

DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1b4');
  PERFORM pg_temp.merchant(g, 'r1b4', '52004');
  inv := pg_temp.invoice(g, 'r1b4', 30.00);
  c := pg_temp.start(inv.id, 30.00, 'r1b4-key-0000001', 60);
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'sent');
  PERFORM pg_temp.expired(c);
  PERFORM pay05_release_paynow_hold(c, 'r1-op', 'admin', 'Unpaid request past its time.');
  PERFORM pg_temp.cash(g, inv.id, 15.00, 'r1b4');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.resolve(c, 'unallocated_provider_money', 'settled_off_platform');
  v_res := pg_temp.read(c, 'refunded');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.status(c) = 'refunded' AND pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'B4 Refunded de-counts the part that still counted');
  RAISE NOTICE 'PAY05_R1 B4 PASS';
END $$;

-- B3b: after a settlement, a Paid of ANOTHER amount is evidence against what still counted: it stops counting at once, and a
-- closure of the review never brings it back.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1b6');
  PERFORM pg_temp.merchant(g, 'r1b6', '52006');
  inv := pg_temp.invoice(g, 'r1b6', 30.00);
  c := pg_temp.start(inv.id, 30.00, 'r1b6-key-0000001', 60);
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'sent');
  PERFORM pg_temp.expired(c);
  PERFORM pay05_release_paynow_hold(c, 'r1-op', 'admin', 'Unpaid request past its time.');
  PERFORM pg_temp.cash(g, inv.id, 15.00, 'r1b6');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.resolve(c, 'unallocated_provider_money', 'settled_off_platform');
  PERFORM pg_temp.check(pg_temp.counted(c) = 15, 'B3b 15 counts');
  v_res := pg_temp.read(c, 'paid', 2400);
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_paid_after_close'), 'B3b a review opens');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'B3b what counted stops at once');
  PERFORM pg_temp.resolve(c, 'provider_paid_after_close', 'acknowledged');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'B3b and stays stopped');
  RAISE NOTICE 'PAY05_R1 B3b PASS';
END $$;

-- B5: an older read arriving after a settlement is superseded, not new money.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb; t1 bigint; t2 bigint;
BEGIN
  g := pg_temp.garage('r1b5');
  PERFORM pg_temp.merchant(g, 'r1b5', '52005');
  inv := pg_temp.invoice(g, 'r1b5', 12.00);
  c := pg_temp.start(inv.id, 12.00, 'r1b5-key-0000001');
  PERFORM pg_temp.send_attach(c);
  t1 := pay05_begin_paynow_read(c);
  t2 := pay05_begin_paynow_read(c);
  PERFORM pg_temp.read(c, 'paid', 1199, t2);
  PERFORM pg_temp.resolve(c, 'amount_mismatch', 'settled_off_platform');
  v_res := pg_temp.read(c, 'sent', NULL, t1);
  PERFORM pg_temp.check(v_res->>'ignored' = 'superseded', 'B5 an older pre-payment read is superseded');
  PERFORM pg_temp.check(NOT pg_temp.open_disc(c, 'provider_paid_after_close'), 'B5 and opens nothing');
  RAISE NOTICE 'PAY05_R1 B5 PASS';
END $$;

-- ═══════════════════════════ D. disputes ═══════════════════════════

-- D1 (ICR-M4 A): Paid -> Disputed -> Cancelled: reviewed, never closed by itself; the operator has an exit; the garage can
-- then record cash.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record;
BEGIN
  g := pg_temp.garage('r1d1');
  PERFORM pg_temp.merchant(g, 'r1d1', '53001');
  inv := pg_temp.invoice(g, 'r1d1', 60.00);
  c := pg_temp.start(inv.id, 60.00, 'r1d1-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'disputed');
  PERFORM pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.check(pg_temp.status(c) = 'paid' AND pg_temp.counted(c) = 0 AND pg_temp.open_disc(c, 'provider_disputed') AND pg_temp.open_disc(c, 'provider_status_unrecognized'), 'D1 reviews open, nothing counted');
  PERFORM pg_temp.expect(pg_temp.resolve_sql(c, 'provider_disputed', 'provider_corrected'), 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER');
  PERFORM pg_temp.resolve(c, 'provider_disputed', 'acknowledged');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'acknowledged');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 60 AND pg_temp.counted(c) = 0, 'D1 the room is free and nothing counts');
  PERFORM pg_temp.cash(g, inv.id, 60.00, 'r1d1');
  RAISE NOTICE 'PAY05_R1 D1 PASS';
END $$;

-- D2 (ICR-M4 B): a dispute Paynow never reports on again has an exit: settled outside CarUp, which never counts; if Paynow
-- speaks later that is a review.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1d2');
  PERFORM pg_temp.merchant(g, 'r1d2', '53002');
  inv := pg_temp.invoice(g, 'r1d2', 25.00);
  c := pg_temp.start(inv.id, 25.00, 'r1d2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'disputed');
  PERFORM pg_temp.expect(pg_temp.resolve_sql(c, 'provider_disputed', 'acknowledged'), 'PAY04_RESOLUTION_INVALID');
  PERFORM pg_temp.resolve(c, 'provider_disputed', 'settled_off_platform');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 25 AND pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'D2 room free, nothing counted');
  PERFORM pg_temp.cash(g, inv.id, 25.00, 'r1d2');
  v_res := pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.open_disc(c, 'provider_paid_after_close') AND pg_temp.counted(c) = 0, 'D2 Paid after the settled dispute is a review, never counted');
  RAISE NOTICE 'PAY05_R1 D2 PASS';
END $$;

-- D3 (ICR-M4): escrow -> Cancelled on an unpaid payment is a review: never an applied close that frees the room.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record;
BEGIN
  g := pg_temp.garage('r1d3');
  PERFORM pg_temp.merchant(g, 'r1d3', '53003');
  inv := pg_temp.invoice(g, 'r1d3', 40.00);
  c := pg_temp.start(inv.id, 40.00, 'r1d3-key-0000001', 60);
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'delivered');
  PERFORM pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.check(pg_temp.status(c) = 'pending' AND pg_temp.open_disc(c, 'provider_status_unrecognized'), 'D3 not closed: a review');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 40, 'D3 the room stays held');
  PERFORM pg_temp.expired(c);
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'r1-op', 'admin', 'Release while the review is open.')$q$, c), 'PAY05_HOLD_NOT_RELEASABLE');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'acknowledged');
  PERFORM pay05_release_paynow_hold(c, 'r1-op', 'admin', 'Paynow reports it Cancelled; review closed.');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 40, 'D3 after review and release the room is free');
  RAISE NOTICE 'PAY05_R1 D3 PASS';
END $$;

-- D4 (ICR-M5): a Disputed carrying a different amount is a dispute: its amount is evidence, and nothing can count it.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_d pay04_garage_payment_discrepancies%ROWTYPE;
BEGIN
  g := pg_temp.garage('r1d4');
  PERFORM pg_temp.merchant(g, 'r1d4', '53004');
  inv := pg_temp.invoice(g, 'r1d4', 25.00);
  c := pg_temp.start(inv.id, 25.00, 'r1d4-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'disputed', 2400);
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_disputed') AND NOT pg_temp.open_disc(c, 'amount_mismatch'), 'D4 a dispute, not an amount mismatch');
  SELECT * INTO v_d FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'provider_disputed' AND status = 'open';
  PERFORM pg_temp.check(v_d.detected_amount = 24 AND (v_d.evidence->>'observed_amount_minor')::bigint = 2400, 'D4 the figure is evidence');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'D4 not counted');
  PERFORM pg_temp.expect(pg_temp.resolve_sql(c, 'provider_disputed', 'provider_corrected'), 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'D4 still not counted');
  RAISE NOTICE 'PAY05_R1 D4 PASS';
END $$;

-- D5: the same report again after an operator closed its review is recorded only: it neither reopens the review nor takes
-- the room back; a different report still opens one.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1d5');
  PERFORM pg_temp.merchant(g, 'r1d5', '53005');
  inv := pg_temp.invoice(g, 'r1d5', 45.00);
  c := pg_temp.start(inv.id, 45.00, 'r1d5-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.resolve(c, 'provider_status_unrecognized', 'acknowledged');
  v_res := pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.check(v_res->>'ignored' = 'after_review' AND pg_temp.disc_count(c, 'provider_status_unrecognized') = 1, 'D5 the same word again is recorded only');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 45 AND pg_temp.counted(c) = 0, 'D5 the room stays free');
  v_res := pg_temp.read(c, 'unrecognized');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.open_disc(c, 'provider_status_unrecognized'), 'D5 a different word opens a review');
  RAISE NOTICE 'PAY05_R1 D5 PASS';
END $$;

-- ═══════════════════════════ F. refunds ═══════════════════════════

-- F1 (ICR-M6): Refunded with another amount applies in full, keeps Paynow's figure as evidence, records the true outcome.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_d pay04_garage_payment_discrepancies%ROWTYPE; v_m record;
BEGIN
  g := pg_temp.garage('r1f1');
  PERFORM pg_temp.merchant(g, 'r1f1', '54001');
  inv := pg_temp.invoice(g, 'r1f1', 20.00);
  c := pg_temp.start(inv.id, 20.00, 'r1f1-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'refunded', 500);
  PERFORM pg_temp.check(pg_temp.status(c) = 'refunded' AND pg_temp.counted(c) = 0 AND pg_temp.live_receipts(c) = 0, 'F1 applied: refunded, nothing counts');
  PERFORM pg_temp.check(NOT pg_temp.open_disc(c, 'amount_mismatch'), 'F1 not an amount mismatch');
  PERFORM pg_temp.check(pg_temp.last_outcome(c) = 'applied', 'F1 recorded as applied, and it was');
  SELECT * INTO v_d FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'provider_refund_unquantified' AND status = 'open';
  PERFORM pg_temp.check((v_d.evidence->>'observed_amount_minor')::bigint = 500, 'F1 Paynow''s figure is kept as evidence');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 20, 'F1 the room is free');
  PERFORM pg_temp.resolve(c, 'provider_refund_unquantified', 'acknowledged');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'F1 closing it counts nothing');
  RAISE NOTICE 'PAY05_R1 F1 PASS';
END $$;

-- F2 (ICR-M10): an acknowledged refund review does not reopen on every re-read.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid;
BEGIN
  g := pg_temp.garage('r1f2');
  PERFORM pg_temp.merchant(g, 'r1f2', '54002');
  inv := pg_temp.invoice(g, 'r1f2', 20.00);
  c := pg_temp.start(inv.id, 20.00, 'r1f2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.read(c, 'refunded');
  PERFORM pg_temp.resolve(c, 'provider_refund_unquantified', 'acknowledged');
  PERFORM pg_temp.read(c, 'refunded');
  PERFORM pg_temp.read(c, 'refunded');
  PERFORM pg_temp.check(pg_temp.disc_count(c, 'provider_refund_unquantified') = 1 AND NOT pg_temp.open_disc(c, 'provider_refund_unquantified'), 'F2 one review per collection');
  RAISE NOTICE 'PAY05_R1 F2 PASS';
END $$;

-- F2b: an observation recorded as applied really was. If the money writer ever declines, the whole observation aborts rather
-- than leaving an "applied" row for something that was not (ICR-M6). The stub lives and dies inside this subtransaction.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_rows bigint;
BEGIN
  g := pg_temp.garage('r1f4');
  PERFORM pg_temp.merchant(g, 'r1f4', '54004');
  inv := pg_temp.invoice(g, 'r1f4', 20.00);
  c := pg_temp.start(inv.id, 20.00, 'r1f4-key-0000001');
  PERFORM pg_temp.send_attach(c);
  SELECT count(*) INTO v_rows FROM pay05_paynow_observations WHERE collection_id = c;
  BEGIN
    CREATE OR REPLACE FUNCTION public.pay04_apply_garage_provider_snapshot(p_collection_id uuid, p_status text, p_provider_payment_id text, p_refund_id text,
      p_event_id text, p_event_type text, p_amount_minor bigint, p_currency text, p_merchant_reference text,
      p_refunded_minor bigint, p_pending_refund_minor bigint, p_refund_ids text[], p_mismatch text, p_detected_via text)
    RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"applied": false, "refused": "stubbed"}'::jsonb $f$;
    PERFORM pg_temp.expect(format($q$SELECT pg_temp.read(%L, 'paid')$q$, c), 'PAY05_OBSERVATION_NOT_APPLIED');
    RAISE EXCEPTION 'R1_F2B_UNDO';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'R1_F2B_UNDO' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.check((SELECT count(*) FROM pay05_paynow_observations WHERE collection_id = c) = v_rows, 'F2b nothing half-recorded');
  PERFORM pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.counted(c) = 20, 'F2b the real writer is back');
  RAISE NOTICE 'PAY05_R1 F2b PASS';
END $$;

-- F3: Refunded after CarUp closed a payment whose late money was seen tells the operator; without money it is just recorded.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; c2 uuid; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1f3');
  PERFORM pg_temp.merchant(g, 'r1f3', '54003');
  inv := pg_temp.invoice(g, 'r1f3', 20.00);
  c := pg_temp.start(inv.id, 20.00, 'r1f3-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.check(pg_temp.status(c) = 'cancelled', 'F3 closed without money');
  c2 := pg_temp.start(inv.id, 20.00, 'r1f3-key-0000002');
  PERFORM pg_temp.send_attach(c2);
  PERFORM pg_temp.read(c2, 'cancelled');
  v_res := pg_temp.read(c, 'refunded');
  PERFORM pg_temp.check(v_res->>'ignored' = 'after_close' AND NOT pg_temp.open_disc(c, 'provider_refund_unquantified'), 'F3 no money seen: recorded only');
  PERFORM pg_temp.read(c2, 'paid');
  PERFORM pg_temp.check(pg_temp.open_disc(c2, 'provider_paid_after_close'), 'F3 late money is a review');
  v_res := pg_temp.read(c2, 'refunded');
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.open_disc(c2, 'provider_refund_unquantified') AND pg_temp.status(c2) = 'cancelled' AND pg_temp.counted(c2) = 0, 'F3 its refund tells the operator');
  RAISE NOTICE 'PAY05_R1 F3 PASS';
END $$;

-- ═══════════════════════════ G. read order ═══════════════════════════

-- G1 (ICR-M7): a word that moves the payment forward is never superseded by ticket order; a backward one is.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb; t1 bigint; t2 bigint; t3 bigint; t4 bigint;
BEGIN
  g := pg_temp.garage('r1g1');
  PERFORM pg_temp.merchant(g, 'r1g1', '55001');
  inv := pg_temp.invoice(g, 'r1g1', 22.00);
  c := pg_temp.start(inv.id, 22.00, 'r1g1-key-0000001');
  PERFORM pg_temp.send_attach(c);
  t1 := pay05_begin_paynow_read(c);
  t2 := pay05_begin_paynow_read(c);
  t3 := pay05_begin_paynow_read(c);
  t4 := pay05_begin_paynow_read(c);
  PERFORM pg_temp.read(c, 'sent', NULL, t2);
  v_res := pg_temp.read(c, 'paid', NULL, t1);
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.counted(c) = 22, 'G1 Paid answered later than a newer ticket''s Sent still applies');
  PERFORM pg_temp.read(c, 'paid', NULL, t4);
  v_res := pg_temp.read(c, 'disputed', NULL, t3);
  PERFORM pg_temp.check(v_res->>'ignored' IS NULL AND pg_temp.open_disc(c, 'provider_disputed') AND pg_temp.counted(c) = 0, 'G1 a Disputed on an older ticket is not lost');
  v_res := pg_temp.read(c, 'paid', NULL, t2);
  PERFORM pg_temp.check(v_res->>'ignored' = 'superseded' AND pg_temp.counted(c) = 0, 'G1 an older Paid does not end a newer dispute');
  RAISE NOTICE 'PAY05_R1 G1 PASS';
END $$;

-- G2 (ICR-M7 10b): a release is refused when an older ticket reported Paid.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; t1 bigint; t2 bigint;
BEGIN
  g := pg_temp.garage('r1g2');
  PERFORM pg_temp.merchant(g, 'r1g2', '55002');
  inv := pg_temp.invoice(g, 'r1g2', 22.00);
  c := pg_temp.start(inv.id, 22.00, 'r1g2-key-0000001', 60);
  PERFORM pg_temp.send_attach(c);
  t1 := pay05_begin_paynow_read(c);
  t2 := pay05_begin_paynow_read(c);
  PERFORM pg_temp.read(c, 'sent', NULL, t2);
  PERFORM pg_temp.read(c, 'paid', NULL, t1);
  PERFORM pg_temp.expired(c);
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'r1-op', 'admin', 'Trying to release paid money.')$q$, c), 'PAY05_HOLD_NOT_RELEASABLE');
  PERFORM pg_temp.check(pg_temp.counted(c) = 22, 'G2 counted');
  RAISE NOTICE 'PAY05_R1 G2 PASS';
END $$;

-- ═══════════════════════════ I. lost replies, late money, room ═══════════════════════════

-- I1 (ICR-M8): Paynow's refusal arriving after a concurrent trace marked the request unknown still closes it.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record;
BEGIN
  g := pg_temp.garage('r1i1');
  PERFORM pg_temp.merchant(g, 'r1i1', '56001');
  inv := pg_temp.invoice(g, 'r1i1', 15.00);
  c := pg_temp.start(inv.id, 15.00, 'r1i1-key-0000001');
  PERFORM pay05_record_paynow_sending(c, pg_temp.trace(c), 'ecocash', NULL);
  PERFORM pay05_mark_paynow_initiation(c, 'unknown', 'PAY05_PROVIDER_UNREACHABLE');
  PERFORM pay05_mark_paynow_initiation(c, 'refused', 'Invalid amount');
  PERFORM pg_temp.check(pg_temp.status(c) = 'cancelled', 'I1 closed');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 15, 'I1 room free');
  RAISE NOTICE 'PAY05_R1 I1 PASS';
END $$;

-- I2 (ICR-M9): late money of a wrong amount after a close is late money, and re-reserves nothing.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_m record;
BEGIN
  g := pg_temp.garage('r1i2');
  PERFORM pg_temp.merchant(g, 'r1i2', '56002');
  inv := pg_temp.invoice(g, 'r1i2', 20.00);
  c := pg_temp.start(inv.id, 20.00, 'r1i2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'cancelled');
  PERFORM pg_temp.read(c, 'paid', 3000);
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_paid_after_close') AND NOT pg_temp.open_disc(c, 'amount_mismatch'), 'I2 late money, not a mismatch');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 20, 'I2 re-reserves nothing');
  RAISE NOTICE 'PAY05_R1 I2 PASS';
END $$;

-- ═══════════════════════════ K. onboarding ═══════════════════════════

-- K1 (ICR-S2): no integration ID is reserved without a proved key; refusals are generic.
DO $$
DECLARE g uuid; g2 uuid; v_item jsonb; v_acct uuid;
BEGIN
  g := pg_temp.garage('r1k1');
  g2 := pg_temp.garage('r1k2');
  v_item := pg_temp.integration('USD', '57001', ARRAY['web']);
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1k1-admin', 'K1 Garage', pg_temp.profile('K1 Motors (Pvt) Ltd'), %L)$q$, g,
    jsonb_build_array(v_item - 'probe')), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1k1-admin', 'K1 Garage', pg_temp.profile('K1 Motors (Pvt) Ltd'), %L)$q$, g,
    jsonb_build_array(v_item || jsonb_build_object('probe', jsonb_build_object('result', 'unauthenticated', 'credential_fingerprint', lpad('57001', 16, '0'))))), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1k1-admin', 'K1 Garage', pg_temp.profile('K1 Motors (Pvt) Ltd'), %L)$q$, g,
    jsonb_build_array(v_item || jsonb_build_object('probe', jsonb_build_object('result', 'authenticated', 'credential_fingerprint', 'ffffffffffffffff')))), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay05_merchant_integrations WHERE integration_id = '57001'), 'K1 nothing reserved');
  -- a live ID: the second garage gets the same generic refusal
  v_acct := pg_temp.register(g, 'r1k1', jsonb_build_array(v_item));
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1k2-admin', 'K2 Garage', pg_temp.profile('K2 Motors (Pvt) Ltd'), %L)$q$, g2,
    jsonb_build_array(v_item)), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  -- rejected: a cool-down on that ID, for everyone
  PERFORM pay05_reject_paynow_merchant(v_acct, 'r1-op', 'admin', 'The legal entity does not match the merchant.');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1k2-admin', 'K2 Garage', pg_temp.profile('K2 Motors (Pvt) Ltd'), %L)$q$, g2,
    jsonb_build_array(v_item)), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  RAISE NOTICE 'PAY05_R1 K1 PASS';
END $$;

-- K2 (ICR-M11): an ID once verified for one garage is not another garage's after a disconnect; the same garage may reconnect.
DO $$
DECLARE g uuid; g2 uuid; v_acct uuid; v_item jsonb;
BEGIN
  g := pg_temp.garage('r1k3');
  g2 := pg_temp.garage('r1k4');
  v_acct := pg_temp.merchant(g, 'r1k3', '57002');
  v_item := pg_temp.integration('USD', '57002', ARRAY['web']);
  PERFORM pay05_suspend_paynow_merchant(v_acct, 'r1k3-admin', 'owner', 'The garage is changing its Paynow account.');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1k4-admin', 'K4 Garage', pg_temp.profile('K4 Motors (Pvt) Ltd'), %L)$q$, g2,
    jsonb_build_array(v_item)), 'PAY05_INTEGRATION_NOT_ACCEPTED');
  v_acct := pg_temp.register(g, 'r1k3', jsonb_build_array(v_item));
  PERFORM pg_temp.check(v_acct IS NOT NULL, 'K2 the same garage reconnects');
  RAISE NOTICE 'PAY05_R1 K2 PASS';
END $$;

-- K3 (ICR-S3): an operator who worked at the garage cannot verify it by being removed first. A membership with no workforce
-- record leaves no trace, which is the residual risk this cannot close without a membership history.
DO $$
DECLARE g uuid; v_acct uuid; v_profile uuid;
BEGIN
  g := pg_temp.garage('r1k5');
  INSERT INTO users (id, name, email, role, join_date) VALUES ('r1k5-op', 'r1k5-op', 'r1k5-op@example.invalid', 'admin', '2026-01-01');
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (g, 'r1k5-op', 'admin');
  INSERT INTO garage_workforce_profiles (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
    VALUES (g, 'r1k5-op', 'R1K5-O', 'employee', 'active', '2026-10-01', 'r1k5-admin') RETURNING id INTO v_profile;
  v_acct := pg_temp.register(g, 'r1k5', jsonb_build_array(pg_temp.integration('USD', '57005', ARRAY['web'])));
  DELETE FROM tenant_users WHERE tenant_id = g AND user_id = 'r1k5-op';
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'r1k5-op', 'admin', %L, 'Reviewed the merchant.')$q$, v_acct, pg_temp.evidence(v_acct)), 'PAY05_REVIEWER_SEPARATION_REQUIRED');
  RAISE NOTICE 'PAY05_R1 K3 PASS';
END $$;

-- ═══════════════════════════ L. currency authority ═══════════════════════════

-- L1 (ICR-P1): verification requires each integration's own reviewed settlement currency, and refuses a mismatch.
DO $$
DECLARE g uuid; v_acct uuid; v_ev jsonb; v_id uuid; v_row pay05_merchant_integrations%ROWTYPE;
BEGIN
  g := pg_temp.garage('r1l1');
  v_acct := pg_temp.register(g, 'r1l1', jsonb_build_array(pg_temp.integration('USD', '58001', ARRAY['web']), pg_temp.integration('ZWG', '58002', ARRAY['web'])));
  v_ev := pg_temp.evidence(v_acct);
  SELECT id INTO v_id FROM pay05_merchant_integrations WHERE merchant_account_id = v_acct AND currency = 'ZWG';
  -- nothing for one currency: the global tick-box alone is not enough
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'r1-op', 'admin', %L, 'Reviewed the merchant.')$q$, v_acct, v_ev #- ARRAY['currency_evidence', v_id::text]), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  -- the ZWG integration actually settles in USD
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'r1-op', 'admin', %L, 'Reviewed the merchant.')$q$, v_acct,
    jsonb_set(v_ev, ARRAY['currency_evidence', v_id::text, 'settlement_currency'], '"USD"')), 'PAY05_CURRENCY_EVIDENCE_MISMATCH');
  -- no reference to where it was checked
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'r1-op', 'admin', %L, 'Reviewed the merchant.')$q$, v_acct,
    jsonb_set(v_ev, ARRAY['currency_evidence', v_id::text, 'reference'], '"short"')), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  PERFORM pay05_verify_paynow_merchant(v_acct, 'r1-op', 'admin', v_ev, 'Reviewed the merchant.');
  SELECT * INTO v_row FROM pay05_merchant_integrations WHERE id = v_id;
  PERFORM pg_temp.check(v_row.currency_evidence->>'settlement_currency' = 'ZWG' AND v_row.currency_evidence->>'reviewed_by' = 'r1-op', 'L1 recorded per integration, attributed');
  PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_integrations SET currency_evidence = '{}'::jsonb WHERE id = %L$q$, v_id), 'PAY05_INTEGRATION_IMMUTABLE');
  RAISE NOTICE 'PAY05_R1 L1 PASS';
END $$;

-- L2 (ICR-P1): an integration verified without currency evidence (a row from before this migration) cannot collect, and a
-- request already in flight on it never allocates: its money is a currency review.
DO $$
DECLARE g uuid; v_acct uuid; inv garage_invoices%ROWTYPE; c uuid; v_res jsonb;
BEGIN
  g := pg_temp.garage('r1l2');
  v_acct := pg_temp.merchant(g, 'r1l2', '58003');
  inv := pg_temp.invoice(g, 'r1l2', 10.00);
  c := pg_temp.start(inv.id, 10.00, 'r1l2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  SET LOCAL session_replication_role = replica;
  UPDATE pay05_merchant_integrations SET currency_evidence = NULL WHERE merchant_account_id = v_acct;
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.check(pay05_verified_integration(v_acct, 'USD') IS NULL, 'L2 not a verified integration without evidence');
  v_res := pg_temp.read(c, 'paid');
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'currency_mismatch') AND pg_temp.counted(c) = 0 AND pg_temp.all_receipts(c) = 0, 'L2 never allocated: a currency review');
  PERFORM pg_temp.check(pg_temp.status(c) = 'pending', 'L2 not applied');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'r1-cust', 10.00, 'USD', 'r1l2-key-0000002', 1800)$q$, inv.id), 'PAY04_');
  PERFORM pg_temp.resolve(c, 'currency_mismatch', 'settled_off_platform');
  PERFORM pg_temp.check(pg_temp.counted(c) = 0, 'L2 settling it counts nothing');
  RAISE NOTICE 'PAY05_R1 L2 PASS';
END $$;

-- L3 (ICR-P1): USD and ZWG stay separate authorities: a merchant with only USD cannot collect a ZWG invoice, no conversion.
DO $$
DECLARE g uuid; v_acct uuid; inv garage_invoices%ROWTYPE;
BEGIN
  g := pg_temp.garage('r1l3');
  v_acct := pg_temp.merchant(g, 'r1l3', '58004');
  inv := pg_temp.invoice(g, 'r1l3', 100.00, 'ZWG');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'r1-cust', 100.00, 'ZWG', 'r1l3-key-0000001', 1800)$q$, inv.id), 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED');
  RAISE NOTICE 'PAY05_R1 L3 PASS';
END $$;

-- L4 (ICR-P3): a fee-inclusive Paid stays an amount review and counts nothing; a real mode needs the fee attestation.
DO $$
DECLARE g uuid; v_acct uuid; inv garage_invoices%ROWTYPE; c uuid; v_ev jsonb; v_id uuid;
BEGIN
  g := pg_temp.garage('r1l4');
  v_acct := pg_temp.merchant(g, 'r1l4', '58005');
  inv := pg_temp.invoice(g, 'r1l4', 100.00);
  c := pg_temp.start(inv.id, 100.00, 'r1l4-key-0000001');
  PERFORM pg_temp.send_attach(c);
  PERFORM pg_temp.read(c, 'paid', 10350);
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'amount_mismatch') AND pg_temp.counted(c) = 0, 'L4 fee-inclusive: a review, nothing counted');
  -- a real-mode row cannot exist at Level 1; the writer's rule is proved on one placed by hand
  g := pg_temp.garage('r1l5');
  v_acct := pg_temp.register(g, 'r1l5', jsonb_build_array(pg_temp.integration('USD', '58006', ARRAY['web'])));
  SET LOCAL session_replication_role = replica;
  UPDATE pay05_merchant_integrations SET mode = 'paynow_test' WHERE merchant_account_id = v_acct;
  SET LOCAL session_replication_role = origin;
  v_ev := pg_temp.evidence(v_acct);
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'r1-op', 'admin', %L, 'Reviewed the merchant.')$q$, v_acct, v_ev), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  RAISE NOTICE 'PAY05_R1 L4 PASS';
END $$;

-- L5 (ICR-P2): a Paynow test-mode integration needs the merchant's login e-mail; other modes never hold one. Real modes are off
-- by constraint, so this block lifts the constraint inside its own subtransaction and undoes everything it did.
DO $$
DECLARE g uuid; v_item jsonb; v_row pay05_merchant_integrations%ROWTYPE;
BEGIN
  g := pg_temp.garage('r1l6');
  v_item := pg_temp.integration('USD', '58007', ARRAY['ecocash'], 'paynow_test');
  BEGIN
    ALTER TABLE pay05_runtime_guard DROP CONSTRAINT pay05_real_paynow_requires_activation_migration;
    UPDATE pay05_runtime_guard SET paynow_real_enabled = true WHERE singleton;
    PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'r1l6-admin', 'L6 Garage', pg_temp.profile('L6 Motors (Pvt) Ltd'), %L)$q$, g, jsonb_build_array(v_item)), 'PAY05_TEST_AUTH_EMAIL_REQUIRED');
    PERFORM pg_temp.register(g, 'r1l6', jsonb_build_array(v_item || jsonb_build_object('test_auth_email', 'merchant@example.invalid')));
    SELECT * INTO v_row FROM pay05_merchant_integrations WHERE tenant_id = g;
    PERFORM pg_temp.check(v_row.test_auth_email = 'merchant@example.invalid', 'L5 kept on the test-mode integration');
    PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_integrations SET test_auth_email = 'other@example.invalid' WHERE id = %L$q$, v_row.id), 'PAY05_INTEGRATION_IMMUTABLE');
    RAISE EXCEPTION 'R1_L5_UNDO';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'R1_L5_UNDO' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.check((SELECT NOT paynow_real_enabled FROM pay05_runtime_guard), 'L5 real Paynow is off again');
  PERFORM pg_temp.expect($q$UPDATE pay05_runtime_guard SET paynow_real_enabled = true$q$, 'pay05_real_paynow_requires_activation_migration');
  -- a simulator integration can never carry one
  PERFORM pg_temp.register(g, 'r1l6', jsonb_build_array(pg_temp.integration('USD', '58008', ARRAY['web']) || jsonb_build_object('test_auth_email', 'merchant@example.invalid')));
  PERFORM pg_temp.check((SELECT test_auth_email IS NULL FROM pay05_merchant_integrations WHERE integration_id = '58008'), 'L5 a simulator integration holds none');
  RAISE NOTICE 'PAY05_R1 L5 PASS';
END $$;

-- ═══════════════════════════ N. identity columns, budget, least privilege ═══════════════════════════

-- N1 (ICR-M2, S1): a status-update observation advances a monotonic per-collection generation; the same message at a later
-- generation is a new event; the same event id is one row.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; v_gen bigint; v_res jsonb; v_e text; v_ref text; v_pid text;
BEGIN
  g := pg_temp.garage('r1n1');
  PERFORM pg_temp.merchant(g, 'r1n1', '59001');
  inv := pg_temp.invoice(g, 'r1n1', 10.00);
  c := pg_temp.start(inv.id, 10.00, 'r1n1-key-0000001');
  PERFORM pg_temp.send_attach(c);
  SELECT status_update_generation INTO v_gen FROM pay05_paynow_transactions WHERE collection_id = c;
  PERFORM pg_temp.check(v_gen = 0, 'N1 starts at zero');
  SELECT payment_reference, provider_payment_id INTO v_ref, v_pid FROM pay04_garage_collections WHERE id = c;
  v_e := 'evt_pn_' || left(encode(sha256(convert_to('r1n1-a', 'UTF8')), 'hex'), 40);
  v_res := pay05_apply_paynow_observation(c, 'status_update', v_e, 'paid', 'Paid', 1000, v_ref, '9510', v_pid, repeat('a', 64), pay05_begin_status_update_read(c));
  PERFORM pg_temp.check((SELECT status_update_generation FROM pay05_paynow_transactions WHERE collection_id = c) = 1, 'N1 advanced');
  v_res := pay05_apply_paynow_observation(c, 'status_update', v_e, 'paid', 'Paid', 1000, v_ref, '9510', v_pid, repeat('a', 64), pay05_begin_status_update_read(c));
  PERFORM pg_temp.check((v_res->>'duplicate_event')::boolean AND (SELECT count(*) FROM pay05_paynow_observations WHERE event_id = v_e) = 1, 'N1 the same event is one row');
  PERFORM pg_temp.check((SELECT status_update_generation FROM pay05_paynow_transactions WHERE collection_id = c) = 1, 'N1 a duplicate does not advance');
  PERFORM pg_temp.expect(format($q$UPDATE pay05_paynow_transactions SET status_update_generation = 0 WHERE collection_id = %L$q$, c), 'PAY05_TRANSACTION_IMMUTABLE');
  RAISE NOTICE 'PAY05_R1 N1 PASS';
END $$;

-- N2 (ICR-S1): a per-collection budget for reads a status update can trigger; one collection's budget is not another's.
DO $$
DECLARE g uuid; inv garage_invoices%ROWTYPE; c uuid; c2 uuid; i int; v_t bigint;
BEGIN
  g := pg_temp.garage('r1n2');
  PERFORM pg_temp.merchant(g, 'r1n2', '59002');
  inv := pg_temp.invoice(g, 'r1n2', 20.00);
  c := pg_temp.start(inv.id, 10.00, 'r1n2-key-0000001');
  PERFORM pg_temp.send_attach(c);
  c2 := pg_temp.start(inv.id, 10.00, 'r1n2-key-0000002');
  PERFORM pg_temp.send_attach(c2);
  FOR i IN 1..12 LOOP
    v_t := pay05_begin_status_update_read(c);
    PERFORM pg_temp.check(v_t > 0, 'N2 within budget');
  END LOOP;
  PERFORM pg_temp.expect(format($q$SELECT pay05_begin_status_update_read(%L)$q$, c), 'PAY05_STATUS_UPDATE_READS_UNAVAILABLE');
  PERFORM pg_temp.check(pay05_begin_status_update_read(c2) > 0, 'N2 another collection is unaffected');
  PERFORM pg_temp.check(pay05_begin_paynow_read(c) > 0, 'N2 an ordinary read still works');
  RAISE NOTICE 'PAY05_R1 N2 PASS';
END $$;

-- N3: least privilege on everything R1 added; sequences revoked.
DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(v_role, 'public.pay05_begin_status_update_read(uuid)', 'EXECUTE'), v_role || ' cannot take a budgeted read');
  END LOOP;
  PERFORM pg_temp.check(has_function_privilege('service_role', 'public.pay05_begin_status_update_read(uuid)', 'EXECUTE'), 'service_role calls it');
  PERFORM pg_temp.check(NOT has_function_privilege('service_role', 'public.pay05_paynow_money_rank(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.pay05_paynow_money_rank(text)', 'EXECUTE'), 'helpers are not callable');
  PERFORM pg_temp.check(NOT has_function_privilege('service_role', 'public.pay05_collection_currency_bound(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.pay05_collection_currency_bound(uuid)', 'EXECUTE'), 'helpers are not callable');
  PERFORM pg_temp.check(NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'pay05\_%'
       AND (has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('authenticated', c.oid, 'USAGE') OR has_sequence_privilege('service_role', c.oid, 'USAGE'))), 'no API role can use a PAY-05 sequence');
  RAISE NOTICE 'PAY05_R1 N3 PASS';
END $$;

DO $$
BEGIN
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = false WHERE singleton;
  RAISE NOTICE 'PAY05_R1_FINANCIAL_INTEGRITY_POSTGRES_SMOKE_PASS: money counts only on Paynow''s own matching Paid, settlement never counts, new money is reviewed, every dispute has an exit, refunds apply, reads stay ordered, onboarding and currency fail closed';
END $$;
