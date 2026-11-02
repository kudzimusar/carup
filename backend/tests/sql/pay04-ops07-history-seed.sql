-- CARUP-PAY-04-LR01 — pre-PAY-04 Garage OPS07 history, created ONLY through the certified OPS07 functions.
--
-- scripts/ci/pay04-postgres-certification.sh runs this BEFORE the PAY-04 migrations, fingerprints every OPS07 row and
-- every invoice balance, applies PAY-04, and proves the fingerprint is unchanged: PAY-04 never rewrites an invoice, a
-- payment record, a receipt or an event, and the derived balance of an invoice without provider money is identical.
--
-- History built here (garage "PAY04 History Garage"):
--   INV-000001  USD 170.50  cash 100.00 (receipt), bank 70.50 (receipt)          -> paid
--               (one LEGACY manual 'part' line: OPS07 allowed it; PAY-04 must keep it, untouched)
--   INV-000002  USD 210.00  mobile 50.00, that payment reversed (receipt voided)  -> unpaid
--   INV-000003  USD  90.00  voided with no money against it                        -> voided
--   INV-000004  USD  90.00  re-issued for the voided job, card_external 40.00     -> partially_paid
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY04_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
  IF to_regprocedure('public.garage_ops07_issue_invoice(uuid,uuid,text,jsonb,text,text,date,text)') IS NULL THEN
    RAISE EXCEPTION 'PAY04_SEED_REQUIRES_OPS07';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE name = 'PAY04 History Garage') THEN
    RAISE EXCEPTION 'PAY04_SEED_ALREADY_APPLIED';
  END IF;
END $$;

DO $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_profile uuid;
  v_job int;
  v_case uuid;
  v_wo uuid;
  v_inv garage_invoices%ROWTYPE;
  v_pay jsonb;
  v_lines jsonb := '[{"category":"labour","description":"Brake service","quantity":2,"unit_price":45},'
                   '{"category":"part","description":"Front pads","quantity":1,"unit_price":80.5}]';
  v_cases uuid[] := '{}';
  v_wos uuid[] := '{}';
BEGIN
  INSERT INTO users (id, name, email, role, join_date) VALUES
    ('p4h-admin', 'p4h-admin', 'p4h-admin@example.invalid', 'owner', '2026-01-01'),
    ('p4h-mech', 'p4h-mech', 'p4h-mech@example.invalid', 'owner', '2026-01-01'),
    ('p4h-customer', 'p4h-customer', 'p4h-customer@example.invalid', 'owner', '2026-01-01');
  INSERT INTO tenants (name, type, status) VALUES ('PAY04 History Garage', 'garage', 'active') RETURNING id INTO v_tenant;
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (v_tenant, 'p4h-admin', 'admin'), (v_tenant, 'p4h-mech', 'admin');
  INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id)
    VALUES ('PAY04HISTVIN000001', 'Toyota', 'Corolla', 2020, 50000, 1000, 'p4h-customer');
  INSERT INTO garage_branches (tenant_id, name, branch_code, timezone, is_active)
    VALUES (v_tenant, 'History Central', 'P4H-CENTRAL', 'Africa/Harare', true) RETURNING id INTO v_branch;
  INSERT INTO garage_workforce_profiles (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
    VALUES (v_tenant, 'p4h-mech', 'P4H-MECH', 'employee', 'active', '2026-10-01', 'p4h-admin') RETURNING id INTO v_profile;
  INSERT INTO garage_workforce_branch_assignments (tenant_id, workforce_profile_id, branch_id, is_primary, assigned_by_user_id)
    VALUES (v_tenant, v_profile, v_branch, true, 'p4h-admin');
  UPDATE tenant_users SET role = 'mechanic' WHERE tenant_id = v_tenant AND user_id = 'p4h-mech';

  -- three completed, owner-authorized jobs
  FOR v_job IN 1..3 LOOP
    INSERT INTO service_cases (vin, garage_tenant_id, branch_id, requester_user_id, status)
      VALUES ('PAY04HISTVIN000001', v_tenant, v_branch, 'p4h-customer', 'accepted') RETURNING id INTO v_case;
    INSERT INTO mechanic_work_orders (tenant_id, vin, customer_id, service_case_id, branch_id, status, owner_authorization)
      VALUES (v_tenant, 'PAY04HISTVIN000001', 'p4h-customer', v_case, v_branch, 'In Progress', 'pending') RETURNING id INTO v_wo;
    PERFORM mechanic_work_order_decide_authorization(v_wo, 'PAY04HISTVIN000001', 'p4h-customer', 'owner', NULL, 'owner', 'authorized', NULL);
    INSERT INTO work_order_assignments (work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
      VALUES (v_wo, v_tenant, 'p4h-mech', 'p4h-admin');
    UPDATE service_cases SET status = 'active' WHERE id = v_case;
    INSERT INTO service_records (work_order_id, service_case_id, tenant_id, vin, work_performed, service_authority, total_cost, currency, recorded_by_user_id, performed_at)
      VALUES (v_wo, v_case, v_tenant, 'PAY04HISTVIN000001', 'Brakes', 'garage_stated', 105, 'USD', 'p4h-mech', now());
    PERFORM garage_ops05_complete_job(v_tenant, v_case, 'p4h-admin');
    v_cases := v_cases || v_case;
    v_wos := v_wos || v_wo;
  END LOOP;

  -- INV-000001: paid in two declared payments
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(v_tenant, v_wos[1], 'USD', v_lines, 'Thank you', 'history', NULL, 'p4h-admin');
  PERFORM garage_ops07_record_payment(v_tenant, v_inv.id, 100, 'USD', 'cash', 'till 4', now() - interval '2 hours', 'p4h-admin', 'p4h-history-pay-0001');
  PERFORM garage_ops07_record_payment(v_tenant, v_inv.id, 70.5, 'USD', 'bank_transfer', 'BT-889', now() - interval '1 hour', 'p4h-admin', 'p4h-history-pay-0002');

  -- INV-000002: a recorded payment, then reversed (its receipt is voided)
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(v_tenant, v_wos[2], 'USD',
    '[{"category":"labour","description":"Suspension","quantity":3,"unit_price":70}]', NULL, NULL, NULL, 'p4h-admin');
  v_pay := garage_ops07_record_payment(v_tenant, v_inv.id, 50, 'USD', 'mobile_money', 'EC-1', now() - interval '30 minutes', 'p4h-admin', 'p4h-history-pay-0003');
  PERFORM garage_ops07_reverse_payment(v_tenant, (v_pay->>'payment_id')::uuid, 'Recorded against the wrong job', 'p4h-admin', 'p4h-history-rev-0001');

  -- INV-000003 voided with no money; INV-000004 re-issued for the same job and part-paid
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(v_tenant, v_wos[3], 'USD',
    '[{"category":"labour","description":"Diagnosis","quantity":1,"unit_price":90}]', NULL, NULL, NULL, 'p4h-admin');
  PERFORM garage_ops07_void_invoice(v_tenant, v_inv.id, 'Wrong customer note', 'p4h-admin');
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(v_tenant, v_wos[3], 'USD',
    '[{"category":"labour","description":"Diagnosis","quantity":1,"unit_price":90}]', 'Corrected', NULL, NULL, 'p4h-admin');
  PERFORM garage_ops07_record_payment(v_tenant, v_inv.id, 40, 'USD', 'card_external', NULL, now() - interval '5 minutes', 'p4h-admin', 'p4h-history-pay-0004');

  RAISE NOTICE 'PAY04_OPS07_HISTORY_SEEDED tenant=% invoices=%', v_tenant,
    (SELECT count(*) FROM garage_invoices WHERE tenant_id = v_tenant);
END $$;
