-- CARUP-PAY-05-R1 upgrade path: rows made by PAY-05's OWN writers, BEFORE the R1 migration exists on this database.
-- scripts/ci/pay05-postgres-certification.sh fingerprints them, applies R1, and requires them unchanged.
DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN RAISE EXCEPTION 'PAY05_R1_DB_IDENTITY_REFUSED: %', current_database(); END IF;
END $$;

DO $$
DECLARE
  v_tenant uuid; v_branch uuid; v_profile uuid; v_case uuid; v_wo uuid; v_rec uuid; v_acct uuid; v_inv uuid; v_inv2 uuid; c uuid; c2 uuid;
  v_probes jsonb; v_lines jsonb; v_ref text; v_pid text;
BEGIN
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = true, paynow_available = true WHERE singleton;
  INSERT INTO users (id, name, email, role, join_date) VALUES
    ('r1u-admin', 'r1u-admin', 'r1u-admin@example.invalid', 'owner', '2026-01-01'), ('r1u-mech', 'r1u-mech', 'r1u-mech@example.invalid', 'owner', '2026-01-01'),
    ('r1u-cust', 'r1u-cust', 'r1u-cust@example.invalid', 'owner', '2026-01-01'), ('r1u-op', 'r1u-op', 'r1u-op@example.invalid', 'admin', '2026-01-01');
  INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id) VALUES ('PAY05R1UPGRADEVIN1', 'Toyota', 'Hilux', 2020, 60000, 1000, 'r1u-cust');
  INSERT INTO tenants (name, type, status) VALUES ('R1U Garage', 'garage', 'active') RETURNING id INTO v_tenant;
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (v_tenant, 'r1u-admin', 'admin'), (v_tenant, 'r1u-mech', 'admin');
  INSERT INTO garage_branches (tenant_id, name, branch_code, timezone, is_active) VALUES (v_tenant, 'R1U Central', 'R1U-C', 'Africa/Harare', true) RETURNING id INTO v_branch;
  INSERT INTO garage_workforce_profiles (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
    VALUES (v_tenant, 'r1u-mech', 'R1U-M', 'employee', 'active', '2026-10-01', 'r1u-admin') RETURNING id INTO v_profile;
  INSERT INTO garage_workforce_branch_assignments (tenant_id, workforce_profile_id, branch_id, is_primary, assigned_by_user_id) VALUES (v_tenant, v_profile, v_branch, true, 'r1u-admin');
  UPDATE tenant_users SET role = 'mechanic' WHERE tenant_id = v_tenant AND user_id = 'r1u-mech';
  -- PAY-05's own merchant registration and verification: no probe at connect and no per-currency evidence existed then
  v_acct := ((pay05_register_paynow_merchant(v_tenant, gen_random_uuid(), 'r1u-admin', 'R1U Garage',
    jsonb_build_object('legal_entity_name', 'R1U Motors (Pvt) Ltd', 'registration_number', '1234/2026', 'settlement_bank_name', 'CBZ Bank', 'settlement_account_last4', '4321',
      'settlement_account_holder', 'R1U Motors (Pvt) Ltd', 'attestation', 'I confirm this Paynow merchant account and its settlement account belong to this garage business.'),
    jsonb_build_array(jsonb_build_object('currency', 'USD', 'integration_id', '60001', 'mode', 'simulator', 'methods', jsonb_build_array('web', 'ecocash'),
      'ciphertext', 'U0VBTEVELUtFWS1GSVhUVVJFLU5PVC1BLUtFWQ==', 'iv', 'AAECAwQFBgcICQoL', 'tag', 'AAECAwQFBgcICQoLDA0ODw==', 'key_version', 1, 'fingerprint', '0000000000060001'))))->'merchant'->>'id')::uuid;
  SELECT jsonb_object_agg(id::text, jsonb_build_object('result', 'authenticated', 'credential_fingerprint', credential_fingerprint, 'probed_at', now())) INTO v_probes
    FROM pay05_merchant_integrations WHERE merchant_account_id = v_acct;
  PERFORM pay05_verify_paynow_merchant(v_acct, 'r1u-op', 'admin', jsonb_build_object('legal_identity_reviewed', true, 'settlement_account_reviewed', true,
    'currency_configuration_reviewed', true, 'credential_probes', v_probes), 'Reviewed under PAY-05, before R1.');
  FOR i IN 1..2 LOOP
    INSERT INTO service_cases (vin, garage_tenant_id, branch_id, requester_user_id, status) VALUES ('PAY05R1UPGRADEVIN1', v_tenant, v_branch, 'r1u-cust', 'accepted') RETURNING id INTO v_case;
    INSERT INTO mechanic_work_orders (tenant_id, vin, customer_id, service_case_id, branch_id, status, owner_authorization)
      VALUES (v_tenant, 'PAY05R1UPGRADEVIN1', 'r1u-cust', v_case, v_branch, 'In Progress', 'pending') RETURNING id INTO v_wo;
    PERFORM mechanic_work_order_decide_authorization(v_wo, 'PAY05R1UPGRADEVIN1', 'r1u-cust', 'owner', NULL, 'owner', 'authorized', NULL);
    INSERT INTO work_order_assignments (work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id) VALUES (v_wo, v_tenant, 'r1u-mech', 'r1u-admin');
    UPDATE service_cases SET status = 'active' WHERE id = v_case;
    INSERT INTO service_records (work_order_id, service_case_id, tenant_id, vin, work_performed, service_authority, total_cost, currency, recorded_by_user_id, performed_at)
      VALUES (v_wo, v_case, v_tenant, 'PAY05R1UPGRADEVIN1', 'Service', 'garage_stated', 40.00, 'USD', 'r1u-mech', now()) RETURNING id INTO v_rec;
    PERFORM garage_ops05_complete_job(v_tenant, v_case, 'r1u-admin');
    v_lines := jsonb_build_array(jsonb_build_object('category', 'labour', 'description', 'Workshop service', 'quantity', 1, 'unit_price', 40.00, 'source_kind', 'service_record', 'source_id', v_rec));
    IF i = 1 THEN SELECT id INTO v_inv FROM garage_ops07_issue_invoice(v_tenant, v_wo, 'USD', v_lines, NULL, NULL, NULL, 'r1u-admin');
    ELSE SELECT id INTO v_inv2 FROM garage_ops07_issue_invoice(v_tenant, v_wo, 'USD', v_lines, NULL, NULL, NULL, 'r1u-admin'); END IF;
  END LOOP;
  -- one payment counted by PAY-05; one request still in flight when R1 arrives
  c := (pay04_begin_garage_collection(v_inv, 'r1u-cust', 40.00, 'USD', 'r1u-key-0000001', 1800)->'collection'->>'id')::uuid;
  PERFORM pay05_record_paynow_sending(c, left(replace(c::text, '-', ''), 32), 'ecocash', NULL);
  v_pid := 'pn_poll_' || left(encode(sha256(convert_to('http://127.0.0.1:5061/Interface/CheckPayment/?guid=' || c::text, 'UTF8')), 'hex'), 40);
  PERFORM pay05_attach_paynow_collection(c, left(replace(c::text, '-', ''), 32), 'http://127.0.0.1:5061/Interface/CheckPayment/?guid=' || c::text, v_pid, jsonb_build_object('paynow_reference', '9510'));
  SELECT payment_reference INTO v_ref FROM pay04_garage_collections WHERE id = c;
  PERFORM pay05_apply_paynow_observation(c, 'poll', NULL, 'paid', 'Paid', 4000, v_ref, '9510', v_pid);
  c2 := (pay04_begin_garage_collection(v_inv2, 'r1u-cust', 40.00, 'USD', 'r1u-key-0000002', 1800)->'collection'->>'id')::uuid;
  PERFORM pay05_record_paynow_sending(c2, left(replace(c2::text, '-', ''), 32), 'ecocash', NULL);
  v_pid := 'pn_poll_' || left(encode(sha256(convert_to('http://127.0.0.1:5061/Interface/CheckPayment/?guid=' || c2::text, 'UTF8')), 'hex'), 40);
  PERFORM pay05_attach_paynow_collection(c2, left(replace(c2::text, '-', ''), 32), 'http://127.0.0.1:5061/Interface/CheckPayment/?guid=' || c2::text, v_pid, jsonb_build_object('paynow_reference', '9510'));
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = false WHERE singleton;
  RAISE NOTICE 'PAY05_R1_UPGRADE_SEED_READY';
END $$;
