-- CARUP-PAY-04-LR01 — Garage invoice integrity (migration 20261102100000) on real PostgreSQL.
--
--   I   invoice-line provenance: a part line is billed only from recorded, un-reversed consumption ON THIS JOB, never
--       for more than was consumed; a labour/fee line that names a service record must name one of this job's;
--       history (lines issued before PAY-04) is never re-judged.
--   S   invoicing never moves stock: issue, void and re-issue leave every stock movement and on-hand balance alone.
--   I14 a part billed on an issued invoice cannot be reversed (stock would return while the invoice bills it); void first.
--   P   garage payment instructions: garage-owned, versioned, append-only, admin-only, least privilege.
--
-- Runs after scripts/ci/pay04-postgres-certification.sh has applied both lineages and the PAY-04 migrations.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY04_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
END $$;

-- expect(sql, pattern): the statement must fail with a message matching the pattern; its effects are rolled back.
CREATE OR REPLACE FUNCTION pg_temp.expect(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ p_pattern THEN
      RAISE EXCEPTION 'PAY04_SMOKE_WRONG_ERROR: expected % got % (sql: %)', p_pattern, SQLERRM, left(p_sql, 160);
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY04_SMOKE_EXPECTED_FAILURE: % (sql: %)', p_pattern, left(p_sql, 160);
END $$;

-- A garage with one admin, one mechanic and a branch; returns the tenant id.
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

-- An owner-authorized job in progress with one priced service record. Returns {case, wo, record}.
CREATE OR REPLACE FUNCTION pg_temp.job(p_tenant uuid, p_prefix text, p_vin text, p_customer text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_branch uuid; v_case uuid; v_wo uuid; v_rec uuid;
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
    VALUES (v_wo, v_case, p_tenant, p_vin, 'Brakes', 'garage_stated', 105, 'USD', p_prefix || '-mech', now()) RETURNING id INTO v_rec;
  RETURN jsonb_build_object('case', v_case, 'wo', v_wo, 'record', v_rec);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.lines(VARIADIC p_lines jsonb[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(l) FROM unnest(p_lines) AS l;
$$;

DO $$
DECLARE
  g1 uuid; g2 uuid; p1 uuid; p2 uuid;
  j1 jsonb; j2 jsonb; j3 jsonb;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid;
  v_inv garage_invoices%ROWTYPE;
  v_moves_before bigint; v_moves_after bigint; v_onhand_before integer; v_onhand_after integer;
  v_issue text;
BEGIN
  INSERT INTO users (id, name, email, role, join_date) VALUES
    ('p4i-cust', 'p4i-cust', 'p4i-cust@example.invalid', 'owner', '2026-01-01'),
    ('p4i-cust2', 'p4i-cust2', 'p4i-cust2@example.invalid', 'owner', '2026-01-01');
  INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id) VALUES
    ('PAY04INTEGVIN00001', 'Toyota', 'Hilux', 2019, 90000, 1000, 'p4i-cust'),
    ('PAY04INTEGVIN00002', 'Honda', 'Fit', 2021, 30000, 1000, 'p4i-cust2');
  g1 := pg_temp.garage('p4i');
  g2 := pg_temp.garage('p4j');
  p1 := (garage_ops06_create_part(g1, 'Brake pads', 'P4I-PADS', 10, NULL, NULL, 20, 40, 'USD', 'p4i-admin', 'p4i-part-key-0001')).id;
  p2 := (garage_ops06_create_part(g2, 'Oil filter', 'P4J-FILTER', 10, NULL, NULL, 5, 12, 'USD', 'p4j-admin', 'p4j-part-key-0001')).id;

  -- J1 (garage 1): 2 pads consumed (u1); 1 more consumed then reversed (u2). J2 (garage 1): 1 pad (u3). J3 (garage 2): u4.
  j1 := pg_temp.job(g1, 'p4i', 'PAY04INTEGVIN00001', 'p4i-cust');
  u1 := (garage_ops06_consume_for_service(g1, (j1->>'record')::uuid, p1, 2, NULL, 'p4i-mech', 'p4i-use-key-0001')->>'usage_id')::uuid;
  u2 := (garage_ops06_consume_for_service(g1, (j1->>'record')::uuid, p1, 1, NULL, 'p4i-mech', 'p4i-use-key-0002')->>'usage_id')::uuid;
  PERFORM garage_ops06_reverse_usage(g1, u2, 'Wrong part fitted', 'p4i-admin', 'p4i-rev-key-0001');
  PERFORM garage_ops05_complete_job(g1, (j1->>'case')::uuid, 'p4i-admin');
  j2 := pg_temp.job(g1, 'p4i', 'PAY04INTEGVIN00001', 'p4i-cust');
  u3 := (garage_ops06_consume_for_service(g1, (j2->>'record')::uuid, p1, 1, NULL, 'p4i-mech', 'p4i-use-key-0003')->>'usage_id')::uuid;
  PERFORM garage_ops05_complete_job(g1, (j2->>'case')::uuid, 'p4i-admin');
  j3 := pg_temp.job(g2, 'p4j', 'PAY04INTEGVIN00002', 'p4i-cust2');
  u4 := (garage_ops06_consume_for_service(g2, (j3->>'record')::uuid, p2, 1, NULL, 'p4j-mech', 'p4j-use-key-0001')->>'usage_id')::uuid;
  PERFORM garage_ops05_complete_job(g2, (j3->>'case')::uuid, 'p4j-admin');

  v_issue := format('SELECT garage_ops07_issue_invoice(%L::uuid, %L::uuid, ''USD'', %%L::jsonb, NULL, NULL, NULL, ''p4i-admin'')', g1, j1->>'wo');

  -- I2-I11: provenance refusals (each statement is rolled back by expect()).
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(
    '{"category":"part","description":"Pads","quantity":2,"unit_price":40}')), 'PAY04_PART_LINE_REQUIRES_RECORDED_USAGE');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','part','description','Pads','quantity',1,'unit_price',40,'source_kind','part_usage','source_id',u3))), 'PAY04_LINE_SOURCE_NOT_ON_THIS_JOB');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','part','description','Filter','quantity',1,'unit_price',12,'source_kind','part_usage','source_id',u4))), 'PAY04_LINE_SOURCE_NOT_ON_THIS_JOB');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','part','description','Pads','quantity',1,'unit_price',40,'source_kind','part_usage','source_id',u2))), 'PAY04_LINE_SOURCE_REVERSED');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','part','description','Pads','quantity',3,'unit_price',40,'source_kind','part_usage','source_id',u1))), 'PAY04_LINE_QUANTITY_EXCEEDS_RECORDED_USAGE');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(
    jsonb_build_object('category','part','description','Pads A','quantity',1,'unit_price',40,'source_kind','part_usage','source_id',u1),
    jsonb_build_object('category','part','description','Pads B','quantity',2,'unit_price',40,'source_kind','part_usage','source_id',u1))),
    'PAY04_LINE_QUANTITY_EXCEEDS_RECORDED_USAGE');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','labour','description','Fitting','quantity',1,'unit_price',30,'source_kind','part_usage','source_id',u1))), 'PAY04_LINE_SOURCE_CATEGORY_MISMATCH');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','part','description','Pads','quantity',1,'unit_price',40,'source_kind','service_record','source_id',j1->>'record'))), 'PAY04_LINE_SOURCE_CATEGORY_MISMATCH');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','labour','description','Labour','quantity',1,'unit_price',105,'source_kind','service_record','source_id',j2->>'record'))), 'PAY04_LINE_SOURCE_NOT_ON_THIS_JOB');
  PERFORM pg_temp.expect(format(v_issue, pg_temp.lines(jsonb_build_object(
    'category','labour','description','Labour','quantity',1,'unit_price',105,'source_kind','service_record','source_id',gen_random_uuid()))), 'PAY04_LINE_SOURCE_NOT_ON_THIS_JOB');
  -- A refused issuance burns no invoice number (the counter row is untouched).
  IF EXISTS (SELECT 1 FROM garage_document_counters WHERE tenant_id = g1) THEN
    RAISE EXCEPTION 'PAY04_SMOKE_REFUSED_ISSUANCE_BURNED_A_NUMBER';
  END IF;
  RAISE NOTICE 'PAY04_INTEGRITY_SMOKE I2-I11 PASS: unrecorded, foreign-job, foreign-garage, reversed, over-quantity and mis-categorised lines refused';

  -- I1: the legitimate invoice — job labour from its service record, pads from recorded consumption, a manual fee.
  SELECT count(*) INTO v_moves_before FROM garage_stock_movements WHERE tenant_id = g1;
  SELECT stock_level INTO v_onhand_before FROM mechanic_parts WHERE id = p1;
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(g1, (j1->>'wo')::uuid, 'USD', pg_temp.lines(
    jsonb_build_object('category','labour','description','Brake service','quantity',1,'unit_price',105,'source_kind','service_record','source_id',j1->>'record'),
    jsonb_build_object('category','part','description','Brake pads','quantity',2,'unit_price',40,'source_kind','part_usage','source_id',u1),
    '{"category":"fee","description":"Call-out","quantity":1,"unit_price":15}'::jsonb), NULL, NULL, NULL, 'p4i-admin');
  IF v_inv.total_amount <> 200 OR v_inv.line_count <> 3 THEN
    RAISE EXCEPTION 'PAY04_SMOKE_INVOICE_TOTAL: % / %', v_inv.total_amount, v_inv.line_count;
  END IF;
  IF (SELECT count(*) FROM garage_invoice_lines WHERE invoice_id = v_inv.id AND source_kind = 'part_usage' AND source_id = u1) <> 1 THEN
    RAISE EXCEPTION 'PAY04_SMOKE_PART_PROVENANCE_NOT_RECORDED';
  END IF;

  -- I12: void and re-issue (the adjustment path): the voided invoice's lines no longer count against the usage.
  PERFORM garage_ops07_void_invoice(g1, v_inv.id, 'Call-out fee waived', 'p4i-admin');
  SELECT * INTO v_inv FROM garage_ops07_issue_invoice(g1, (j1->>'wo')::uuid, 'USD', pg_temp.lines(
    jsonb_build_object('category','labour','description','Brake service','quantity',1,'unit_price',105,'source_kind','service_record','source_id',j1->>'record'),
    jsonb_build_object('category','part','description','Brake pads','quantity',2,'unit_price',40,'source_kind','part_usage','source_id',u1)),
    'Corrected: call-out waived', NULL, NULL, 'p4i-admin');
  IF v_inv.total_amount <> 185 OR v_inv.invoice_number <> 'INV-000002' THEN
    RAISE EXCEPTION 'PAY04_SMOKE_REISSUE: % %', v_inv.total_amount, v_inv.invoice_number;
  END IF;

  -- S: invoicing, voiding and re-issuing moved no stock.
  SELECT count(*) INTO v_moves_after FROM garage_stock_movements WHERE tenant_id = g1;
  SELECT stock_level INTO v_onhand_after FROM mechanic_parts WHERE id = p1;
  IF v_moves_after <> v_moves_before OR v_onhand_after <> v_onhand_before OR v_onhand_after <> 7 THEN
    RAISE EXCEPTION 'PAY04_SMOKE_INVOICING_MOVED_STOCK: moves % -> %, on hand % -> %', v_moves_before, v_moves_after, v_onhand_before, v_onhand_after;
  END IF;
  RAISE NOTICE 'PAY04_INTEGRITY_SMOKE I1 I12 S PASS: provenance-bound lines issue, void + re-issue is the adjustment path, invoicing never moves stock';

  -- I13: lines written before PAY-04 are history; the guard judges only new lines. (A legacy manual part line exists.)
  IF NOT EXISTS (SELECT 1 FROM garage_invoice_lines WHERE category = 'part' AND source_kind = 'manual') THEN
    RAISE EXCEPTION 'PAY04_SMOKE_LEGACY_HISTORY_MISSING';
  END IF;
  PERFORM pg_temp.expect(format('UPDATE garage_invoice_lines SET description = ''x'' WHERE invoice_id = %L', v_inv.id), 'GARAGE_OPS07_APPEND_ONLY');

  -- I14: a part billed on an ISSUED invoice cannot be reversed: stock would come back while the invoice still bills it.
  --      OPS06 refuses a reversal only while the work order is terminal, and OPS05 guards only ENTERING Completed, so a
  --      completed work order can be reopened (PATCH /api/mechanic/work-orders/:id) — reproduce exactly that.
  UPDATE mechanic_work_orders SET status = 'In Progress' WHERE id = (j1->>'wo')::uuid;
  PERFORM pg_temp.expect(format($q$SELECT garage_ops06_reverse_usage(%L, %L, 'Returned to stock', 'p4i-admin', 'p4i-rev-key-0002')$q$, g1, u1), 'PAY04_PART_USAGE_INVOICED');
  PERFORM garage_ops07_void_invoice(g1, v_inv.id, 'Pads returned unused', 'p4i-admin');
  PERFORM garage_ops06_reverse_usage(g1, u1, 'Returned to stock', 'p4i-admin', 'p4i-rev-key-0003');
  IF (SELECT stock_level FROM mechanic_parts WHERE id = p1) <> 9 THEN
    RAISE EXCEPTION 'PAY04_SMOKE_REVERSAL_AFTER_VOID: on hand %', (SELECT stock_level FROM mechanic_parts WHERE id = p1);
  END IF;
  RAISE NOTICE 'PAY04_INTEGRITY_SMOKE I13 I14 PASS: legacy lines are history; a billed part reverses only after its invoice is voided';
END $$;

-- P: garage payment instructions.
DO $$
DECLARE g1 uuid; g2 uuid; v1 pay04_garage_payment_instructions%ROWTYPE; v2 pay04_garage_payment_instructions%ROWTYPE;
BEGIN
  SELECT id INTO g1 FROM tenants WHERE name = 'p4i Garage';
  SELECT id INTO g2 FROM tenants WHERE name = 'p4j Garage';
  v1 := pay04_set_garage_payment_instructions(g1, 'p4i-admin', 'Brake & Clutch (Pvt) Ltd',
    'Pay at the front desk, or by bank transfer to the account printed on your invoice.', ARRAY['cash','bank_transfer'], ARRAY['USD']);
  IF v1.version <> 1 OR v1.status <> 'active' THEN RAISE EXCEPTION 'PAY04_SMOKE_INSTRUCTIONS_V1'; END IF;
  v2 := pay04_set_garage_payment_instructions(g1, 'p4i-admin', 'Brake & Clutch (Pvt) Ltd',
    'Pay at the front desk (cash or EcoCash), or by bank transfer quoting the invoice number.', ARRAY['cash','mobile_money','bank_transfer'], ARRAY['USD','ZWG']);
  IF v2.version <> 2 OR (SELECT status FROM pay04_garage_payment_instructions WHERE id = v1.id) <> 'superseded'
     OR (SELECT count(*) FROM pay04_garage_payment_instructions WHERE tenant_id = g1 AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'PAY04_SMOKE_INSTRUCTIONS_VERSIONING';
  END IF;
  PERFORM pg_temp.expect(format($q$SELECT pay04_set_garage_payment_instructions(%L, 'p4i-mech', 'X Garage', 'Pay the garage directly please.', ARRAY['cash'], ARRAY['USD'])$q$, g1), 'GARAGE_OPS03_ADMIN_REQUIRED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_set_garage_payment_instructions(%L, 'p4j-admin', 'X Garage', 'Pay the garage directly please.', ARRAY['cash'], ARRAY['USD'])$q$, g1), 'GARAGE_OPS03_ADMIN_REQUIRED');
  PERFORM pg_temp.expect(format($q$SELECT pay04_set_garage_payment_instructions(%L, 'p4i-admin', 'X Garage', 'Pay the garage directly please.', ARRAY['crypto'], ARRAY['USD'])$q$, g1), 'PAY04_INSTRUCTIONS_METHOD_INVALID');
  PERFORM pg_temp.expect(format($q$SELECT pay04_set_garage_payment_instructions(%L, 'p4i-admin', 'X Garage', 'Pay the garage directly please.', ARRAY['cash'], ARRAY['KWD'])$q$, g1), 'PAY04_INSTRUCTIONS_CURRENCY_INVALID');
  PERFORM pg_temp.expect(format($q$SELECT pay04_set_garage_payment_instructions(%L, 'p4i-admin', ' ', 'Pay the garage directly please.', ARRAY['cash'], ARRAY['USD'])$q$, g1), 'PAY04_INSTRUCTIONS_INVALID');
  PERFORM pg_temp.expect(format($q$SELECT pay04_set_garage_payment_instructions(%L, 'p4i-admin', 'X Garage', 'short', ARRAY['cash'], ARRAY['USD'])$q$, g1), 'PAY04_INSTRUCTIONS_INVALID');
  PERFORM pg_temp.expect(format('UPDATE pay04_garage_payment_instructions SET instructions = ''Pay into my personal account'' WHERE id = %L', v2.id), 'PAY04_INSTRUCTIONS_IMMUTABLE');
  PERFORM pg_temp.expect(format('DELETE FROM pay04_garage_payment_instructions WHERE id = %L', v1.id), 'PAY04_INSTRUCTIONS_IMMUTABLE');
  IF has_table_privilege('anon', 'pay04_garage_payment_instructions', 'SELECT')
     OR has_table_privilege('authenticated', 'pay04_garage_payment_instructions', 'SELECT')
     OR has_table_privilege('service_role', 'pay04_garage_payment_instructions', 'INSERT')
     OR has_table_privilege('service_role', 'pay04_garage_payment_instructions', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'pay04_garage_payment_instructions', 'SELECT')
     OR has_function_privilege('authenticated', 'pay04_set_garage_payment_instructions(uuid,text,text,text,text[],text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'pay04_set_garage_payment_instructions(uuid,text,text,text,text[],text[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'pay04_set_garage_payment_instructions(uuid,text,text,text,text[],text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY04_SMOKE_INSTRUCTIONS_PRIVILEGES';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trust_audit_events WHERE event_type = 'GARAGE_PAYMENT_INSTRUCTIONS_SET' AND actor_tenant_id = g1::text) THEN
    RAISE EXCEPTION 'PAY04_SMOKE_INSTRUCTIONS_NOT_AUDITED';
  END IF;
  RAISE NOTICE 'PAY04_INTEGRITY_SMOKE P PASS: instructions are garage-owned, versioned, append-only, admin-only and audited';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'PAY04_GARAGE_INVOICE_INTEGRITY_POSTGRES_SMOKE_PASS: line provenance, no stock side effects, adjustment by void + re-issue, payment instructions';
END $$;
