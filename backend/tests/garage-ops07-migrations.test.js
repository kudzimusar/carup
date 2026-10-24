import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, seedAcceptedCase } from './helpers/garageFinalWorld.js';
import { migrationUpSql } from './helpers/pgliteLedgerHarness.js';

const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
const OPS07 = OPS[3];
let world;
let db;
let seq = 0;
const key = () => `pay-key-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const LINES = [
  { category: 'labour', description: 'Brake service', quantity: 2, unit_price: 45 },
  { category: 'part', description: 'Front pads', quantity: 1, unit_price: 80.5 },
];

async function rejects(promise, pattern) {
  try { await promise; } catch (error) {
    if (pattern) assert.match(String(error.message), pattern, `expected ${pattern}, got: ${error.message}`);
    return error;
  }
  assert.fail(`expected a rejection${pattern ? ' matching ' + pattern : ''}`);
}

/** authorized -> assigned -> started -> record -> COMPLETED job (optionally with an accepted estimate) */
async function completedJob({ garage = 'a', estimate = false } = {}) {
  const c = await seedAcceptedCase(world, { garage });
  const who = garage === 'a' ? 'customer-a' : 'customer-b';
  const mech = garage === 'a' ? 'mech-a' : 'mech-c';
  const admin = garage === 'a' ? 'admin-a' : 'admin-b';
  let est = null;
  if (estimate) {
    est = (await db.query('SELECT * FROM garage_ops04_create_estimate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
      [c.tenant, c.workOrderId, 'USD', null, null, null, JSON.stringify(LINES), admin])).rows[0];
    await db.query('SELECT * FROM garage_ops04_send_estimate($1,$2,$3)', [c.tenant, est.id, admin]);
    await db.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7)', [est.id, 'accepted', 'owner', who, 'owner', null, null]);
  } else {
    await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin, who]);
  }
  await db.query('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [c.workOrderId, c.tenant, mech, admin]);
  await db.query("UPDATE service_cases SET status='active' WHERE id=$1", [c.caseId]);
  await db.query(
    `INSERT INTO service_records (work_order_id,service_case_id,tenant_id,vin,work_performed,service_authority,total_cost,currency,recorded_by_user_id,performed_at)
     VALUES ($1,$2,$3,$4,'Brakes','garage_stated',105,'USD',$5,now())`, [c.workOrderId, c.caseId, c.tenant, c.vin, mech]);
  await db.query('SELECT garage_ops05_complete_job($1,$2,$3)', [c.tenant, c.caseId, admin]);
  return { ...c, admin, est };
}
const issue = (job, { lines = LINES, currency = 'USD', actor = job.admin, tenant = job.tenant, due = null } = {}) =>
  db.query('SELECT * FROM garage_ops07_issue_invoice($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',
    [tenant, job.workOrderId, currency, JSON.stringify(lines), 'Thank you', 'internal', due, actor]);
const pay = (inv, amount, o = {}) => db.query('SELECT garage_ops07_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
  [o.tenant ?? inv.tenant_id, inv.id, amount, o.currency ?? inv.currency, o.method ?? 'cash', o.reference ?? null,
    o.paidAt ?? new Date().toISOString(), o.actor ?? 'admin-a', o.key ?? key()]);
const balance = async (inv) => (await db.query('SELECT * FROM garage_ops07_invoice_balance($1)', [inv.id])).rows[0];

before(async () => {
  world = await createGarageFinalWorld({ after: OPS });
  db = world.db;
  await db.exec(migrationUpSql(OPS07)); // replay-safe
});
after(async () => { await db?.close(); });

test('OPS07 tables are private; money history is append-only; functions are service_role-only', async () => {
  const tables = ['garage_document_counters', 'garage_invoices', 'garage_invoice_lines', 'garage_payment_records', 'garage_receipts', 'garage_invoice_events'];
  for (const t of tables) {
    const { rows: [rls] } = await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1', [t]);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true }, t);
    const { rows: [p] } = await db.query("SELECT has_table_privilege('anon',$1,'SELECT') a, has_table_privilege('authenticated',$1,'SELECT') u, has_table_privilege('service_role',$1,'DELETE') d", [t]);
    assert.deepEqual(p, { a: false, u: false, d: false }, t);
  }
  for (const t of ['garage_payment_records', 'garage_invoice_lines', 'garage_invoice_events']) {
    const { rows: [u] } = await db.query("SELECT has_table_privilege('service_role',$1,'UPDATE') u", [t]);
    assert.equal(u.u, false, `${t} is insert-only`);
  }
  const { rows } = await db.query(
    `SELECT p.proname, has_function_privilege('anon', p.oid,'EXECUTE') a, has_function_privilege('authenticated', p.oid,'EXECUTE') u, has_function_privilege('service_role', p.oid,'EXECUTE') s
       FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'garage_ops07_%' AND p.prokind='f'
        AND p.proname NOT LIKE '%guard%' AND p.proname NOT LIKE '%append_only%'`);
  assert.ok(rows.length >= 8);
  for (const r of rows) assert.deepEqual({ a: r.a, u: r.u, s: r.s }, { a: false, u: false, s: true }, r.proname);
});

test('INVOICE: only for a COMPLETED job; the total is derived from the lines; numbered per garage', async () => {
  const open = await seedAcceptedCase(world);
  await rejects(issue({ ...open, admin: 'admin-a' }), /GARAGE_OPS07_JOB_NOT_COMPLETED/);

  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  assert.equal(inv.status, 'issued');
  assert.equal(inv.total_amount, '170.50');
  assert.equal(inv.line_count, 2);
  assert.match(inv.invoice_number, /^INV-\d{6}$/);
  const { rows: lines } = await db.query('SELECT line_no, line_total, source_kind FROM garage_invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [inv.id]);
  assert.deepEqual(lines, [{ line_no: 1, line_total: '90.00', source_kind: 'manual' }, { line_no: 2, line_total: '80.50', source_kind: 'manual' }]);
  const second = await completedJob();
  const inv2 = (await issue(second)).rows[0];
  assert.equal(Number(inv2.invoice_number.slice(4)), Number(inv.invoice_number.slice(4)) + 1, 'numbering is sequential within the garage');
  const other = await completedJob({ garage: 'b' });
  const invB = (await issue(other, { actor: 'admin-b' })).rows[0];
  assert.match(invB.invoice_number, /^INV-000001$/, 'another garage numbers independently');
});

test('INVOICE: money truth — explicit currency, every line priced, no zero-value invoice, exact precision', async () => {
  const job = await completedJob();
  await rejects(issue(job, { currency: null }), /null value|currency|violates not-null|GARAGE_OPS07_CURRENCY_UNSUPPORTED/i);
  await rejects(issue(job, { currency: 'usd' }), /GARAGE_OPS07_CURRENCY_UNSUPPORTED/);
  await rejects(issue(job, { lines: [{ category: 'labour', description: 'x', quantity: 1 }] }), /GARAGE_OPS07_LINE_NOT_PRICED/);
  await rejects(issue(job, { lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 0 }] }), /GARAGE_OPS07_TOTAL_MUST_BE_POSITIVE/);
  await rejects(issue(job, { lines: [] }), /GARAGE_OPS07_LINES_INVALID/);
  await rejects(issue(job, { lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 10.005 }] }), /GARAGE_OPS07_AMOUNT_EXCEEDS_CURRENCY_PRECISION/);
  await rejects(issue(job, { lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: -1 }] }), /GARAGE_OPS07_LINE_PRICE_INVALID/);
  await rejects(issue(job, { lines: [{ category: 'bribe', description: 'x', quantity: 1, unit_price: 1 }] }), /GARAGE_OPS07_LINE_CATEGORY_INVALID/);
  await rejects(issue(job, { currency: 'JPY', lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 100.5 }] }), /GARAGE_OPS07_AMOUNT_EXCEEDS_CURRENCY_PRECISION/);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_invoices WHERE work_order_id=$1', [job.workOrderId])).rows[0].n, 0);
  const ok = (await issue(job, { currency: 'JPY', lines: [{ category: 'labour', description: 'Alignment', quantity: 1, unit_price: 12000 }] })).rows[0];
  assert.equal(ok.total_amount, '12000.00');
});

test('INVOICE: one live invoice per job; issued is immutable; void is terminal and a corrected invoice may follow', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  await rejects(issue(job), /GARAGE_OPS07_INVOICE_ALREADY_ISSUED/);
  for (const sql of [
    "UPDATE garage_invoices SET total_amount=1 WHERE id=$1",
    "UPDATE garage_invoices SET currency='ZAR' WHERE id=$1",
    "UPDATE garage_invoices SET customer_note='x' WHERE id=$1",
    "UPDATE garage_invoices SET status='issued', issued_by_user_id='admin-b' WHERE id=$1",
  ]) await rejects(db.query(sql, [inv.id]), /ISSUED_INVOICE_IMMUTABLE/);
  await rejects(db.query('DELETE FROM garage_invoices WHERE id=$1', [inv.id]), /NEVER_DELETED/);
  await rejects(db.query("UPDATE garage_invoice_lines SET unit_price=1 WHERE invoice_id=$1", [inv.id]), /APPEND_ONLY/);
  await rejects(db.query("DELETE FROM garage_invoice_lines WHERE invoice_id=$1", [inv.id]), /APPEND_ONLY/);
  await rejects(db.query("INSERT INTO garage_invoice_lines (tenant_id,invoice_id,line_no,category,description,quantity,unit_price) VALUES ($1,$2,9,'fee','late',1,1)", [job.tenant, inv.id]), /INVOICE_LINES_LOCKED/);
  await rejects(db.query('SELECT * FROM garage_ops07_void_invoice($1,$2,NULL,$3)', [job.tenant, inv.id, 'admin-a']), /REASON_REQUIRED/);
  const voided = (await db.query('SELECT * FROM garage_ops07_void_invoice($1,$2,$3,$4)', [job.tenant, inv.id, 'Wrong customer name', 'admin-a'])).rows[0];
  assert.equal(voided.status, 'voided');
  await rejects(db.query("UPDATE garage_invoices SET status='issued' WHERE id=$1", [inv.id]), /VOIDED_INVOICE_IS_FINAL/);
  await rejects(pay(inv, 10), /GARAGE_OPS07_INVOICE_NOT_PAYABLE/);
  assert.equal((await balance(inv)).payment_status, 'voided');
  const reissue = (await issue(job)).rows[0];
  assert.notEqual(reissue.invoice_number, inv.invoice_number);
  assert.equal(reissue.status, 'issued');
});

test('INVOICE: the estimate is referenced, never copied into truth — variance only when the currencies match', async () => {
  const job = await completedJob({ estimate: true });
  const inv = (await issue(job, { lines: [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 105 }] })).rows[0];
  assert.equal(inv.estimate_id, job.est.id);
  assert.equal(inv.estimate_version, 1);
  assert.equal(inv.estimate_total_amount, '170.50');
  assert.equal(inv.estimate_currency, 'USD');
  assert.equal(inv.total_amount, '105.00', 'the invoice states the ACTUAL amount; the estimate stays unchanged');
  assert.equal((await db.query('SELECT sent_total_amount FROM garage_estimates WHERE id=$1', [job.est.id])).rows[0].sent_total_amount, '170.50');
  const none = await completedJob();
  const noEst = (await issue(none)).rows[0];
  assert.equal(noEst.estimate_id, null);
  assert.equal(noEst.estimate_total_amount, null);
});

test('INVOICE authority: a garage admin only; another garage and a mechanic cannot issue, void or pay', async () => {
  const job = await completedJob();
  await rejects(issue(job, { actor: 'mech-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(issue(job, { actor: 'customer-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(issue(job, { actor: 'admin-b', tenant: world.T.b }), /GARAGE_OPS07_WORK_ORDER_NOT_FOUND/);
  await rejects(issue(job, { actor: 'admin-b' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  const inv = (await issue(job)).rows[0];
  await rejects(pay(inv, 10, { actor: 'mech-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(pay(inv, 10, { actor: 'admin-b', tenant: world.T.b }), /GARAGE_OPS07_INVOICE_NOT_FOUND/);
  await rejects(db.query('SELECT * FROM garage_ops07_void_invoice($1,$2,$3,$4)', [world.T.b, inv.id, 'x', 'admin-b']), /GARAGE_OPS07_INVOICE_NOT_FOUND/);
});

test('PAYMENT TRUTH: completion and invoicing infer nothing; state is derived from payment records only', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const b0 = await balance(inv);
  assert.equal(b0.payment_status, 'unpaid');
  assert.equal(b0.paid_amount, '0.00');
  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='garage_invoices'")).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /paid|payment_status|settled/.test(c)), 'no stored payment flag exists to drift from the payment records');
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_payment_records WHERE invoice_id=$1', [inv.id])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_receipts WHERE invoice_id=$1', [inv.id])).rows[0].n, 0, 'no receipt without a payment');
});

test('PAYMENT: partial then full; every payment gets a receipt labelled as garage-recorded and unverified', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const { rows: [{ r: p1 }] } = await pay(inv, 100, { method: 'mobile_money', reference: 'EC-12345' });
  assert.equal(p1.payment_status, 'partially_paid');
  assert.equal(p1.balance_amount, '70.50');
  assert.match(p1.receipt_number, /^RCT-\d{6}$/);
  const { rows: [{ r: p2 }] } = await pay(inv, 70.5, { method: 'cash' });
  assert.equal(p2.payment_status, 'paid');
  assert.equal(p2.balance_amount, '0.00');
  const { rows: pays } = await db.query('SELECT kind, amount, currency, method, reference, source FROM garage_payment_records WHERE invoice_id=$1 ORDER BY seq', [inv.id]);
  assert.deepEqual(pays.map((p) => [p.kind, p.amount, p.source]), [['payment', '100.00', 'garage_recorded_external'], ['payment', '70.50', 'garage_recorded_external']]);
  assert.equal(pays[0].reference, 'EC-12345');
  const { rows: rc } = await db.query('SELECT status, payment_source, amount FROM garage_receipts WHERE invoice_id=$1 ORDER BY receipt_number', [inv.id]);
  assert.deepEqual(rc.map((r) => [r.status, r.payment_source]), [['issued', 'garage_recorded_external'], ['issued', 'garage_recorded_external']]);
  await rejects(pay(inv, 1), /GARAGE_OPS07_PAYMENT_EXCEEDS_BALANCE/);
  await rejects(db.query('SELECT * FROM garage_ops07_void_invoice($1,$2,$3,$4)', [job.tenant, inv.id, 'oops', 'admin-a']), /GARAGE_OPS07_INVOICE_HAS_PAYMENTS/);
});

test('PAYMENT refusals: over the balance, wrong currency, bad amount, bad method, bad date — and nothing is left behind', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  await rejects(pay(inv, 170.51), /GARAGE_OPS07_PAYMENT_EXCEEDS_BALANCE/);
  await rejects(pay(inv, 50, { currency: 'ZAR' }), /GARAGE_OPS07_CURRENCY_MISMATCH/);
  await rejects(pay(inv, 0), /GARAGE_OPS07_AMOUNT_INVALID/);
  await rejects(pay(inv, -5), /GARAGE_OPS07_AMOUNT_INVALID/);
  await rejects(pay(inv, 10.005), /GARAGE_OPS07_AMOUNT_INVALID/);
  await rejects(pay(inv, 10, { method: 'bitcoin' }), /GARAGE_OPS07_METHOD_INVALID/);
  await rejects(pay(inv, 10, { paidAt: new Date(Date.now() + 86_400_000).toISOString() }), /GARAGE_OPS07_PAID_AT_INVALID/);
  await rejects(pay(inv, 10, { paidAt: '2019-01-01T00:00:00Z' }), /GARAGE_OPS07_PAID_AT_INVALID/);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_payment_records WHERE invoice_id=$1', [inv.id])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_receipts WHERE invoice_id=$1', [inv.id])).rows[0].n, 0);
});

test('PAYMENT is idempotent: a duplicate callback / double click records the money once', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const k = key();
  const first = (await pay(inv, 50, { key: k })).rows[0].r;
  const replay = (await pay(inv, 50, { key: k })).rows[0].r;
  assert.equal(replay.replayed, true);
  assert.equal(replay.payment_id, first.payment_id);
  assert.equal(replay.receipt_number, first.receipt_number);
  assert.equal((await balance(inv)).paid_amount, '50.00');
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_receipts WHERE invoice_id=$1', [inv.id])).rows[0].n, 1);
  await rejects(pay(inv, 60, { key: k }), /GARAGE_OPS07_IDEMPOTENCY_CONFLICT/);
  await rejects(pay(inv, 50, { key: k, method: 'cash', currency: 'USD', tenant: world.T.b, actor: 'admin-b' }), /GARAGE_OPS07_INVOICE_NOT_FOUND/);
});

test('NO RECEIPT WITHOUT PAYMENT: a receipt row must match an existing payment record exactly', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const ins = (paymentId, amount) => db.query(
    `INSERT INTO garage_receipts (tenant_id,receipt_number,invoice_id,payment_id,amount,currency,payment_source,status,issued_by_user_id)
     VALUES ($1,$2,$3,$4,$5,'USD','garage_recorded_external','issued','admin-a')`, [job.tenant, `RCT-FAKE-${++seq}`, inv.id, paymentId, amount]);
  await rejects(ins('00000000-0000-0000-0000-000000000000', 10), /foreign key|RECEIPT_REQUIRES_PAYMENT|violates/i);
  const paid = (await pay(inv, 40)).rows[0].r;
  await db.query('DELETE FROM garage_receipts WHERE false');
  await rejects(db.query('DELETE FROM garage_receipts WHERE payment_id=$1', [paid.payment_id]), /RECEIPTS_ARE_NEVER_DELETED/);
  await rejects(ins(paid.payment_id, 40), /duplicate key|one_per_payment/i);
  await rejects(db.query("UPDATE garage_receipts SET amount=999 WHERE payment_id=$1", [paid.payment_id]), /RECEIPT_IMMUTABLE/);
  await rejects(db.query("UPDATE garage_payment_records SET amount=1 WHERE id=$1", [paid.payment_id]), /APPEND_ONLY/);
  await rejects(db.query("DELETE FROM garage_payment_records WHERE id=$1", [paid.payment_id]), /APPEND_ONLY/);
  const second = (await completedJob());
  const inv2 = (await issue(second)).rows[0];
  await rejects(ins(paid.payment_id, 40).then(() => db.query('SELECT 1')), /./);
  void inv2;
});

test('REVERSAL: a mistaken payment is reversed by a new row; its receipt is voided; the balance returns; exactly once', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const p = (await pay(inv, 170.5)).rows[0].r;
  assert.equal((await balance(inv)).payment_status, 'paid');
  await rejects(db.query('SELECT garage_ops07_reverse_payment($1,$2,NULL,$3,$4)', [job.tenant, p.payment_id, 'admin-a', key()]), /GARAGE_OPS07_REASON_REQUIRED/);
  await rejects(db.query('SELECT garage_ops07_reverse_payment($1,$2,$3,$4,$5)', [world.T.b, p.payment_id, 'mistake', 'admin-b', key()]), /GARAGE_OPS07_PAYMENT_NOT_FOUND/);
  const { rows: [{ r }] } = await db.query('SELECT garage_ops07_reverse_payment($1,$2,$3,$4,$5) r', [job.tenant, p.payment_id, 'Recorded against wrong invoice', 'admin-a', key()]);
  assert.equal(r.payment_status, 'unpaid');
  assert.equal((await db.query('SELECT status FROM garage_receipts WHERE payment_id=$1', [p.payment_id])).rows[0].status, 'voided');
  assert.deepEqual((await db.query('SELECT kind FROM garage_payment_records WHERE invoice_id=$1 ORDER BY seq', [inv.id])).rows.map((x) => x.kind), ['payment', 'reversal']);
  await rejects(db.query('SELECT garage_ops07_reverse_payment($1,$2,$3,$4,$5)', [job.tenant, p.payment_id, 'again', 'admin-a', key()]), /GARAGE_OPS07_PAYMENT_ALREADY_REVERSED/);
  // the money can now be recorded again, and the invoice (no net payments) can be voided
  const again = (await pay(inv, 170.5)).rows[0].r;
  assert.equal(again.payment_status, 'paid');
});

test('FAIL-ATOMIC: if the payment audit fails, no payment, no receipt and no burnt receipt number survive', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const before = (await pay(inv, 10)).rows[0].r.receipt_number;
  await db.exec(
    "CREATE OR REPLACE FUNCTION ops07_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = 'GARAGE_INVOICE_PAYMENT_RECORDED' THEN RAISE EXCEPTION 'OPS07_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops07_test_fail_audit BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION ops07_test_fail_audit();");
  try {
    await rejects(pay(inv, 20), /OPS07_TEST_AUDIT_FAILURE/);
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS trg_ops07_test_fail_audit ON trust_audit_events; DROP FUNCTION IF EXISTS ops07_test_fail_audit();');
  }
  assert.equal((await balance(inv)).paid_amount, '10.00', 'only the first payment exists');
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_receipts WHERE invoice_id=$1', [inv.id])).rows[0].n, 1);
  const after = (await pay(inv, 20)).rows[0].r.receipt_number;
  assert.equal(Number(after.slice(4)), Number(before.slice(4)) + 1, 'the failed attempt did not burn a receipt number');
});

test('FAIL-ATOMIC: if issuing fails after the invoice row, the whole invoice (and its number) rolls back', async () => {
  const job = await completedJob();
  const probe = await completedJob();
  const first = (await issue(probe)).rows[0];
  await db.exec(
    "CREATE OR REPLACE FUNCTION ops07_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = 'GARAGE_INVOICE_ISSUED' THEN RAISE EXCEPTION 'OPS07_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops07_test_fail_audit BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION ops07_test_fail_audit();");
  try {
    await rejects(issue(job), /OPS07_TEST_AUDIT_FAILURE/);
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS trg_ops07_test_fail_audit ON trust_audit_events; DROP FUNCTION IF EXISTS ops07_test_fail_audit();');
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_invoices WHERE work_order_id=$1', [job.workOrderId])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_invoice_lines WHERE invoice_id IN (SELECT id FROM garage_invoices WHERE work_order_id=$1)', [job.workOrderId])).rows[0].n, 0);
  const next = (await issue(job)).rows[0];
  assert.equal(Number(next.invoice_number.slice(4)), Number(first.invoice_number.slice(4)) + 1, 'no invoice number was burnt');
});

test('EVENTS: every money transition is attributable, ordered and append-only', async () => {
  const job = await completedJob();
  const inv = (await issue(job)).rows[0];
  const p = (await pay(inv, 30)).rows[0].r;
  await db.query('SELECT garage_ops07_reverse_payment($1,$2,$3,$4,$5)', [job.tenant, p.payment_id, 'typo', 'admin-a', key()]);
  const ev = (await db.query('SELECT event_type, actor_user_id FROM garage_invoice_events WHERE invoice_id=$1 ORDER BY seq', [inv.id])).rows;
  assert.deepEqual(ev.map((e) => e.event_type), ['issued', 'payment_recorded', 'payment_reversed']);
  assert.ok(ev.every((e) => e.actor_user_id === 'admin-a'));
  await rejects(db.query('UPDATE garage_invoice_events SET event_type=\'issued\' WHERE invoice_id=$1', [inv.id]), /APPEND_ONLY/);
  const { rows: audit } = await db.query("SELECT event_type FROM trust_audit_events WHERE event_type LIKE 'GARAGE_INVOICE_%' AND (new_value->>'invoice_id')=$1 ORDER BY created_at, id", [inv.id]);
  assert.ok(audit.length >= 3);
});
