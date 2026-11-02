-- CARUP-PAY-05-LR01 — Zimbabwe collections through the garage's OWN Paynow merchant (migration 20261103100000) on real
-- PostgreSQL, after PAY-04 and the certified PAY smokes.
--
--   M   merchant: the garage administrator registers its own Paynow merchant (legal profile + one integration per
--       currency, sealed key only); real Paynow modes, ZIG, duplicate currencies, InnBucks outside USD and a second live
--       merchant are refused; one live owner per integration ID across garages; CarUp Stripe can never be a garage gateway
--   V   verification: an independent platform administrator only (not the registrant, not a garage member), with complete
--       evidence including an authenticated credential probe bound to each key's fingerprint; immutable credentials,
--       profile and audit; least privilege (no anon/authenticated access to any PAY-05 table or writer)
--   C   checkout: one Paynow request per collection (a retry replays it), method must be enabled, attach once, bound to
--       its trace and poll URL; escrow (Awaiting Delivery / Delivered) is not money; Paid counts with a receipt;
--       duplicate and cross-collection replays refused; foreign evidence refused
--   S   provider statuses: Disputed de-counts and holds the room until Paynow reports Paid (operator cannot close it
--       earlier); Refunded de-counts and asks the operator to confirm; a step backwards or an undocumented word is a
--       review; an amount mismatch is never applied; Failed closes; money after close is never counted
--   U   lost reply: a stop never closes an unresolved request; expiry cannot close it; only two authenticated NotFound
--       traces a minute apart do
--   H   hold release: operator only, after expiry, with a fresh authenticated unpaid read; room returns; late money
--       after release becomes unallocated provider money — never a double count
--   O   operations: availability switch (operator only), garage disconnect, real Paynow stays off by constraint
--   R   independent-review remediation (2026-11-02): read tickets supersede stale reads; a pre-payment status after money
--       is a stale regression; an amount-mismatched Paid cannot end a dispute; refused / never-confirmed requests close
--       and late signed money binds late into an operator review; operator release of an unconfirmed request after a
--       fresh trace attempt; early attach keeps the reply's data; a reply for another reference is refused; settling an
--       amount mismatch outside CarUp frees the room; Refunded without an amount is applied and reviewed; PAY-04 writers
--       refuse Paynow rows; availability stops sending; release freshness reads every source; provider errors throttled
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY05_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ p_pattern THEN
      RAISE EXCEPTION 'PAY05_SMOKE_WRONG_ERROR: expected % got % (sql: %)', p_pattern, SQLERRM, left(p_sql, 220);
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY05_SMOKE_EXPECTED_FAILURE: % (sql: %)', p_pattern, left(p_sql, 220);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PAY05_SMOKE_CHECK_FAILED: %', p_what; END IF;
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

-- A sealed-key fixture: only the SHAPE the backend's AES-256-GCM seal produces (base64 ciphertext, 12-byte IV, 16-byte tag).
CREATE OR REPLACE FUNCTION pg_temp.integration(p_currency text, p_id text, p_methods text[], p_fingerprint text, p_mode text DEFAULT 'simulator')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('currency', p_currency, 'integration_id', p_id, 'mode', p_mode, 'methods', to_jsonb(p_methods),
    'ciphertext', 'U0VBTEVELUtFWS1GSVhUVVJFLU5PVC1BLUtFWQ==', 'iv', 'AAECAwQFBgcICQoL', 'tag', 'AAECAwQFBgcICQoLDA0ODw==',
    'key_version', 1, 'fingerprint', p_fingerprint);
$$;
CREATE OR REPLACE FUNCTION pg_temp.profile(p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('legal_entity_name', p_name, 'registration_number', '1234/2026', 'settlement_bank_name', 'CBZ Bank',
    'settlement_account_last4', '4321', 'settlement_account_holder', p_name,
    'attestation', 'I confirm this Paynow merchant account and its settlement account belong to this garage business.');
$$;
CREATE OR REPLACE FUNCTION pg_temp.collection(p_begin jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT (p_begin->'collection'->>'id')::uuid;
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
CREATE OR REPLACE FUNCTION pg_temp.send_attach(p_collection uuid, p_method text DEFAULT 'web') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pay05_record_paynow_sending(p_collection, pg_temp.trace(p_collection), p_method, NULL);
  PERFORM pay05_attach_paynow_collection(p_collection, pg_temp.trace(p_collection), pg_temp.poll(p_collection), pg_temp.pid(p_collection),
    jsonb_build_object('browser_url', 'http://127.0.0.1:5061/Payment/ConfirmPayment/' || p_collection::text, 'paynow_reference', '9510'));
END $$;
-- An authenticated Paynow observation for a collection, with its own reference and (by default) its own amount.
CREATE OR REPLACE FUNCTION pg_temp.obs(p_collection uuid, p_status text, p_via text DEFAULT 'poll', p_event text DEFAULT NULL,
  p_amount_minor bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pay05_apply_paynow_observation(c.id, p_via, p_event, p_status, initcap(replace(p_status, '_', ' ')),
    coalesce(p_amount_minor, c.amount_minor), c.payment_reference, '9510', pg_temp.pid(c.id),
    CASE WHEN p_via = 'status_update' THEN encode(sha256(convert_to(coalesce(p_event, '') || p_status, 'UTF8')), 'hex') END)
  FROM pay04_garage_collections c WHERE c.id = p_collection;
$$;
-- The same, as a fresh Paynow read that took DB read ticket p_ticket before it was sent (poll / trace / OTP reply).
CREATE OR REPLACE FUNCTION pg_temp.obs_t(p_collection uuid, p_status text, p_ticket bigint, p_via text DEFAULT 'poll',
  p_amount_minor bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pay05_apply_paynow_observation(c.id, p_via, NULL, p_status, initcap(replace(p_status, '_', ' ')),
    coalesce(p_amount_minor, c.amount_minor), c.payment_reference, '9510', pg_temp.pid(c.id), NULL, p_ticket)
  FROM pay04_garage_collections c WHERE c.id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.evt(p_n int) RETURNS text LANGUAGE sql AS $$
  SELECT 'evt_pn_' || left(encode(sha256(convert_to('p5-event-' || p_n, 'UTF8')), 'hex'), 40);
$$;
CREATE OR REPLACE FUNCTION pg_temp.status(p_collection uuid) RETURNS text LANGUAGE sql AS $$
  SELECT p.status FROM pay04_garage_collections c JOIN payment_transactions p ON p.reference = c.payment_reference WHERE c.id = p_collection;
$$;
CREATE OR REPLACE FUNCTION pg_temp.open_disc(p_collection uuid, p_type text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pay04_garage_payment_discrepancies WHERE collection_id = p_collection AND discrepancy_type = p_type AND status = 'open');
$$;

-- ═══════════════════════════ M, V ═══════════════════════════
DO $$
DECLARE
  g uuid; g2 uuid; v_reg jsonb; v_reg2 jsonb; v_acct pay04_garage_merchant_accounts%ROWTYPE; v_usd uuid; v_zwg uuid;
  v_evidence jsonb; v_count int; v_inv garage_invoices%ROWTYPE;
BEGIN
  INSERT INTO users (id, name, email, role, join_date) VALUES
    ('p5-cust', 'p5-cust', 'p5-cust@example.invalid', 'owner', '2026-01-01'),
    ('p5-out', 'p5-out', 'p5-out@example.invalid', 'owner', '2026-01-01'),
    ('p5-op', 'p5-op', 'p5-op@example.invalid', 'admin', '2026-01-01'),
    ('p5-op-member', 'p5-op-member', 'p5-op-member@example.invalid', 'admin', '2026-01-01');
  INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id) VALUES ('PAY05PAYNOWVIN0001', 'Toyota', 'Hilux', 2020, 60000, 1000, 'p5-cust');
  g := pg_temp.garage('p5a');
  g2 := pg_temp.garage('p5b');
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (g, 'p5-op-member', 'admin');

  -- M: Paynow is refused until the disposable runtime guard enables the protocol simulator; real Paynow stays off.
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000a1')))$q$, g), 'PAY05_MODE_NOT_PERMITTED');
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = true;
  PERFORM pg_temp.expect('UPDATE pay05_runtime_guard SET paynow_real_enabled = true', 'pay05_real_paynow_requires_activation_migration');
  -- M: only the garage's own administrator registers; never a mechanic, the customer or an outsider
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-mech', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000a1')))$q$, g), 'PAY05_MERCHANT_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5-cust', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000a1')))$q$, g), 'PAY05_MERCHANT_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5b-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000a1')))$q$, g), 'PAY05_MERCHANT_AUTHORITY_REFUSED');
  -- M: real Paynow modes, ZIG, a repeated currency, InnBucks outside USD
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000a1', 'paynow_live')))$q$, g), 'PAY05_MODE_NOT_PERMITTED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('ZIG', '20001', ARRAY['web'], '00000000000000a1')))$q$, g), 'PAY05_CURRENCY_NOT_SUPPORTED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000a1'), pg_temp.integration('USD', '20002', ARRAY['web'], '00000000000000a2')))$q$, g), 'PAY05_DUPLICATE_CURRENCY');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('ZWG', '20003', ARRAY['web', 'innbucks'], '00000000000000a3')))$q$, g), 'pay05_innbucks_usd_only');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay04_garage_merchant_accounts WHERE tenant_id = g), 'every refused registration left nothing behind');

  v_reg := pay05_register_paynow_merchant(g, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(
    pg_temp.integration('USD', '20001', ARRAY['web', 'ecocash', 'innbucks', 'omari'], '00000000000000a1'),
    pg_temp.integration('ZWG', '20002', ARRAY['web', 'ecocash'], '00000000000000a2')));
  SELECT * INTO v_acct FROM pay04_garage_merchant_accounts WHERE id = (v_reg->'merchant'->>'id')::uuid;
  PERFORM pg_temp.check(v_acct.gateway = 'paynow_zimbabwe' AND v_acct.status = 'pending_verification' AND v_acct.currencies = ARRAY['USD', 'ZWG']
    AND v_acct.merchant_reference ~ '^pnm_[0-9a-f]{32}$' AND v_acct.registered_by = 'p5a-admin', 'pending Paynow merchant owned by the garage');
  PERFORM pg_temp.check(jsonb_array_length(v_reg->'integrations') = 2 AND NOT (v_reg::text ~ 'U0VBTEVE'), 'the writer never returns sealed material');
  SELECT id INTO v_usd FROM pay05_merchant_integrations WHERE merchant_account_id = v_acct.id AND currency = 'USD';
  SELECT id INTO v_zwg FROM pay05_merchant_integrations WHERE merchant_account_id = v_acct.id AND currency = 'ZWG';
  PERFORM pg_temp.check((SELECT methods FROM pay05_merchant_integrations WHERE id = v_usd) = ARRAY['ecocash', 'innbucks', 'omari', 'web'], 'methods stored as given (sorted)');
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5a-admin', 'P5A Garage', pg_temp.profile('P5A Motors (Pvt) Ltd'), jsonb_build_array(pg_temp.integration('USD', '20009', ARRAY['web'], '00000000000000a9')))$q$, g), 'PAY05_MERCHANT_ALREADY_CONNECTED');
  -- M: garage B can never register garage A's integration
  PERFORM pg_temp.expect(format($q$SELECT pay05_register_paynow_merchant(%L, gen_random_uuid(), 'p5b-admin', 'P5B Garage', pg_temp.profile('P5B Auto Ltd'), jsonb_build_array(pg_temp.integration('USD', '20001', ARRAY['web'], '00000000000000b1')))$q$, g2), 'PAY05_INTEGRATION_ALREADY_REGISTERED');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay04_garage_merchant_accounts WHERE tenant_id = g2), 'the refused takeover left nothing behind');
  -- M: CarUp's Stripe (or any other gateway) can never be a garage merchant
  PERFORM pg_temp.expect(format($q$INSERT INTO pay04_garage_merchant_accounts (tenant_id, gateway, merchant_reference, display_name, currencies, status, authority_note, registered_by, registered_role) VALUES (%L, 'stripe_carup_japan_sandbox', 'pnm_00000000000000000000000000000000', 'CarUp Japan', ARRAY['USD'], 'verified', 'must never collect garage money', 'p5-op', 'admin')$q$, g2), 'pay05_merchant_gateway');

  -- C (before verification): an unverified merchant collects nothing
  v_inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 40.00);
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p5-cust', 40.00, 'USD', 'p5-pending-merchant-key', 1800)$q$, v_inv.id), 'PAY04_GARAGE_MERCHANT_NOT_AVAILABLE');

  -- V: independent reviewer only, complete evidence only
  v_evidence := jsonb_build_object('legal_identity_reviewed', true, 'settlement_account_reviewed', true,
    'currency_configuration_reviewed', true, 'credential_probes', jsonb_build_object(
    v_usd::text, jsonb_build_object('result', 'authenticated', 'credential_fingerprint', '00000000000000a1', 'probed_at', now()),
    v_zwg::text, jsonb_build_object('result', 'authenticated', 'credential_fingerprint', '00000000000000a2', 'probed_at', now())));
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5a-admin', 'admin', %L, 'self verification attempt')$q$, v_acct.id, v_evidence), 'PAY05_VERIFICATION_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'owner', %L, 'claimed role is not admin')$q$, v_acct.id, v_evidence), 'PAY05_VERIFICATION_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op-member', 'admin', %L, 'a platform admin who is a garage member')$q$, v_acct.id, v_evidence), 'PAY05_REVIEWER_SEPARATION_REQUIRED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'admin', %L, 'probe missing for ZWG')$q$, v_acct.id,
    v_evidence #- ARRAY['credential_probes', v_zwg::text]), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'admin', %L, 'probe of another key')$q$, v_acct.id,
    jsonb_set(v_evidence, ARRAY['credential_probes', v_usd::text, 'credential_fingerprint'], '"00000000000000ff"')), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'admin', %L, 'legal identity not reviewed')$q$, v_acct.id,
    jsonb_set(v_evidence, ARRAY['legal_identity_reviewed'], 'false')), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  -- Paynow's API reports no currency: the operator must have checked each integration's currency configuration
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'admin', %L, 'currency configuration not reviewed')$q$, v_acct.id,
    v_evidence - 'currency_configuration_reviewed'), 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'admin', %L, 'short')$q$, v_acct.id, v_evidence), 'PAY05_REASON_REQUIRED');
  PERFORM pay05_verify_paynow_merchant(v_acct.id, 'p5-op', 'admin', v_evidence, 'Legal name, settlement account and both credential probes reviewed.');
  PERFORM pg_temp.check((SELECT status FROM pay04_garage_merchant_accounts WHERE id = v_acct.id) = 'verified', 'merchant verified');
  PERFORM pg_temp.check((SELECT count(*) FROM pay05_merchant_integrations WHERE merchant_account_id = v_acct.id AND status = 'verified' AND verified_by = 'p5-op') = 2, 'integrations verified by the reviewer');
  PERFORM pg_temp.expect(format($q$SELECT pay05_verify_paynow_merchant(%L, 'p5-op', 'admin', %L, 'verifying twice is refused')$q$, v_acct.id, v_evidence), 'PAY05_MERCHANT_NOT_PENDING');
  SELECT count(*) INTO v_count FROM pay05_merchant_audit_events WHERE merchant_account_id = v_acct.id;
  PERFORM pg_temp.check(v_count = 6, format('audit: registered, 2 integrations, 2 verified, merchant verified (got %s)', v_count));
  PERFORM pg_temp.check((SELECT count(*) FROM trust_audit_events WHERE event_type LIKE 'PAYNOW_%' AND new_value->>'merchant_account_id' = v_acct.id::text) = 6, 'mirrored in the trust audit');
  -- V: credentials, profile and audit are immutable
  PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_integrations SET credential_ciphertext = 'QUFBQQ==' WHERE id = %L$q$, v_usd), 'PAY05_INTEGRATION_IMMUTABLE');
  PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_integrations SET integration_id = '29999' WHERE id = %L$q$, v_usd), 'PAY05_INTEGRATION_IMMUTABLE');
  PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_integrations SET verified_by = 'p5-out' WHERE id = %L$q$, v_usd), 'PAY05_INTEGRATION_IMMUTABLE');
  PERFORM pg_temp.expect(format($q$DELETE FROM pay05_merchant_integrations WHERE id = %L$q$, v_usd), 'PAY05_INTEGRATION_IMMUTABLE');
  PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_profiles SET settlement_account_last4 = '9999' WHERE merchant_account_id = %L$q$, v_acct.id), 'PAY04_APPEND_ONLY');
  PERFORM pg_temp.expect(format($q$UPDATE pay05_merchant_audit_events SET actor = 'x' WHERE merchant_account_id = %L$q$, v_acct.id), 'PAY04_APPEND_ONLY');
  PERFORM pg_temp.expect(format($q$UPDATE pay04_garage_merchant_accounts SET status = 'pending_verification' WHERE id = %L$q$, v_acct.id), 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE');
  PERFORM pg_temp.expect(format($q$UPDATE pay04_garage_merchant_accounts SET merchant_reference = 'pnm_ffffffffffffffffffffffffffffffff' WHERE id = %L$q$, v_acct.id), 'PAY04_MERCHANT_ACCOUNT_IMMUTABLE');
  -- the sealed key is never stored in plaintext form anywhere a role can read
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay05_merchant_integrations WHERE credential_ciphertext ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'), 'no plaintext key shape stored');
  RAISE NOTICE 'PAY05_PAYNOW_SMOKE M V PASS: garage-owned Paynow merchant, sealed per-currency integrations, independent verification with credential probes, immutable custody, CarUp Stripe refused';
END $$;

-- ═══════════════════════════ C, S ═══════════════════════════
DO $$
DECLARE
  g uuid; inv garage_invoices%ROWTYPE; inv2 garage_invoices%ROWTYPE; b jsonb; c1 uuid; c2 uuid; v_res jsonb; v_m record;
  v_pay payment_transactions%ROWTYPE; v_receipts int; v_disc uuid;
BEGIN
  SELECT tenant_id INTO g FROM tenant_users WHERE user_id = 'p5a-admin';
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 25.00);
  b := pay04_begin_garage_collection(inv.id, 'p5-cust', 25.00, 'USD', 'p5-c1-key-0001', 1800);
  c1 := pg_temp.collection(b);
  SELECT p.* INTO v_pay FROM payment_transactions p JOIN pay04_garage_collections c ON c.payment_reference = p.reference WHERE c.id = c1;
  PERFORM pg_temp.check(v_pay.gateway = 'paynow_zimbabwe' AND v_pay.status = 'pending' AND v_pay.pay02_funds_owner = 'garage_business_tenant'
    AND v_pay.pay02_commercial_category = 'category_b_third_party' AND v_pay.pay02_legal_beneficiary = 'tenant:' || g::text,
    'the canonical row is the garage''s third-party money through its own Paynow merchant');
  PERFORM pg_temp.expect(format($q$SELECT pay05_record_paynow_sending(%L, %L, 'onemoney', NULL)$q$, c1, pg_temp.trace(c1)), 'PAY05_METHOD_NOT_AVAILABLE');
  PERFORM pg_temp.expect(format($q$SELECT pay05_apply_paynow_observation(%L, 'poll', NULL, 'paid', 'Paid', 2500, %L, '1', %L)$q$, c1, v_pay.reference, pg_temp.pid(c1)), 'PAY05_COLLECTION_NOT_ATTACHED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_apply_paynow_observation(%L, 'status_update', NULL, 'paid', 'Paid', 2500, %L, '1', %L)$q$, c1, v_pay.reference, pg_temp.pid(c1)), 'PAY05_OBSERVATION_IDENTITY_INVALID');
  PERFORM pay05_record_paynow_sending(c1, pg_temp.trace(c1), 'web', NULL);
  v_res := pay05_record_paynow_sending(c1, 'AnotherTrace000000000000000000ZZ', 'ecocash', '077*****11');
  PERFORM pg_temp.check((v_res->>'replayed')::boolean AND v_res->'transaction'->>'merchant_trace' = pg_temp.trace(c1), 'one Paynow request per collection: a retry replays it');
  PERFORM pg_temp.expect(format($q$SELECT pay05_attach_paynow_collection(%L, 'WrongTrace0000000000000000000000', %L, %L, '{}')$q$, c1, pg_temp.poll(c1), pg_temp.pid(c1)), 'PAY05_TRACE_MISMATCH');
  PERFORM pg_temp.expect(format($q$SELECT pay05_attach_paynow_collection(%L, %L, %L, 'sim_pi_gar_x', '{}')$q$, c1, pg_temp.trace(c1), pg_temp.poll(c1)), 'PAY05_PROVIDER_REFERENCE_INVALID');
  PERFORM pay05_attach_paynow_collection(c1, pg_temp.trace(c1), pg_temp.poll(c1), pg_temp.pid(c1), jsonb_build_object('browser_url', 'http://127.0.0.1:5061/Payment/ConfirmPayment/x'));
  PERFORM pg_temp.check((SELECT provider_checkout_id = 'pn_trace_' || pg_temp.trace(c1) AND provider_payment_id = pg_temp.pid(c1) FROM pay04_garage_collections WHERE id = c1), 'bound once to its trace and poll URL');
  PERFORM pg_temp.check((SELECT pay01a_intent_id FROM payment_transactions WHERE reference = v_pay.reference) = pg_temp.pid(c1), 'canonical row carries the Paynow payment id');
  v_res := pay05_attach_paynow_collection(c1, pg_temp.trace(c1), pg_temp.poll(c1), pg_temp.pid(c1), '{}');
  PERFORM pg_temp.check((v_res->>'replayed')::boolean, 'attach replay');
  PERFORM pg_temp.expect(format($q$SELECT pay05_attach_paynow_collection(%L, %L, 'http://127.0.0.1:5061/Interface/CheckPayment/?guid=other', %L, '{}')$q$, c1, pg_temp.trace(c1), pg_temp.pid(c1)), 'PAY05_PROVIDER_REFERENCE_CHANGE_REFUSED');
  -- C: evidence for another payment or another reference is refused
  PERFORM pg_temp.expect(format($q$SELECT pay05_apply_paynow_observation(%L, 'poll', NULL, 'paid', 'Paid', 2500, %L, '1', 'pn_poll_%s')$q$, c1, v_pay.reference, repeat('a', 40)), 'PAY05_PROVIDER_BINDING_MISMATCH');
  PERFORM pg_temp.expect(format($q$SELECT pay05_apply_paynow_observation(%L, 'poll', NULL, 'paid', 'Paid', 2500, 'pay04_gar_someone-else', '1', %L)$q$, c1, pg_temp.pid(c1)), 'PAY05_PROVIDER_BINDING_MISMATCH');
  -- C: Created / Sent / escrow are not money; the room stays held
  PERFORM pg_temp.obs(c1, 'created');
  PERFORM pg_temp.obs(c1, 'sent');
  PERFORM pg_temp.obs(c1, 'awaiting_delivery', 'status_update', pg_temp.evt(1));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c1) = 'pending' AND v_m.provider_paid = 0 AND v_m.provider_reserved = 25.00 AND v_m.uncommitted_balance = 0,
    'escrow is not counted and keeps the room held');
  PERFORM pg_temp.check((SELECT provider_status FROM pay05_paynow_transactions WHERE collection_id = c1) = 'awaiting_delivery', 'the exact Paynow status is kept');
  PERFORM pg_temp.obs(c1, 'delivered', 'status_update', pg_temp.evt(2));
  PERFORM pg_temp.check(pg_temp.status(c1) = 'pending', 'Delivered (24 h window) is still not money');
  -- C: Paid counts with a receipt; the same signed update again is a duplicate; on another collection, a replay
  v_res := pg_temp.obs(c1, 'paid', 'status_update', pg_temp.evt(3));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c1) = 'paid' AND v_m.provider_paid = 25.00 AND v_m.payment_status = 'paid', 'Paid counts');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued' AND amount = 25.00) = 1, 'one live receipt');
  v_res := pg_temp.obs(c1, 'paid', 'status_update', pg_temp.evt(3));
  PERFORM pg_temp.check((v_res->>'duplicate_event')::boolean AND (SELECT count(*) FROM pay04_garage_payment_allocations WHERE collection_id = c1) = 1, 'duplicate: nothing re-applied');
  inv2 := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 30.00);
  c2 := pg_temp.collection(pay04_begin_garage_collection(inv2.id, 'p5-cust', 30.00, 'USD', 'p5-c2-key-0001', 1800));
  PERFORM pg_temp.send_attach(c2);
  PERFORM pg_temp.expect(format($q$SELECT pg_temp.obs(%L, 'paid', 'status_update', %L)$q$, c2, pg_temp.evt(3)), 'PAY05_EVENT_CROSS_COLLECTION_REPLAY');

  -- S: Disputed de-counts and holds the room; only Paynow's own Paid ends it
  SELECT count(*) INTO v_receipts FROM pay04_garage_provider_receipts WHERE collection_id = c1;
  PERFORM pg_temp.obs(c1, 'disputed', 'status_update', pg_temp.evt(4));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c1) = 'paid' AND pg_temp.open_disc(c1, 'provider_disputed') AND v_m.provider_paid = 0 AND v_m.provider_reserved = 25.00
    AND v_m.uncommitted_balance = 0, 'disputed money is neither counted nor free for another payment');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued'), 'the receipt is voided while disputed');
  SELECT id INTO v_disc FROM pay04_garage_payment_discrepancies WHERE collection_id = c1 AND discrepancy_type = 'provider_disputed' AND status = 'open';
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'provider_corrected', 'p5-op', 'admin', 'The operator thinks the dispute is over.')$q$, v_disc), 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER');
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'settled_off_platform', 'p5-op', 'admin', 'Not a valid closure for a dispute.')$q$, v_disc), 'PAY04_RESOLUTION_INVALID');
  PERFORM pg_temp.obs(c1, 'paid', 'status_update', pg_temp.evt(5));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(NOT pg_temp.open_disc(c1, 'provider_disputed') AND v_m.provider_paid = 25.00
    AND (SELECT resolution FROM pay04_garage_payment_discrepancies WHERE id = v_disc) = 'provider_corrected', 'Paynow''s Paid ends the dispute and the money counts again');
  PERFORM pg_temp.check((SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1 AND status = 'issued') = 1
    AND (SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c1) = v_receipts + 1, 'a new receipt for the money counted again');

  -- S: Refunded de-counts (Paynow cannot quantify it) and asks the operator to confirm; a later Paid is a review, not money
  PERFORM pg_temp.obs(c1, 'refunded', 'status_update', pg_temp.evt(6));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c1) = 'refunded' AND v_m.provider_paid = 0 AND v_m.uncommitted_balance = 25.00
    AND pg_temp.open_disc(c1, 'provider_refund_unquantified'), 'refunded: nothing counts and the operator is asked to confirm');
  SELECT id INTO v_disc FROM pay04_garage_payment_discrepancies WHERE collection_id = c1 AND discrepancy_type = 'provider_refund_unquantified' AND status = 'open';
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'acknowledged', 'p5a-admin', 'admin', 'The garage cannot close its own review.')$q$, v_disc), 'PAY04_RESOLUTION_AUTHORITY_REFUSED');
  PERFORM pay04_resolve_garage_payment_discrepancy(v_disc, 'acknowledged', 'p5-op', 'admin', 'Paynow merchant records show the full amount refunded.');
  PERFORM pg_temp.obs(c1, 'paid', 'status_update', pg_temp.evt(7));
  PERFORM pg_temp.check(pg_temp.status(c1) = 'refunded' AND pg_temp.open_disc(c1, 'provider_status_unrecognized'), 'a step backwards is a review, never applied');
  PERFORM pg_temp.obs(c1, 'unrecognized', 'poll');
  PERFORM pg_temp.check((SELECT observation_count FROM pay04_garage_payment_discrepancies WHERE collection_id = c1 AND discrepancy_type = 'provider_status_unrecognized' AND status = 'open') = 2,
    'an undocumented word is the same review, observed again');

  -- S: an amount mismatch is recorded and never applied; nothing counts while it is open
  PERFORM pg_temp.obs(c2, 'paid', 'status_update', pg_temp.evt(8), 2999);
  SELECT * INTO v_m FROM pay04_invoice_money(inv2.id);
  PERFORM pg_temp.check(pg_temp.status(c2) = 'pending' AND pg_temp.open_disc(c2, 'amount_mismatch') AND v_m.provider_paid = 0 AND v_m.provider_reserved = 30.00,
    'amount mismatch: recorded, not applied, room held');
  PERFORM pg_temp.obs(c2, 'paid', 'poll', NULL, 2999);
  PERFORM pg_temp.check((SELECT observation_count FROM pay04_garage_payment_discrepancies WHERE collection_id = c2 AND discrepancy_type = 'amount_mismatch' AND status = 'open') = 2,
    'the same wrong amount again is the same mismatch, observed again');
  -- (independent review D1) escrow AFTER Paid is a lagging read: recorded as a stale regression, never re-applied
  v_res := pg_temp.obs(c2, 'awaiting_delivery', 'poll', NULL, 2999);
  PERFORM pg_temp.check(v_res->>'ignored' = 'stale_regression'
    AND (SELECT observation_count FROM pay04_garage_payment_discrepancies WHERE collection_id = c2 AND discrepancy_type = 'amount_mismatch' AND status = 'open') = 2,
    'escrow after Paid changes nothing');
  RAISE NOTICE 'PAY05_PAYNOW_SMOKE C S PASS: one request per collection, bound attach, escrow is not money, Paid counts, replays refused, disputes hold until Paynow says Paid, refunds de-count for confirmation, regressions and mismatches are reviews';
END $$;

-- ═══════════════════════════ U, H, F ═══════════════════════════
DO $$
DECLARE
  g uuid; inv3 garage_invoices%ROWTYPE; inv4 garage_invoices%ROWTYPE; inv5 garage_invoices%ROWTYPE;
  c3 uuid; c4 uuid; c5 uuid; v_res jsonb; v_m record; v_disc uuid; v_payment uuid;
BEGIN
  SELECT tenant_id INTO g FROM tenant_users WHERE user_id = 'p5a-admin';
  -- F: Failed (the user cancelled on the handset) closes the payment and frees the room; money after close never counts
  inv3 := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 15.00);
  c3 := pg_temp.collection(pay04_begin_garage_collection(inv3.id, 'p5-cust', 15.00, 'USD', 'p5-c3-key-0001', 1800));
  PERFORM pg_temp.send_attach(c3, 'ecocash');
  PERFORM pg_temp.obs(c3, 'failed', 'status_update', pg_temp.evt(20));
  SELECT * INTO v_m FROM pay04_invoice_money(inv3.id);
  PERFORM pg_temp.check(pg_temp.status(c3) = 'cancelled' AND v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 15.00, 'Failed closes and frees the room');
  PERFORM pg_temp.obs(c3, 'paid', 'status_update', pg_temp.evt(21));
  SELECT * INTO v_m FROM pay04_invoice_money(inv3.id);
  PERFORM pg_temp.check(pg_temp.status(c3) = 'cancelled' AND pg_temp.open_disc(c3, 'provider_paid_after_close') AND v_m.provider_paid = 0, 'money after close: recorded for an operator, never counted');
  SELECT id INTO v_disc FROM pay04_garage_payment_discrepancies WHERE collection_id = c3 AND discrepancy_type = 'provider_paid_after_close' AND status = 'open';
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'provider_corrected', 'p5-op', 'admin', 'Not a valid closure for late money.')$q$, v_disc), 'PAY04_RESOLUTION_INVALID');
  PERFORM pay04_resolve_garage_payment_discrepancy(v_disc, 'settled_off_platform', 'p5-op', 'admin', 'The garage refunded the late EcoCash payment in its Paynow dashboard.');

  -- U: a request whose reply was lost: a stop never closes it, expiry cannot close it, two authenticated NotFound traces do
  inv4 := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 12.00);
  c4 := pg_temp.collection(pay04_begin_garage_collection(inv4.id, 'p5-cust', 12.00, 'USD', 'p5-c4-key-0001', 1));
  PERFORM pay05_record_paynow_sending(c4, pg_temp.trace(c4), 'ecocash', '077*****11');
  PERFORM pay05_mark_paynow_initiation(c4, 'unknown', 'reply not authenticated');
  v_res := pay04_cancel_garage_collection(c4, 'p5-cust', 'Customer stopped while the reply was lost');
  PERFORM pg_temp.check(v_res->>'payment_status' = 'pending' AND pg_temp.status(c4) = 'pending', 'a stop never closes an unresolved Paynow request');
  SELECT * INTO v_m FROM pay04_invoice_money(inv4.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 12.00, 'its room stays held');
  PERFORM pg_sleep(1.2);
  PERFORM pg_temp.expect(format($q$SELECT pay04_close_expired_unattached_collection(%L)$q$, c4), 'PAY05_INITIATION_UNRESOLVED');
  PERFORM pay05_record_paynow_trace_absent(c4);
  PERFORM pay05_record_paynow_trace_absent(c4);
  PERFORM pg_temp.check((SELECT initiation_state FROM pay05_paynow_transactions WHERE collection_id = c4) = 'unknown', 'two NotFound answers within a minute are not enough');
  -- simulated passage of a minute (disposable certification database only)
  UPDATE pay05_paynow_transactions SET first_trace_absent_at = first_trace_absent_at - interval '61 seconds' WHERE collection_id = c4;
  PERFORM pay05_record_paynow_trace_absent(c4);
  PERFORM pg_temp.check((SELECT initiation_state FROM pay05_paynow_transactions WHERE collection_id = c4) = 'traced_absent', 'authenticated absence a minute apart resolves it');
  PERFORM pay04_close_expired_unattached_collection(c4);
  SELECT * INTO v_m FROM pay04_invoice_money(inv4.id);
  PERFORM pg_temp.check(pg_temp.status(c4) = 'cancelled' AND v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 12.00, 'then, and only then, it closes');
  PERFORM pg_temp.expect(format($q$SELECT pay05_attach_paynow_collection(%L, %L, %L, %L, '{}')$q$, c4, pg_temp.trace(c4), pg_temp.poll(c4), pg_temp.pid(c4)), 'PAY05_COLLECTION_CLOSED');

  -- H: hold release — operator only, after expiry, with a FRESH authenticated unpaid read; late money is never double counted
  inv5 := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 20.00);
  c5 := pg_temp.collection(pay04_begin_garage_collection(inv5.id, 'p5-cust', 20.00, 'USD', 'p5-c5-key-0001', 1));
  PERFORM pg_temp.send_attach(c5, 'ecocash');
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op', 'admin', 'Customer abandoned the EcoCash prompt.')$q$, c5), 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ|PAY05_HOLD_NOT_RELEASABLE');
  PERFORM pg_sleep(1.2);
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op', 'admin', 'No authenticated read exists yet.')$q$, c5), 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ');
  -- an old read (simulated: an observation recorded 20 minutes ago) is not fresh
  INSERT INTO pay05_paynow_observations (tenant_id, collection_id, via, provider_status, raw_status, outcome, observed_at)
    VALUES (g, c5, 'poll', 'sent', 'Sent', 'applied', clock_timestamp() - interval '20 minutes');
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op', 'admin', 'Only a stale read exists.')$q$, c5), 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ');
  PERFORM pg_temp.obs(c5, 'sent');
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5a-admin', 'admin', 'The garage cannot release its own hold.')$q$, c5), 'PAY05_RELEASE_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op-member', 'admin', 'A garage member cannot release.')$q$, c5), 'PAY05_RELEASE_SELF_DEALING_REFUSED');
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op', 'admin', 'short')$q$, c5), 'PAY05_REASON_REQUIRED');
  SELECT * INTO v_m FROM pay04_invoice_money(inv5.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 20.00 AND v_m.uncommitted_balance = 0, 'held before the release');
  v_res := pay05_release_paynow_hold(c5, 'p5-op', 'admin', 'Customer abandoned the EcoCash prompt; Paynow shows it unpaid.');
  SELECT * INTO v_m FROM pay04_invoice_money(inv5.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 20.00 AND pg_temp.status(c5) = 'pending', 'released: room returns, the payment stays pending and watched');
  PERFORM pg_temp.check((pay05_release_paynow_hold(c5, 'p5-op', 'admin', 'Releasing twice is a replay.')->>'replayed')::boolean, 'release replay');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM pay04_garage_collection_events WHERE collection_id = c5 AND event_type = 'hold_released' AND actor = 'p5-op'), 'the release is in the collection history');
  -- the garage records the cash it was paid instead; then Paynow reports the abandoned request paid after all
  PERFORM garage_ops07_record_payment(g, inv5.id, 20.00, 'USD', 'cash', 'P5-CASH-1', now(), 'p5a-admin', 'p5-c5-cash');
  PERFORM pg_temp.obs(c5, 'paid', 'status_update', pg_temp.evt(30));
  SELECT * INTO v_m FROM pay04_invoice_money(inv5.id);
  PERFORM pg_temp.check(pg_temp.status(c5) = 'paid' AND v_m.paid_amount = 20.00 AND v_m.provider_paid = 0
    AND pg_temp.open_disc(c5, 'unallocated_provider_money'), 'late money after a release is unallocated provider money, never a double count');
  RAISE NOTICE 'PAY05_PAYNOW_SMOKE U H F PASS: Failed closes, money after close is a review, lost replies close only on authenticated absence, hold release is operator-only with a fresh unpaid read, late money is never double counted';
END $$;

-- ═══════════════════════════ R: independent-review remediation ═══════════════════════════
DO $$
DECLARE
  g uuid; inv garage_invoices%ROWTYPE; c uuid; t1 bigint; t2 bigint; t3 bigint; v_res jsonb; v_m record; v_disc uuid; v_ref text;
BEGIN
  SELECT tenant_id INTO g FROM tenant_users WHERE user_id = 'p5a-admin';

  -- R1 (D1): a read taken BEFORE the read CarUp already applied is superseded: recorded, never applied
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 11.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 11.00, 'USD', 'p5-r1-key-0001', 1800));
  PERFORM pg_temp.send_attach(c, 'ecocash');
  t1 := pay05_begin_paynow_read(c);      -- the customer's check starts (Paynow will say Sent)
  t2 := pay05_begin_paynow_read(c);      -- Paynow's status update triggers a poll (Paynow says Paid)
  PERFORM pg_temp.check(t2 > t1, 'read tickets increase');
  PERFORM pg_temp.obs_t(c, 'paid', t2);
  v_res := pg_temp.obs_t(c, 'sent', t1);
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_res->>'ignored' = 'superseded' AND pg_temp.status(c) = 'paid' AND v_m.provider_paid = 11.00
    AND NOT pg_temp.open_disc(c, 'provider_status_unrecognized')
    AND (SELECT provider_status FROM pay05_paynow_transactions WHERE collection_id = c) = 'paid', 'a stale read applied late changes nothing');
  PERFORM pg_temp.check((SELECT outcome FROM pay05_paynow_observations WHERE collection_id = c ORDER BY seq DESC LIMIT 1) = 'superseded', 'recorded as superseded');
  -- R2 (D1): a LATER read that says Sent after Paid (a lagging replica) is a stale regression: recorded, never applied
  v_res := pg_temp.obs_t(c, 'sent', pay05_begin_paynow_read(c));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_res->>'ignored' = 'stale_regression' AND pg_temp.status(c) = 'paid' AND v_m.provider_paid = 11.00
    AND NOT pg_temp.open_disc(c, 'provider_status_unrecognized'), 'Sent after Paid never reverses counted money');
  -- R3 (D1): a Paid read taken before the dispute was read cannot end the dispute
  t1 := pay05_begin_paynow_read(c);
  t2 := pay05_begin_paynow_read(c);
  PERFORM pg_temp.obs_t(c, 'disputed', t2);
  v_res := pg_temp.obs_t(c, 'paid', t1);
  PERFORM pg_temp.check(v_res->>'ignored' = 'superseded' AND pg_temp.open_disc(c, 'provider_disputed'), 'the stale Paid is superseded; the dispute stays open');
  -- R4 (D1): an amount-mismatched Paid cannot satisfy the operator's dispute gate; Paynow's own correct Paid ends it
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c), 'poll', 999);
  SELECT id INTO v_disc FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'provider_disputed' AND status = 'open';
  PERFORM pg_temp.expect(format($q$SELECT pay04_resolve_garage_payment_discrepancy(%L, 'provider_corrected', 'p5-op', 'admin', 'A mismatched Paid is not the end of the dispute.')$q$, v_disc), 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER');
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c));
  PERFORM pg_temp.check(NOT pg_temp.open_disc(c, 'provider_disputed') AND pg_temp.open_disc(c, 'amount_mismatch'),
    'Paynow''s correct Paid ends the dispute; the mismatch it saw stays for the operator');

  -- R5 (P1/D2/S2): Paynow refused the request (an unsigned Error), the payment closed; then Paynow's SIGNED Paid arrives:
  --     bound late, recorded, an operator review opened; never counted
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 13.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 13.00, 'USD', 'p5-r5-key-0001', 1800));
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c;
  PERFORM pay05_record_paynow_sending(c, pg_temp.trace(c), 'ecocash', '077*****11');
  PERFORM pay05_mark_paynow_initiation(c, 'refused', 'Paynow: Invalid amount');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c) = 'cancelled' AND v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 13.00, 'a refusal closes the payment and frees the room');
  PERFORM pg_temp.expect(format($q$SELECT pay05_attach_paynow_collection(%L, %L, %L, %L, '{}', %L)$q$, c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c), v_ref), 'PAY05_COLLECTION_CLOSED');
  v_res := pay05_attach_paynow_collection(c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c), '{}', v_ref, true);
  PERFORM pg_temp.check((v_res->>'attached_after_close')::boolean, 'a signed late update binds the closed request');
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_paid_after_close') AND v_m.provider_paid = 0 AND pg_temp.status(c) = 'cancelled',
    'late money on a refused request: an operator review, never counted');
  -- ... and the same for a request traced absent and closed
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 13.50);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 13.50, 'USD', 'p5-r5b-key-0001', 1));
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c;
  PERFORM pay05_record_paynow_sending(c, pg_temp.trace(c), 'ecocash', '077*****11');
  PERFORM pay05_mark_paynow_initiation(c, 'unknown', 'reply lost');
  PERFORM pay05_record_paynow_trace_absent(c);
  UPDATE pay05_paynow_transactions SET first_trace_absent_at = first_trace_absent_at - interval '61 seconds' WHERE collection_id = c;
  PERFORM pay05_record_paynow_trace_absent(c);
  PERFORM pg_sleep(1.2);
  PERFORM pay04_close_expired_unattached_collection(c);
  PERFORM pay05_attach_paynow_collection(c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c), '{}', v_ref, true);
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c));
  PERFORM pg_temp.check(pg_temp.open_disc(c, 'provider_paid_after_close') AND (SELECT provider_paid FROM pay04_invoice_money(inv.id)) = 0,
    'late money on a request traced absent: an operator review, never counted');

  -- R6 (S1): a stop races the request, then Paynow refuses it: the payment closes (never pending forever)
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 14.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 14.00, 'USD', 'p5-r6-key-0001', 1800));
  PERFORM pay05_record_paynow_sending(c, pg_temp.trace(c), 'ecocash', '077*****11');
  PERFORM pay04_cancel_garage_collection(c, 'p5-cust', 'Customer stopped while the request was being sent');
  PERFORM pg_temp.check(pg_temp.status(c) = 'pending', 'the stop alone never closes an unresolved request');
  PERFORM pay05_mark_paynow_initiation(c, 'refused', 'Paynow: Invalid amount');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c) = 'cancelled' AND v_m.provider_reserved = 0, 'the refusal closes it');

  -- R7 (P2): a request Paynow never confirmed and a trace that keeps failing: after expiry and a fresh trace attempt the
  --     operator can release it; Paynow's late Paid then counts only into free room
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 16.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 16.00, 'USD', 'p5-r7-key-0001', 1));
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c;
  PERFORM pay05_record_paynow_sending(c, pg_temp.trace(c), 'ecocash', '077*****11');
  PERFORM pay05_mark_paynow_initiation(c, 'unknown', 'reply lost');
  PERFORM pg_sleep(1.2);
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op', 'admin', 'No trace was attempted yet.')$q$, c), 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_TRACE');
  PERFORM pay05_record_paynow_trace_failed(c);
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op-member', 'admin', 'A garage member cannot release.')$q$, c), 'PAY05_RELEASE_SELF_DEALING_REFUSED');
  v_res := pay05_release_paynow_hold(c, 'p5-op', 'admin', 'Paynow trace keeps failing; the customer will pay in cash.');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 16.00 AND pg_temp.status(c) = 'pending', 'released: room returns, still watched');
  PERFORM pay05_attach_paynow_collection(c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c), '{}', v_ref);
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c) = 'paid' AND v_m.provider_paid = 16.00, 'late money counts into the free room');

  -- R8 (S7, S6): a reply for another reference is refused; an early attach keeps the reply's data when the reply lands
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 17.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 17.00, 'USD', 'p5-r8-key-0001', 1800));
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c;
  PERFORM pay05_record_paynow_sending(c, pg_temp.trace(c), 'innbucks', '077*****11');
  PERFORM pg_temp.expect(format($q$SELECT pay05_attach_paynow_collection(%L, %L, %L, %L, '{}', 'pay04_gar_someone-else')$q$, c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c)), 'PAY05_PROVIDER_BINDING_MISMATCH');
  PERFORM pay05_attach_paynow_collection(c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c), jsonb_build_object('recovered_by_trace', true), v_ref);
  PERFORM pay05_attach_paynow_collection(c, pg_temp.trace(c), pg_temp.poll(c), pg_temp.pid(c),
    jsonb_build_object('authorization_code', 'AB12CD34', 'authorization_expires', '2-Nov-2026 18:00'), v_ref);
  PERFORM pg_temp.check((SELECT authorization_code = 'AB12CD34' AND authorization_expires = '2-Nov-2026 18:00' FROM pay05_paynow_transactions WHERE collection_id = c),
    'the late reply fills what the early attach could not know');

  -- R9 (D3a): an amount mismatch the operator settles outside CarUp frees the room; the same report later opens nothing new
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 18.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 18.00, 'USD', 'p5-r9-key-0001', 1800));
  PERFORM pg_temp.send_attach(c, 'ecocash');
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c), 'poll', 1799);
  SELECT id INTO v_disc FROM pay04_garage_payment_discrepancies WHERE collection_id = c AND discrepancy_type = 'amount_mismatch' AND status = 'open';
  PERFORM pay04_resolve_garage_payment_discrepancy(v_disc, 'settled_off_platform', 'p5-op', 'admin', 'The garage refunded the wrong amount in Paynow; the customer pays again.');
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(v_m.provider_reserved = 0 AND v_m.uncommitted_balance = 18.00
    AND (SELECT settled_off_platform_at IS NOT NULL FROM pay05_paynow_transactions WHERE collection_id = c), 'settled: the room returns');
  v_res := pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c), 'poll', 1799);
  PERFORM pg_temp.check(v_res->>'ignored' = 'after_settlement' AND NOT pg_temp.open_disc(c, 'amount_mismatch'), 'the same report after settlement opens nothing new');

  -- R10 (D3b): Refunded with no parseable amount is applied (never rolled back) and reviewed
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 19.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 19.00, 'USD', 'p5-r10-key-0001', 1800));
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c;
  PERFORM pg_temp.send_attach(c, 'ecocash');
  PERFORM pg_temp.obs_t(c, 'paid', pay05_begin_paynow_read(c));
  PERFORM pay05_apply_paynow_observation(c, 'poll', NULL, 'refunded', 'Refunded', NULL, v_ref, '9510', pg_temp.pid(c), NULL, pay05_begin_paynow_read(c));
  SELECT * INTO v_m FROM pay04_invoice_money(inv.id);
  PERFORM pg_temp.check(pg_temp.status(c) = 'refunded' AND v_m.provider_paid = 0 AND pg_temp.open_disc(c, 'provider_refund_unquantified'),
    'refunded without an amount: applied and reviewed');

  -- R11 (D4): the PAY-04 simulator-path writers refuse Paynow rows
  PERFORM pg_temp.expect(format($q$SELECT pay04_request_garage_collection_refund(%L, 'p5a-admin', 'Refund through the simulator path')$q$, c), 'PAY05_USE_PAYNOW_PATH');
  PERFORM pg_temp.expect(format($q$SELECT pay04_suspend_garage_merchant_account(%L, 'p5-op', 'admin', 'Suspend through the simulator path')$q$,
    (SELECT merchant_account_id FROM pay04_garage_collections WHERE id = c)), 'PAY05_USE_PAYNOW_PATH');

  -- R12 (D5): the availability switch also stops a begun collection from being sent
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 21.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 21.00, 'USD', 'p5-r12-key-0001', 1800));
  PERFORM pay05_set_paynow_availability(false, 'p5-op', 'admin', 'Paynow incident: collections paused.');
  PERFORM pg_temp.expect(format($q$SELECT pay05_record_paynow_sending(%L, %L, 'web', NULL)$q$, c, pg_temp.trace(c)), 'PAY04_GATEWAY_NOT_PERMITTED');
  PERFORM pay05_set_paynow_availability(true, 'p5-op', 'admin', 'Paynow incident over: collections resumed.');
  PERFORM pay04_cancel_garage_collection(c, 'p5-cust', 'Not sent during the incident');

  -- R13 (D6): release freshness reads the LATEST read of any kind: fresh escrow money from a status update blocks it
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 22.00);
  c := pg_temp.collection(pay04_begin_garage_collection(inv.id, 'p5-cust', 22.00, 'USD', 'p5-r13-key-0001', 1));
  PERFORM pg_temp.send_attach(c, 'ecocash');
  PERFORM pg_temp.obs_t(c, 'sent', pay05_begin_paynow_read(c));
  PERFORM pg_temp.obs(c, 'awaiting_delivery', 'status_update', pg_temp.evt(40));
  PERFORM pg_sleep(1.2);
  PERFORM pg_temp.expect(format($q$SELECT pay05_release_paynow_hold(%L, 'p5-op', 'admin', 'Escrow money must not be released.')$q$, c), 'PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ');

  -- R14 (S5): repeated identical provider errors within a minute are recorded once
  PERFORM pay05_record_provider_error('callback_signature_invalid', g, c, NULL, '{"code":"PAY05_CALLBACK_SIGNATURE_INVALID"}');
  PERFORM pay05_record_provider_error('callback_signature_invalid', g, c, NULL, '{"code":"PAY05_CALLBACK_SIGNATURE_INVALID"}');
  PERFORM pg_temp.check((SELECT count(*) FROM pay05_provider_errors WHERE collection_id = c AND kind = 'callback_signature_invalid') = 1,
    'one row per collection and kind per minute');
  RAISE NOTICE 'PAY05_PAYNOW_SMOKE R PASS: stale reads superseded, regressions ignored, disputes end only on a correct Paid, refused and unconfirmed requests close, late signed money reviewed, operator release of unconfirmed requests, early attach keeps reply data, settlement frees the room, amountless Refunded applied, PAY-04 writers refuse Paynow, availability stops sending, release freshness reads every source, provider errors throttled';
END $$;

-- ═══════════════════════════ O, least privilege ═══════════════════════════
DO $$
DECLARE g uuid; v_acct uuid; inv garage_invoices%ROWTYPE; v_res jsonb; v_role text;
BEGIN
  SELECT tenant_id INTO g FROM tenant_users WHERE user_id = 'p5a-admin';
  SELECT id INTO v_acct FROM pay04_garage_merchant_accounts WHERE tenant_id = g AND gateway = 'paynow_zimbabwe';
  inv := pg_temp.invoice(g, 'p5a', 'PAY05PAYNOWVIN0001', 'p5-cust', 10.00);
  -- O: availability is the operator's switch
  PERFORM pg_temp.expect($q$SELECT pay05_set_paynow_availability(false, 'p5a-admin', 'admin', 'Garage cannot switch Paynow off.')$q$, 'PAY05_AVAILABILITY_AUTHORITY_REFUSED');
  PERFORM pay05_set_paynow_availability(false, 'p5-op', 'admin', 'Paynow incident: collections paused.');
  PERFORM pg_temp.check(NOT pay04_gateway_permitted('paynow_zimbabwe'), 'gateway off');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p5-cust', 10.00, 'USD', 'p5-off-key-0001', 1800)$q$, inv.id), 'PAY04_GATEWAY_NOT_PERMITTED');
  PERFORM pay05_set_paynow_availability(true, 'p5-op', 'admin', 'Paynow incident over: collections resumed.');
  PERFORM pg_temp.check(pay04_gateway_permitted('paynow_zimbabwe') AND pay04_gateway_permitted('pay04_garage_provider_simulator') IS NOT NULL, 'gateway on');
  -- O: the garage disconnects its own account; nothing collects through it afterwards
  PERFORM pg_temp.expect(format($q$SELECT pay05_suspend_paynow_merchant(%L, 'p5-out', 'owner', 'An outsider cannot disconnect.')$q$, v_acct), 'PAY05_MERCHANT_AUTHORITY_REFUSED');
  v_res := pay05_suspend_paynow_merchant(v_acct, 'p5a-admin', 'owner', 'The garage is changing its Paynow account.');
  PERFORM pg_temp.check((SELECT status FROM pay04_garage_merchant_accounts WHERE id = v_acct) = 'suspended'
    AND NOT EXISTS (SELECT 1 FROM pay05_merchant_integrations WHERE merchant_account_id = v_acct AND status IN ('pending_verification', 'verified')),
    'merchant and integrations suspended');
  PERFORM pg_temp.check((pay05_suspend_paynow_merchant(v_acct, 'p5-op', 'admin', 'Suspending twice is a replay.')->>'replayed')::boolean, 'suspend replay');
  PERFORM pg_temp.expect(format($q$SELECT pay04_begin_garage_collection(%L, 'p5-cust', 10.00, 'USD', 'p5-susp-key-0001', 1800)$q$, inv.id), 'PAY04_GARAGE_MERCHANT_NOT_AVAILABLE');
  -- least privilege: no API role reads a PAY-05 table or calls a PAY-05 writer; the backend only reads
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.check(NOT has_table_privilege(v_role, 'public.pay05_merchant_integrations', 'SELECT')
      AND NOT has_table_privilege(v_role, 'public.pay05_paynow_transactions', 'SELECT')
      AND NOT has_table_privilege(v_role, 'public.pay05_provider_errors', 'SELECT')
      AND NOT has_function_privilege(v_role, 'public.pay05_apply_paynow_observation(uuid,text,text,text,text,bigint,text,text,text,text,bigint)', 'EXECUTE')
      AND NOT has_function_privilege(v_role, 'public.pay05_begin_paynow_read(uuid)', 'EXECUTE')
      AND NOT has_function_privilege(v_role, 'public.pay05_record_paynow_trace_failed(uuid)', 'EXECUTE')
      AND NOT has_function_privilege(v_role, 'public.pay05_release_paynow_hold(uuid,text,text,text)', 'EXECUTE'), v_role || ' has no PAY-05 access');
  END LOOP;
  PERFORM pg_temp.check(has_table_privilege('service_role', 'public.pay05_merchant_integrations', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.pay05_merchant_integrations', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.pay05_paynow_observations', 'INSERT')
    AND has_function_privilege('service_role', 'public.pay05_apply_paynow_observation(uuid,text,text,text,text,bigint,text,text,text,text,bigint)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.pay05_begin_paynow_read(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.pay05_hold_released(uuid)', 'EXECUTE'), 'service_role reads and calls writers only');
  PERFORM pg_temp.check((SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname LIKE 'pay05\_%' AND relkind = 'r'), 'RLS on every PAY-05 table');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'pay05\_%' AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')), 'every SECURITY DEFINER function pins search_path');
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = false;
  RAISE NOTICE 'PAY05_PAYNOW_SMOKE O PASS: operator availability switch, garage disconnect, least privilege, pinned search_path, real Paynow off by constraint';
END $$;

DO $$ BEGIN RAISE NOTICE 'PAY05_PAYNOW_COLLECTIONS_POSTGRES_SMOKE_PASS: garage-owned Paynow merchants, sealed credentials, independent verification, Paynow statuses kept distinct on the canonical ledger, reviews instead of guesses, no double count'; END $$;
