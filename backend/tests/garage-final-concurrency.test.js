import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createGarageFinalWorld } from './helpers/garageFinalWorld.js';

/**
 * GARAGE-1.0 FINAL — adversarial concurrency, on a REAL PostgreSQL.
 *
 * PGlite is single-connection, so it can prove every rule one statement at a time but can never prove a
 * race. This suite clones the fully-migrated PGlite world (the repository's own migrations) into a fresh
 * database on a real server and then fires genuinely parallel transactions from separate connections:
 *
 *   accept vs decline · two estimate versions · two assignments · stock consumers on the last unit ·
 *   duplicate invoice issuance · duplicate payment callbacks · completion vs a late service record ·
 *   completion vs start · payment vs void · parallel document numbering
 *
 * Every race asserts BOTH who won (exactly one) and the invariant that must survive (the aggregates
 * agree), and the whole suite asserts that PostgreSQL never reported a deadlock.
 *
 * Needs GARAGE_REALPG_ADMIN_URL (a superuser URL, e.g. postgres://postgres@127.0.0.1:55433/postgres) and
 * the `psql` client. Without it the suite is SKIPPED (and says so); CI provides both.
 */
const ADMIN_URL = process.env.GARAGE_REALPG_ADMIN_URL || '';
const PSQL = process.env.PSQL_BIN || 'psql';
const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
const skip = ADMIN_URL ? false : 'GARAGE_REALPG_ADMIN_URL is not set: real-PostgreSQL race tests skipped';

let dbName; let dbUrl; let pool;
const deadlocks = [];
const ids = {};
let seq = 0;
const key = () => `race-key-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

function urlFor(base, database) { const u = new URL(base); u.pathname = `/${database}`; return u.toString(); }

/** Fire the given async operations at the same instant, each on its OWN connection. */
async function race(ops) {
  const clients = await Promise.all(ops.map(async () => { const c = new pg.Client({ connectionString: dbUrl }); await c.connect(); return c; }));
  try {
    const started = await Promise.allSettled(ops.map((op, i) => op(clients[i])));
    for (const r of started) if (r.status === 'rejected' && r.reason?.code === '40P01') deadlocks.push(r.reason.message);
    return started.map((r) => (r.status === 'fulfilled' ? { ok: true, value: r.value } : { ok: false, error: r.reason, message: String(r.reason?.message || r.reason) }));
  } finally { await Promise.all(clients.map((c) => c.end().catch(() => {}))); }
}
const winners = (results) => results.filter((r) => r.ok);
const losers = (results) => results.filter((r) => !r.ok);
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

async function newCase() {
  const c = await one("INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id", [ids.vinA, ids.tA, ids.bA]);
  const wo = await one("INSERT INTO mechanic_work_orders (tenant_id,vin,customer_id,service_case_id,branch_id,status,owner_authorization) VALUES ($1,$2,'customer-a',$3,$4,'In Progress','pending') RETURNING id", [ids.tA, ids.vinA, c.id, ids.bA]);
  return { caseId: c.id, woId: wo.id };
}
const LINES = JSON.stringify([{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }]);
async function sentEstimate() {
  const j = await newCase();
  const est = await one('SELECT * FROM garage_ops04_create_estimate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)', [ids.tA, j.woId, 'USD', null, null, null, LINES, 'admin-a']);
  await one('SELECT * FROM garage_ops04_send_estimate($1,$2,$3)', [ids.tA, est.id, 'admin-a']);
  return { ...j, estId: est.id };
}
async function startedJob({ withRecord = true } = {}) {
  const j = await newCase();
  await pool.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [j.woId, ids.vinA]);
  await pool.query('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [j.woId, ids.tA, 'mech-a', 'admin-a']);
  await pool.query("UPDATE service_cases SET status='active' WHERE id=$1", [j.caseId]);
  if (withRecord) j.recordId = (await addRecord(j)).id;
  return j;
}
const addRecord = (j, q = pool) => q.query(
  "INSERT INTO service_records (work_order_id,service_case_id,tenant_id,vin,work_performed,service_authority,total_cost,currency,recorded_by_user_id,performed_at) VALUES ($1,$2,$3,$4,'Work','garage_stated',100,'USD','mech-a',now()) RETURNING id",
  [j.woId, j.caseId, ids.tA, ids.vinA]).then((r) => r.rows[0]);
async function completedJob() { const j = await startedJob(); await pool.query('SELECT garage_ops05_complete_job($1,$2,$3)', [ids.tA, j.caseId, 'admin-a']); return j; }
async function issuedInvoice(total = 100) {
  const j = await completedJob();
  const inv = await one('SELECT * FROM garage_ops07_issue_invoice($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',
    [ids.tA, j.woId, 'USD', JSON.stringify([{ category: 'labour', description: 'Service', quantity: 1, unit_price: total }]), null, null, null, 'admin-a']);
  return { ...j, invId: inv.id, invNumber: inv.invoice_number };
}
async function newPart(qty) {
  const p = await one('SELECT * FROM garage_ops06_create_part($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,$5,$6)', [ids.tA, 'Race part', `RACE-${Date.now()}-${++seq}`, qty, 'admin-a', key()]);
  return p.id;
}

before(async () => {
  if (skip) return;
  // 1) the repository's own migrations, on PGlite
  const world = await createGarageFinalWorld({ after: OPS });
  const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump');
  const dump = await pgDump({ pg: world.db });
  const sql = await dump.text();
  // the roles the migrations reference (anon / authenticated / service_role and legacy ones) travel with the world
  const roles = (await world.db.query("SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND rolname <> 'postgres'")).rows.map((r) => r.rolname);
  await world.db.close();
  // 2) a fresh database on the REAL server, loaded from that dump
  dbName = `garage_race_${Date.now()}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const role of new Set(['anon', 'authenticated', 'service_role', ...roles])) {
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`unexpected role name ${role}`);
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$;`);
  }
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  dbUrl = urlFor(ADMIN_URL, dbName);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'garage-race-'));
  const file = path.join(dir, 'world.sql');
  // The dump comes from PGlite's PostgreSQL 17 build; strip only the server-version-specific preamble a
  // 16.x server (or an older psql) rejects. Nothing that defines schema, data or privileges is touched.
  const portable = sql.split('\n').filter((line) => !/^SET transaction_timeout\b/.test(line) && !/^\\(un)?restrict\b/.test(line)).join('\n');
  writeFileSync(file, portable);
  try { execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', dbUrl, '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (error) { throw new Error(`could not load the world into PostgreSQL: ${String(error.stderr || error.message).slice(0, 600)}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }

  pool = new pg.Pool({ connectionString: dbUrl, max: 12 });
  ids.tA = (await one("SELECT id FROM tenants WHERE name='Garage A'")).id;
  ids.tB = (await one("SELECT id FROM tenants WHERE name='Garage B'")).id;
  ids.bA = (await one("SELECT id FROM garage_branches WHERE branch_code='A-CENTRAL'")).id;
  ids.vinA = 'FINALVIN0000000001';
});

after(async () => {
  if (pool) await pool.end();
  if (dbName && !skip) {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
});

test('the cloned world is the real thing (migrations, grants, RLS survived the dump)', { skip }, async () => {
  const { n } = await one("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'garage_ops0%'");
  assert.ok(n >= 25, `expected the OPS04-07 functions, found ${n}`);
  const { rls } = await one("SELECT relforcerowsecurity rls FROM pg_class WHERE relname='garage_estimates'");
  assert.equal(rls, true);
  const { ok } = await one("SELECT has_function_privilege('anon','garage_ops07_record_payment(uuid,uuid,numeric,text,text,text,timestamptz,text,text)','EXECUTE') ok");
  assert.equal(ok, false);
});

test('RACE: the customer accepts while (or as) they decline — exactly one decision wins and the aggregates agree', { skip }, async () => {
  const outcomes = { accepted: 0, declined: 0 };
  for (let i = 0; i < 15; i += 1) {
    const f = await sentEstimate();
    const decide = (decision) => (c) => c.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7) r', [f.estId, decision, 'owner', 'customer-a', 'owner', null, null]);
    const results = await race([decide('accepted'), decide('declined'), decide('accepted'), decide('declined')]);
    assert.equal(winners(results).length, 1, `iteration ${i}: exactly one decision may win`);
    for (const l of losers(results)) assert.match(l.message, /GARAGE_OPS04_ESTIMATE_NOT_PENDING/);
    const est = await one('SELECT status FROM garage_estimates WHERE id=$1', [f.estId]);
    const wo = await one('SELECT owner_authorization FROM mechanic_work_orders WHERE id=$1', [f.woId]);
    outcomes[est.status] += 1;
    assert.equal(wo.owner_authorization, est.status === 'accepted' ? 'authorized' : 'declined', `iteration ${i}: estimate ${est.status} but work order ${wo.owner_authorization}`);
    assert.equal((await one("SELECT count(*)::int n FROM garage_estimate_events WHERE estimate_id=$1 AND event_type IN ('accepted','declined')", [f.estId])).n, 1, 'one decision event');
  }
  assert.equal(outcomes.accepted + outcomes.declined, 15);
});

test('RACE: a direct work-order decision cannot sneak past a pending estimate', { skip }, async () => {
  for (let i = 0; i < 10; i += 1) {
    const f = await sentEstimate();
    const results = await race([
      (c) => c.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [f.woId, ids.vinA]),
      (c) => c.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7) r', [f.estId, 'accepted', 'owner', 'customer-a', 'owner', null, null]),
    ]);
    assert.equal(winners(results).length, 1, `iteration ${i}: only the estimate path may decide`);
    const est = await one('SELECT status FROM garage_estimates WHERE id=$1', [f.estId]);
    const wo = await one('SELECT owner_authorization FROM mechanic_work_orders WHERE id=$1', [f.woId]);
    assert.deepEqual([est.status, wo.owner_authorization], ['accepted', 'authorized'], 'never "authorized with the estimate still sent"');
  }
});

test('RACE: two admins revise (or create) at once — one live estimate, one new version', { skip }, async () => {
  for (let i = 0; i < 10; i += 1) {
    const f = await sentEstimate();
    const results = await race([
      (c) => c.query('SELECT * FROM garage_ops04_revise_estimate($1,$2,$3)', [ids.tA, f.estId, 'admin-a']),
      (c) => c.query('SELECT * FROM garage_ops04_revise_estimate($1,$2,$3)', [ids.tA, f.estId, 'admin-a']),
      (c) => c.query('SELECT * FROM garage_ops04_revise_estimate($1,$2,$3)', [ids.tA, f.estId, 'admin-a']),
    ]);
    assert.equal(winners(results).length, 1, `iteration ${i}`);
    const rows = (await pool.query('SELECT version,status FROM garage_estimates WHERE work_order_id=$1 ORDER BY version', [f.woId])).rows;
    assert.deepEqual(rows, [{ version: 1, status: 'superseded' }, { version: 2, status: 'draft' }]);
  }
  for (let i = 0; i < 10; i += 1) {
    const j = await newCase();
    const create = (c) => c.query('SELECT * FROM garage_ops04_create_estimate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)', [ids.tA, j.woId, 'USD', null, null, null, LINES, 'admin-a']);
    const results = await race([create, create, create]);
    assert.equal(winners(results).length, 1);
    assert.equal((await one("SELECT count(*)::int n FROM garage_estimates WHERE work_order_id=$1 AND status IN ('draft','sent')", [j.woId])).n, 1);
  }
});

test('RACE: two mechanics assigned to one job — exactly one live assignment', { skip }, async () => {
  for (let i = 0; i < 10; i += 1) {
    const j = await newCase();
    const assign = (mechanic) => (c) => c.query('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [j.woId, ids.tA, mechanic, 'admin-a']);
    const results = await race([assign('mech-a'), assign('mech-b'), assign('mech-a')]);
    assert.equal(winners(results).length, 1);
    for (const l of losers(results)) assert.equal(l.error.code, '23505');
    assert.equal((await one('SELECT count(*)::int n FROM work_order_assignments WHERE work_order_id=$1 AND unassigned_at IS NULL', [j.woId])).n, 1);
  }
});

test('RACE: consumers fight for the last units — never negative, the ledger adds up', { skip }, async () => {
  for (const [stock, consumers] of [[1, 2], [3, 8], [5, 5]]) {
    const job = await startedJob();
    const part = await newPart(stock);
    const use = (c) => c.query('SELECT garage_ops06_consume_for_service($1,$2,$3,$4,NULL,$5,$6) r', [ids.tA, job.recordId, part, 1, 'mech-a', key()]);
    const results = await race(Array.from({ length: consumers }, () => use));
    const won = winners(results).length;
    assert.equal(won, Math.min(stock, consumers), `stock ${stock}, ${consumers} consumers`);
    for (const l of losers(results)) assert.match(l.message, /GARAGE_OPS06_INSUFFICIENT_STOCK/);
    const level = (await one('SELECT stock_level FROM mechanic_parts WHERE id=$1', [part])).stock_level;
    assert.equal(level, stock - won);
    assert.ok(level >= 0);
    const ledger = (await pool.query("SELECT quantity_delta,balance_before,balance_after FROM garage_stock_movements WHERE part_id=$1 ORDER BY seq", [part])).rows;
    let running = 0;
    for (const m of ledger) { assert.equal(m.balance_before, running, 'every movement starts where the last one ended'); running = m.balance_after; }
    assert.equal(running, level);
    assert.equal((await one('SELECT count(*)::int n FROM garage_service_part_usage WHERE part_id=$1', [part])).n, won, 'one usage row per successful consumption');
  }
});

test('RACE: the same consumption request retried in parallel is applied once', { skip }, async () => {
  const job = await startedJob();
  const part = await newPart(10);
  const k = key();
  const results = await race(Array.from({ length: 6 }, () => (c) => c.query('SELECT garage_ops06_consume_for_service($1,$2,$3,$4,NULL,$5,$6) r', [ids.tA, job.recordId, part, 2, 'mech-a', k])));
  assert.equal(winners(results).length, 6, 'every retry gets an answer');
  const usageIds = new Set(winners(results).map((r) => r.value.rows[0].r.usage_id));
  assert.equal(usageIds.size, 1, 'all answers describe the same usage');
  assert.equal((await one('SELECT stock_level FROM mechanic_parts WHERE id=$1', [part])).stock_level, 8);
});

test('RACE: duplicate invoice issuance — exactly one invoice, no number burnt', { skip }, async () => {
  for (let i = 0; i < 6; i += 1) {
    const job = await completedJob();
    const issue = (c) => c.query('SELECT * FROM garage_ops07_issue_invoice($1,$2,$3,$4::jsonb,$5,$6,$7,$8)', [ids.tA, job.woId, 'USD', JSON.stringify([{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }]), null, null, null, 'admin-a']);
    const results = await race([issue, issue, issue, issue]);
    assert.equal(winners(results).length, 1);
    for (const l of losers(results)) assert.match(l.message, /GARAGE_OPS07_INVOICE_ALREADY_ISSUED/);
    assert.equal((await one("SELECT count(*)::int n FROM garage_invoices WHERE work_order_id=$1 AND status='issued'", [job.woId])).n, 1);
  }
  const numbers = (await pool.query("SELECT invoice_number FROM garage_invoices WHERE tenant_id=$1 ORDER BY invoice_number", [ids.tA])).rows.map((r) => Number(r.invoice_number.slice(4)));
  assert.deepEqual(numbers, numbers.map((_, i) => numbers[0] + i), 'invoice numbers are consecutive: failed racers burnt none');
});

test('RACE: duplicate payment callbacks and over-collection', { skip }, async () => {
  const inv = await issuedInvoice(100);
  const k = key();
  const pay = (amount, k2) => (c) => c.query('SELECT garage_ops07_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [ids.tA, inv.invId, amount, 'USD', 'cash', null, new Date().toISOString(), 'admin-a', k2]);
  const dup = await race(Array.from({ length: 6 }, () => pay(40, k)));
  assert.equal(winners(dup).length, 6);
  assert.equal(new Set(winners(dup).map((r) => r.value.rows[0].r.payment_id)).size, 1, 'one payment, six identical answers');
  assert.equal((await one('SELECT count(*)::int n FROM garage_payment_records WHERE invoice_id=$1', [inv.invId])).n, 1);

  // two DIFFERENT callbacks that together exceed the balance (60 left): exactly one fits
  const over = await race([pay(60, key()), pay(60, key())]);
  assert.equal(winners(over).length, 1);
  for (const l of losers(over)) assert.match(l.message, /GARAGE_OPS07_PAYMENT_EXCEEDS_BALANCE/);
  const bal = await one('SELECT * FROM garage_ops07_invoice_balance($1)', [inv.invId]);
  assert.deepEqual([bal.paid_amount, bal.balance_amount, bal.payment_status], ['100.00', '0.00', 'paid']);
  assert.equal((await one("SELECT count(*)::int n FROM garage_receipts WHERE invoice_id=$1 AND status='issued'", [inv.invId])).n, 2);
});

test('RACE: parallel payments across invoices get unique, gapless receipt numbers', { skip }, async () => {
  const invoices = [];
  for (let i = 0; i < 6; i += 1) invoices.push(await issuedInvoice(50));
  const before = Number((await one("SELECT COALESCE(max(substr(receipt_number,5)::int),0) m FROM garage_receipts WHERE tenant_id=$1", [ids.tA])).m);
  const results = await race(invoices.map((inv) => (c) => c.query('SELECT garage_ops07_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [ids.tA, inv.invId, 50, 'USD', 'cash', null, new Date().toISOString(), 'admin-a', key()])));
  assert.equal(winners(results).length, 6);
  const numbers = winners(results).map((r) => Number(r.value.rows[0].r.receipt_number.slice(4))).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6].map((i) => before + i), 'consecutive and unique');
});

test('RACE: payment vs void — an invoice with money against it is never voided', { skip }, async () => {
  for (let i = 0; i < 8; i += 1) {
    const inv = await issuedInvoice(100);
    const results = await race([
      (c) => c.query('SELECT garage_ops07_record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [ids.tA, inv.invId, 100, 'USD', 'cash', null, new Date().toISOString(), 'admin-a', key()]),
      (c) => c.query('SELECT * FROM garage_ops07_void_invoice($1,$2,$3,$4)', [ids.tA, inv.invId, 'void it', 'admin-a']),
    ]);
    assert.equal(winners(results).length, 1, `iteration ${i}: exactly one of pay/void`);
    const row = await one('SELECT status FROM garage_invoices WHERE id=$1', [inv.invId]);
    const paid = Number((await one('SELECT paid_amount FROM garage_ops07_invoice_balance($1)', [inv.invId])).paid_amount);
    assert.ok(!(row.status === 'voided' && paid > 0), 'voided invoice carries payments');
  }
});

test('RACE: completing while a late service record is written — the count at completion is the truth', { skip }, async () => {
  const seen = { before: 0, refused: 0 };
  for (let i = 0; i < 20; i += 1) {
    const job = await startedJob();
    const results = await race([
      (c) => c.query('SELECT garage_ops05_complete_job($1,$2,$3) r', [ids.tA, job.caseId, 'admin-a']),
      (c) => addRecord(job, c),
    ]);
    assert.ok(results[0].ok, `iteration ${i}: completion itself must succeed (a record already exists): ${results[0].message}`);
    const completion = results[0].value.rows[0].r;
    const finalCount = (await one('SELECT count(*)::int n FROM service_records WHERE work_order_id=$1', [job.woId])).n;
    assert.equal(completion.service_record_count, finalCount, `iteration ${i}: records at completion (${completion.service_record_count}) == records that exist (${finalCount})`);
    if (results[1].ok) seen.before += 1; else { seen.refused += 1; assert.match(results[1].message, /GARAGE_OPS05_WORK_ORDER_TERMINAL|GARAGE_OPS05_WORK_NOT_STARTED/); }
    const wo = await one('SELECT status FROM mechanic_work_orders WHERE id=$1', [job.woId]);
    assert.equal(wo.status, 'Completed');
  }
  assert.equal(seen.before + seen.refused, 20);
});

test('RACE: completing while parts are being consumed', { skip }, async () => {
  for (let i = 0; i < 12; i += 1) {
    const job = await startedJob();
    const part = await newPart(5);
    const results = await race([
      (c) => c.query('SELECT garage_ops05_complete_job($1,$2,$3) r', [ids.tA, job.caseId, 'admin-a']),
      (c) => c.query('SELECT garage_ops06_consume_for_service($1,$2,$3,$4,NULL,$5,$6) r', [ids.tA, job.recordId, part, 1, 'mech-a', key()]),
    ]);
    assert.ok(results[0].ok);
    const usage = (await one('SELECT count(*)::int n FROM garage_service_part_usage WHERE work_order_id=$1', [job.woId])).n;
    const level = (await one('SELECT stock_level FROM mechanic_parts WHERE id=$1', [part])).stock_level;
    assert.equal(level, 5 - usage, 'stock agrees with usage whichever side won');
    if (!results[1].ok) assert.match(results[1].message, /GARAGE_OPS05_WORK_ORDER_TERMINAL/);
  }
});

test('RACE: start vs complete vs revoke on one case — no deadlock, and the case ends in a legal state', { skip }, async () => {
  for (let i = 0; i < 25; i += 1) {
    const j = await newCase();
    await pool.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [j.woId, ids.vinA]);
    await pool.query('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [j.woId, ids.tA, 'mech-a', 'admin-a']);
    const results = await race([
      (c) => c.query("UPDATE service_cases SET status='active' WHERE id=$1", [j.caseId]),
      (c) => c.query('SELECT garage_ops05_complete_job($1,$2,$3) r', [ids.tA, j.caseId, 'admin-a']),
      (c) => c.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','x')", [j.woId, ids.vinA]),
      (c) => c.query("UPDATE service_cases SET status='cancelled', cancelled_at=now() WHERE id=$1", [j.caseId]),
    ]);
    for (const r of results) if (!r.ok) assert.notEqual(r.error?.code, '40P01', `deadlock: ${r.message}`);
    const c = await one('SELECT status FROM service_cases WHERE id=$1', [j.caseId]);
    assert.ok(['accepted', 'active', 'cancelled'].includes(c.status), `unexpected case state ${c.status}`);
    const wo = await one('SELECT status, owner_authorization FROM mechanic_work_orders WHERE id=$1', [j.woId]);
    if (c.status === 'completed') assert.equal(wo.status, 'Completed');
  }
});

test('RACE: the customer decides while the garage cancels the job or the request — no deadlock, coherent end state', { skip }, async () => {
  for (let i = 0; i < 20; i += 1) {
    const f = await sentEstimate();
    const decide = (c) => c.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7) r', [f.estId, 'accepted', 'owner', 'customer-a', 'owner', null, null]);
    const cancelJob = (c) => c.query("UPDATE mechanic_work_orders SET status='Cancelled', cancelled_at=now() WHERE id=$1", [f.woId]);
    const cancelCase = (c) => c.query("UPDATE service_cases SET status='cancelled', cancelled_at=now() WHERE id=$1", [f.caseId]);
    const revise = (c) => c.query('SELECT * FROM garage_ops04_revise_estimate($1,$2,$3)', [ids.tA, f.estId, 'admin-a']);
    const results = await race([decide, i % 2 ? cancelJob : cancelCase, revise]);
    for (const r of results) if (!r.ok) assert.notEqual(r.error?.code, '40P01', `deadlock: ${r.message}`);
    const est = (await pool.query('SELECT status FROM garage_estimates WHERE work_order_id=$1 ORDER BY version', [f.woId])).rows.map((r) => r.status);
    const wo = await one('SELECT status, owner_authorization FROM mechanic_work_orders WHERE id=$1', [f.woId]);
    // whichever won, an accepted estimate always means an authorized job, and a cancelled job never has a live estimate
    if (est.includes('accepted')) assert.equal(wo.owner_authorization, 'authorized');
    if (wo.owner_authorization !== 'authorized') assert.ok(!est.includes('accepted'));
    assert.ok(est.filter((x) => ['draft', 'sent'].includes(x)).length <= 1, `at most one live estimate, got ${est}`);
    if (String(wo.status).toLowerCase() === 'cancelled') assert.ok(!est.some((x) => ['draft', 'sent'].includes(x)), 'cancelling the job cancels its open estimates');
  }
});

test('NO DEADLOCK was reported by PostgreSQL anywhere in the suite', { skip }, async () => {
  assert.deepEqual(deadlocks, []);
  const log = await one("SELECT deadlocks FROM pg_stat_database WHERE datname=$1", [dbName]);
  assert.equal(Number(log.deadlocks), 0, 'pg_stat_database counted a deadlock');
});
