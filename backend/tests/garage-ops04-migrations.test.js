import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, seedAcceptedCase } from './helpers/garageFinalWorld.js';
import { migrationUpSql } from './helpers/pgliteLedgerHarness.js';

const OPS04 = '20261024100000_garage_ops04_estimates_and_authorization.sql';
const LINES = [
  { category: 'labour', description: 'Brake pad replacement', quantity: 2, unit_price: 45 },
  { category: 'part', description: 'Front pads', quantity: 1, unit_price: 80.5 },
];

let world;
let db;

async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    if (pattern) assert.match(String(error.message), pattern, `expected ${pattern}, got: ${error.message}`);
    return error;
  }
  assert.fail(`expected a rejection${pattern ? ' matching ' + pattern : ''}`);
}

const create = (c, { currency = 'USD', lines = LINES, actor = 'admin-a', tenant = c.tenant, validUntil = null } = {}) =>
  db.query('SELECT * FROM garage_ops04_create_estimate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
    [tenant, c.workOrderId, currency, 'Customer note', 'Internal note', validUntil, JSON.stringify(lines), actor]);
const send = (c, id, { actor = 'admin-a', tenant = c.tenant } = {}) =>
  db.query('SELECT * FROM garage_ops04_send_estimate($1,$2,$3)', [tenant, id, actor]);
const decide = (id, decision, { actor = 'customer-a', basis = 'owner', role = 'owner', reason = null, tenant = null } = {}) =>
  db.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7) r', [id, decision, basis, actor, role, tenant, reason]);
const revise = (c, id, actor = 'admin-a') =>
  db.query('SELECT * FROM garage_ops04_revise_estimate($1,$2,$3)', [c.tenant, id, actor]);
const workOrder = async (c) => (await db.query(
  'SELECT owner_authorization, owner_authorized_by FROM mechanic_work_orders WHERE id=$1', [c.workOrderId])).rows[0];
const estimate = async (id) => (await db.query('SELECT * FROM garage_estimates WHERE id=$1', [id])).rows[0];
const events = async (id) => (await db.query(
  'SELECT event_type, actor_scope, previous_status, new_status FROM garage_estimate_events WHERE estimate_id=$1 ORDER BY seq', [id])).rows;
async function freshCase(opts) { return seedAcceptedCase(world, opts); }

before(async () => {
  world = await createGarageFinalWorld({ after: [OPS04] });
  db = world.db;
  // replay-safety: the migration must be idempotent
  await db.exec(migrationUpSql(OPS04));
});
after(async () => { await db?.close(); });

test('OPS04 tables are private (RLS forced) and the RPCs are service_role-only', async () => {
  for (const table of ['garage_estimates', 'garage_estimate_lines', 'garage_estimate_events']) {
    const { rows: [rls] } = await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1', [table]);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    const { rows: [p] } = await db.query(
      "SELECT has_table_privilege('anon',$1,'SELECT') a, has_table_privilege('authenticated',$1,'SELECT') u, has_table_privilege('service_role',$1,'SELECT') s",
      [table]);
    assert.deepEqual(p, { a: false, u: false, s: true });
  }
  // history and estimates are never destroyed through the API role
  const { rows: [d] } = await db.query(
    "SELECT has_table_privilege('service_role','garage_estimates','DELETE') est, has_table_privilege('service_role','garage_estimate_events','UPDATE') ev, has_table_privilege('service_role','garage_estimate_events','DELETE') evd");
  assert.deepEqual(d, { est: false, ev: false, evd: false });

  const { rows } = await db.query(
    `SELECT p.proname,
            has_function_privilege('anon', p.oid, 'EXECUTE') a,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
            has_function_privilege('service_role', p.oid, 'EXECUTE') s
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
        'garage_ops04_create_estimate','garage_ops04_replace_draft','garage_ops04_send_estimate',
        'garage_ops04_revise_estimate','garage_ops04_cancel_estimate','garage_ops04_decide_estimate',
        'garage_ops04_log','garage_ops04_write_lines','garage_ops04_estimate_totals')`);
  assert.equal(rows.length, 9);
  for (const r of rows) assert.deepEqual({ a: r.a, u: r.u, s: r.s }, { a: false, u: false, s: true }, r.proname);
});

test('happy path: draft -> sent -> accepted converges onto the canonical work-order authorization', async () => {
  const c = await freshCase();
  const draft = (await create(c)).rows[0];
  assert.equal(draft.status, 'draft');
  assert.equal(draft.version, 1);
  assert.equal(draft.sent_total_amount, null, 'a draft has no frozen total');
  const sent = (await send(c, draft.id)).rows[0];
  assert.equal(sent.status, 'sent');
  assert.equal(sent.sent_total_amount, '170.50', 'the total is derived by the database from the stored lines');
  assert.equal((await workOrder(c)).owner_authorization, 'pending', 'sending an estimate authorizes nothing');

  const { rows: [{ r }] } = await decide(draft.id, 'accepted');
  assert.equal(r.work_order_authorization, 'authorized');
  assert.equal((await workOrder(c)).owner_authorization, 'authorized');
  assert.equal((await workOrder(c)).owner_authorized_by, 'customer-a');
  assert.equal((await estimate(draft.id)).status, 'accepted');
  assert.deepEqual((await events(draft.id)).map((e) => e.event_type), ['created', 'sent', 'accepted']);

  const { rows: audit } = await db.query(
    "SELECT event_type FROM trust_audit_events WHERE event_type IN ('GARAGE_ESTIMATE_SENT','GARAGE_ESTIMATE_ACCEPTED','WORK_ORDER_OWNER_AUTHORIZATION') ORDER BY created_at, id");
  const kinds = audit.map((a) => a.event_type);
  assert.ok(kinds.includes('GARAGE_ESTIMATE_SENT') && kinds.includes('GARAGE_ESTIMATE_ACCEPTED') && kinds.includes('WORK_ORDER_OWNER_AUTHORIZATION'));
});

test('money truth: explicit currency, no price is "not recorded", zero is explicitly free, totals are server-derived', async () => {
  const c = await freshCase();
  await rejects(create(c, { currency: null }), /null value|currency|violates not-null/i);
  await rejects(create(c, { currency: 'usd' }), /GARAGE_OPS04_CURRENCY_UNSUPPORTED/);
  await rejects(create(c, { currency: 'KWD' }), /GARAGE_OPS04_CURRENCY_UNSUPPORTED/);

  const mixed = (await create(c, { lines: [
    { category: 'labour', description: 'Inspection', quantity: 1, unit_price: 20 },
    { category: 'part', description: 'Wiper blades', quantity: 2 },
  ] })).rows[0];
  const stored = (await db.query('SELECT unit_price, line_total FROM garage_estimate_lines WHERE estimate_id=$1 ORDER BY line_no', [mixed.id])).rows;
  assert.equal(stored[0].line_total, '20.00');
  assert.equal(stored[1].unit_price, null, 'an unpriced line is NULL, never 0');
  assert.equal(stored[1].line_total, null);
  const { rows: [t] } = await db.query('SELECT * FROM garage_ops04_estimate_totals($1)', [mixed.id]);
  assert.equal(t.line_count, 2);
  assert.equal(t.priced_line_count, 1);
  assert.equal(t.total_amount, null, 'a partial sum is not a total');
  await rejects(send(c, mixed.id), /GARAGE_OPS04_ESTIMATE_NOT_PRICED/);
  assert.equal((await estimate(mixed.id)).status, 'draft');

  // a client can never write a line total
  await rejects(
    db.query("INSERT INTO garage_estimate_lines (tenant_id,estimate_id,line_no,category,description,quantity,unit_price,line_total) VALUES ($1,$2,9,'fee','x',1,1,999)", [c.tenant, mixed.id]),
    /generated|cannot insert/i);

  // explicit zero is a recorded price (free), distinct from not-recorded
  const free = (await db.query('SELECT * FROM garage_ops04_replace_draft($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
    [c.tenant, mixed.id, 'USD', null, null, null,
      JSON.stringify([{ category: 'fee', description: 'Goodwill check', quantity: 1, unit_price: 0 }]), null, 'admin-a'])).rows[0];
  const sentFree = (await send(c, free.id)).rows[0];
  assert.equal(sentFree.sent_total_amount, '0.00');
});

test('money truth: amounts must be exactly representable in the estimate currency', async () => {
  const c = await freshCase();
  await rejects(
    create(c, { currency: 'JPY', lines: [{ category: 'labour', description: 'Alignment', quantity: 1, unit_price: 100.5 }] }),
    /GARAGE_OPS04_AMOUNT_EXCEEDS_CURRENCY_PRECISION/);
  const ok = (await create(c, { currency: 'JPY', lines: [{ category: 'labour', description: 'Alignment', quantity: 1.5, unit_price: 100 }] })).rows[0];
  assert.equal((await send(c, ok.id)).rows[0].sent_total_amount, '150.00');
  await rejects(
    db.query("SELECT * FROM garage_ops04_create_estimate($1,$2,'ZWG',NULL,NULL,NULL,'[{\"category\":\"sundries\",\"description\":\"x\",\"quantity\":1}]'::jsonb,$3)", [c.tenant, c.workOrderId, 'admin-a']),
    /GARAGE_OPS04_LIVE_ESTIMATE_EXISTS/);
});

test('line input is validated in the database as well as the service', async () => {
  const c = await freshCase();
  for (const [lines, pattern] of [
    [[{ category: 'sundries', description: 'x', quantity: 1, unit_price: 1 }], /LINE_CATEGORY_INVALID/],
    [[{ category: 'fee', description: '   ', quantity: 1, unit_price: 1 }], /LINE_DESCRIPTION_INVALID/],
    [[{ category: 'fee', description: 'x', quantity: 0, unit_price: 1 }], /LINE_QUANTITY_INVALID/],
    [[{ category: 'fee', description: 'x', quantity: 'abc', unit_price: 1 }], /LINE_NUMBER_INVALID/],
    [[{ category: 'fee', description: 'x', quantity: 1, unit_price: -5 }], /LINE_PRICE_INVALID/],
    [{ not: 'an array' }, /LINES_INVALID/],
  ]) await rejects(create(c, { lines }), pattern);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_estimates WHERE work_order_id=$1', [c.workOrderId])).rows[0].n, 0,
    'a rejected create leaves nothing behind');
});

test('a sent version is immutable; history is append-only; nothing is deleted', async () => {
  const c = await freshCase();
  const draft = (await create(c)).rows[0];
  await send(c, draft.id);
  await rejects(db.query("UPDATE garage_estimates SET currency='ZAR' WHERE id=$1", [draft.id]), /SENT_ESTIMATE_IMMUTABLE/);
  await rejects(db.query("UPDATE garage_estimates SET sent_total_amount=1 WHERE id=$1", [draft.id]), /SENT_ESTIMATE_IMMUTABLE/);
  await rejects(db.query("UPDATE garage_estimates SET customer_note='changed' WHERE id=$1", [draft.id]), /SENT_ESTIMATE_IMMUTABLE/);
  await rejects(db.query("UPDATE garage_estimate_lines SET unit_price=1 WHERE estimate_id=$1", [draft.id]), /ESTIMATE_LINES_LOCKED/);
  await rejects(db.query("DELETE FROM garage_estimate_lines WHERE estimate_id=$1", [draft.id]), /ESTIMATE_LINES_LOCKED/);
  await rejects(db.query("INSERT INTO garage_estimate_lines (tenant_id,estimate_id,line_no,category,description,quantity,unit_price) VALUES ($1,$2,50,'fee','late',1,1)", [c.tenant, draft.id]), /ESTIMATE_LINES_LOCKED/);
  await rejects(db.query('DELETE FROM garage_estimates WHERE id=$1', [draft.id]), /NEVER_DELETED/);
  await rejects(db.query("UPDATE garage_estimate_events SET event_type='created' WHERE estimate_id=$1", [draft.id]), /EVENTS_APPEND_ONLY/);
  await rejects(db.query('DELETE FROM garage_estimate_events WHERE estimate_id=$1', [draft.id]), /EVENTS_APPEND_ONLY/);
  await rejects(db.query("UPDATE garage_estimates SET status='draft' WHERE id=$1", [draft.id]), /TRANSITION_NOT_ALLOWED/);
  await rejects(db.query("UPDATE garage_estimates SET status='accepted' WHERE id=$1", [draft.id]), /decision_truth|violates check/i);
  await rejects(db.query("UPDATE garage_estimates SET version=9 WHERE id=$1", [draft.id]), /IDENTITY_IMMUTABLE/);
});

test('a decided estimate cannot be re-decided, and its decision stamps cannot be rewritten', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  await decide(e.id, 'accepted');
  await rejects(decide(e.id, 'declined'), /GARAGE_OPS04_ESTIMATE_NOT_PENDING/);
  await rejects(decide(e.id, 'accepted'), /GARAGE_OPS04_ESTIMATE_NOT_PENDING/);
  await rejects(db.query("UPDATE garage_estimates SET decision_reason='rewritten' WHERE id=$1", [e.id]), /DECIDED_ESTIMATE_IMMUTABLE/);
  assert.equal((await workOrder(c)).owner_authorization, 'authorized');
});

test('versioning: revising a sent estimate supersedes it and opens the next draft with the same lines', async () => {
  const c = await freshCase();
  const v1 = (await create(c)).rows[0];
  await send(c, v1.id);
  await rejects(create(c), /GARAGE_OPS04_LIVE_ESTIMATE_EXISTS/);
  const v2 = (await revise(c, v1.id)).rows[0];
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'draft');
  assert.equal((await estimate(v1.id)).status, 'superseded');
  const copied = (await db.query('SELECT description, unit_price FROM garage_estimate_lines WHERE estimate_id=$1 ORDER BY line_no', [v2.id])).rows;
  assert.equal(copied.length, 2);
  // the superseded version's lines are untouched
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_estimate_lines WHERE estimate_id=$1', [v1.id])).rows[0].n, 2);
  // an old version can no longer be decided or revised
  await rejects(decide(v1.id, 'accepted'), /ESTIMATE_NOT_PENDING/);
  await rejects(revise(c, v1.id), /ESTIMATE_NOT_REVISABLE/);
  assert.equal((await workOrder(c)).owner_authorization, 'pending');
  assert.deepEqual((await events(v1.id)).map((e) => e.event_type), ['created', 'sent', 'superseded']);
  assert.deepEqual((await events(v2.id)).map((e) => e.event_type), ['revised']);
});

test('decline: no authorization is granted; a revised version can still be accepted later', async () => {
  const c = await freshCase();
  const v1 = (await create(c)).rows[0];
  await send(c, v1.id);
  const { rows: [{ r: declined }] } = await decide(v1.id, 'declined', { reason: 'too expensive' });
  assert.equal(declined.work_order_authorization, 'declined');
  assert.equal((await estimate(v1.id)).status, 'declined');
  assert.equal((await workOrder(c)).owner_authorization, 'declined');

  const v2 = (await revise(c, v1.id)).rows[0];
  assert.equal(v2.version, 2);
  assert.equal((await estimate(v1.id)).status, 'declined', 'a declined version stays declined history');
  await send(c, v2.id);
  // declined again while the work order is already declined: the canonical state already says so
  const { rows: [{ r: again }] } = await decide(v2.id, 'declined');
  assert.equal(again.work_order_authorization, 'declined');
  const v3 = (await revise(c, v2.id)).rows[0];
  await send(c, v3.id);
  await decide(v3.id, 'accepted');
  assert.equal((await workOrder(c)).owner_authorization, 'authorized');
  assert.deepEqual(
    (await db.query('SELECT version,status FROM garage_estimates WHERE work_order_id=$1 ORDER BY version', [c.workOrderId])).rows,
    [{ version: 1, status: 'declined' }, { version: 2, status: 'declined' }, { version: 3, status: 'accepted' }]);
});

test('after authorization the scope is final: no new or revised estimate, no second acceptance', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  await decide(e.id, 'accepted');
  await rejects(create(c), /GARAGE_OPS04_AUTHORIZATION_FINAL/);
  await rejects(revise(c, e.id), /ESTIMATE_NOT_REVISABLE/);
});

test('the work order can only be decided THROUGH a pending estimate (no estimate-sent/work-order-authorized split)', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  // a draft does not block the canonical path; authorizing directly retires the now-unsendable draft
  await send(c, e.id);
  await rejects(
    db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin]),
    /GARAGE_OPS04_DECISION_VIA_ESTIMATE/);
  await rejects(
    db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','declined',NULL)", [c.workOrderId, c.vin]),
    /GARAGE_OPS04_DECISION_VIA_ESTIMATE/);
  await rejects(
    db.query("UPDATE mechanic_work_orders SET owner_authorization='authorized', owner_authorized_by='customer-a', owner_authorized_at=now() WHERE id=$1", [c.workOrderId]),
    /GARAGE_OPS04_DECISION_VIA_ESTIMATE/);
  assert.equal((await workOrder(c)).owner_authorization, 'pending');
  assert.equal((await estimate(e.id)).status, 'sent');

  // with NO estimate the existing owner path is untouched (OC-5A is not weakened)
  const d = await freshCase({ garage: 'b' });
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-b','owner',NULL,'owner','authorized',NULL)", [d.workOrderId, d.vin]);
  assert.equal((await workOrder(d)).owner_authorization, 'authorized');

  // a draft estimate is cancelled when the work order is authorized without it
  const f = await freshCase({ garage: 'b' });
  const draft = (await create(f, { tenant: f.tenant, actor: 'admin-b' })).rows[0];
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-b','owner',NULL,'owner','authorized',NULL)", [f.workOrderId, f.vin]);
  assert.equal((await estimate(draft.id)).status, 'cancelled');
  assert.deepEqual((await events(draft.id)).map((x) => [x.event_type, x.actor_scope]), [['created', 'garage'], ['cancelled', 'system']]);
});

test('revoking an authorized work order is recorded against the accepted estimate without rewriting it', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  await decide(e.id, 'accepted');
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','changed my mind')", [c.workOrderId, c.vin]);
  assert.equal((await estimate(e.id)).status, 'accepted', 'the historical decision is not rewritten');
  const kinds = (await events(e.id)).map((x) => x.event_type);
  assert.equal(kinds.at(-1), 'authorization_revoked');
});

test('FAIL-ATOMIC: if the audit write fails the estimate decision, the authorization and the history all roll back', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  await db.exec(
    "CREATE OR REPLACE FUNCTION ops04_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = 'GARAGE_ESTIMATE_ACCEPTED' THEN RAISE EXCEPTION 'OPS04_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops04_test_fail_audit BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION ops04_test_fail_audit();");
  try {
    await rejects(decide(e.id, 'accepted'), /OPS04_TEST_AUDIT_FAILURE/);
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS trg_ops04_test_fail_audit ON trust_audit_events; DROP FUNCTION IF EXISTS ops04_test_fail_audit();');
  }
  assert.equal((await estimate(e.id)).status, 'sent', 'estimate untouched');
  assert.equal((await workOrder(c)).owner_authorization, 'pending', 'canonical authorization untouched');
  assert.equal((await workOrder(c)).owner_authorized_by, null);
  assert.deepEqual((await events(e.id)).map((x) => x.event_type), ['created', 'sent'], 'no half-written history');
  const guard = (await db.query("SELECT current_setting('garage.ops04_decision', true) AS v")).rows[0].v;
  assert.ok(!guard, 'the sanctioned-decision flag does not leak out of the failed transaction');
  // and the decision still works afterwards
  await decide(e.id, 'accepted');
  assert.equal((await workOrder(c)).owner_authorization, 'authorized');
});

test('FAIL-ATOMIC: if the canonical authorization refuses (not the owner) nothing on the estimate changes', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  const err = await rejects(decide(e.id, 'accepted', { actor: 'customer-b' }), /registered owner/);
  assert.equal(err.code, '42501');
  const stranger = await rejects(decide(e.id, 'accepted', { actor: 'stranger' }), /registered owner/);
  assert.equal(stranger.code, '42501');
  assert.equal((await estimate(e.id)).status, 'sent');
  assert.equal((await workOrder(c)).owner_authorization, 'pending');
  assert.deepEqual((await events(e.id)).map((x) => x.event_type), ['created', 'sent']);
});

test('the assigned mechanic cannot authorize work through an estimate either', async () => {
  const c = await freshCase();
  await db.query("UPDATE mechanic_work_orders SET mechanic_id='customer-a' WHERE id=$1", [c.workOrderId]);
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  const err = await rejects(decide(e.id, 'accepted'), /cannot authorize it/);
  assert.equal(err.code, '42501');
  assert.equal((await estimate(e.id)).status, 'sent');
});

test('tenancy: Garage B cannot read-through, create, send, revise, cancel or edit Garage A estimates', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  // Garage B's admin addressing Garage A's work order
  await rejects(create(c, { tenant: world.T.b, actor: 'admin-b' }), /GARAGE_OPS04_WORK_ORDER_NOT_FOUND/);
  for (const sql of [
    ['SELECT * FROM garage_ops04_send_estimate($1,$2,$3)', [world.T.b, e.id, 'admin-b']],
    ['SELECT * FROM garage_ops04_cancel_estimate($1,$2,$3,$4)', [world.T.b, e.id, 'x', 'admin-b']],
    ['SELECT * FROM garage_ops04_replace_draft($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)', [world.T.b, e.id, 'USD', null, null, null, '[]', null, 'admin-b']],
  ]) await rejects(db.query(...sql), /GARAGE_OPS04_ESTIMATE_NOT_FOUND/);
  // Garage A's admin claiming to act for Garage B
  await rejects(create(c, { tenant: world.T.b, actor: 'admin-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  assert.equal((await estimate(e.id)).status, 'draft');
});

test('a mechanic (non-admin) cannot draft, send, revise or cancel estimates', async () => {
  const c = await freshCase();
  await rejects(create(c, { actor: 'mech-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  const e = (await create(c)).rows[0];
  await rejects(send(c, e.id, { actor: 'mech-a' }), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(db.query('SELECT * FROM garage_ops04_cancel_estimate($1,$2,$3,$4)', [c.tenant, e.id, null, 'mech-a']), /GARAGE_OPS03_ADMIN_REQUIRED/);
  await rejects(db.query('SELECT * FROM garage_ops04_revise_estimate($1,$2,$3)', [c.tenant, e.id, 'mech-a']), /GARAGE_OPS03_ADMIN_REQUIRED/);
});

test('an estimate needs an accepted case and an open, still-pending work order', async () => {
  const c = await freshCase();
  await db.query("UPDATE service_cases SET status='active' WHERE id=$1", [c.caseId]);
  await rejects(create(c), /GARAGE_OPS04_CASE_MUST_BE_ACCEPTED/);
  const d = await freshCase();
  await db.query("UPDATE mechanic_work_orders SET status='Completed' WHERE id=$1", [d.workOrderId]);
  await rejects(create(d), /GARAGE_OPS04_WORK_ORDER_TERMINAL/);
  const e = await freshCase();
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [e.workOrderId, e.vin]);
  await rejects(create(e), /GARAGE_OPS04_AUTHORIZATION_FINAL/);
});

test('an estimate cannot be sent empty, and cancelling is a state not a deletion', async () => {
  const c = await freshCase();
  const empty = (await create(c, { lines: [] })).rows[0];
  await rejects(send(c, empty.id), /GARAGE_OPS04_ESTIMATE_HAS_NO_LINES/);
  const cancelled = (await db.query('SELECT * FROM garage_ops04_cancel_estimate($1,$2,$3,$4)', [c.tenant, empty.id, 'not needed', 'admin-a'])).rows[0];
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancel_reason, 'not needed');
  await rejects(send(c, empty.id), /ESTIMATE_NOT_DRAFT/);
  // a new draft is possible again (the live slot was freed) and is version 2
  const next = (await create(c)).rows[0];
  assert.equal(next.version, 2);
});

test('draft editing is optimistic: a stale save is refused, a current save replaces the lines atomically', async () => {
  const c = await freshCase();
  const d = (await create(c)).rows[0];
  const replace = (expected, lines) => db.query(
    'SELECT * FROM garage_ops04_replace_draft($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
    [c.tenant, d.id, 'USD', 'n', 'i', null, JSON.stringify(lines), expected, 'admin-a']);
  const saved = (await replace(d.updated_at, [{ category: 'fee', description: 'Call-out', quantity: 1, unit_price: 10 }])).rows[0];
  assert.notEqual(String(saved.updated_at), String(d.updated_at));
  await rejects(replace(d.updated_at, []), /GARAGE_OPS04_STALE_DRAFT/);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_estimate_lines WHERE estimate_id=$1', [d.id])).rows[0].n, 1);
  // a failing replacement keeps the previous lines (delete + insert are one statement block)
  await rejects(replace(saved.updated_at, [{ category: 'nope', description: 'x', quantity: 1 }]), /LINE_CATEGORY_INVALID/);
  assert.equal((await db.query('SELECT count(*)::int n FROM garage_estimate_lines WHERE estimate_id=$1', [d.id])).rows[0].n, 1);
});

test('validity: an expired estimate cannot be accepted but can still be declined', async () => {
  const c = await freshCase();
  const soon = new Date(Date.now() + 1500).toISOString();
  const e = (await create(c, { validUntil: soon })).rows[0];
  await send(c, e.id);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await rejects(decide(e.id, 'accepted'), /GARAGE_OPS04_ESTIMATE_EXPIRED/);
  assert.equal((await workOrder(c)).owner_authorization, 'pending');
  await decide(e.id, 'declined');
  assert.equal((await estimate(e.id)).status, 'declined');
  await rejects(create(c, { validUntil: new Date(Date.now() - 1000).toISOString() }), /VALID_UNTIL_IN_PAST/);
});

test('a case that ends without work, or a cancelled work order, takes its open estimates with it', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await send(c, e.id);
  await db.query("UPDATE service_cases SET status='cancelled', cancelled_at=now() WHERE id=$1", [c.caseId]);
  assert.equal((await estimate(e.id)).status, 'cancelled');
  assert.equal((await events(e.id)).at(-1).event_type, 'cancelled');

  const d = await freshCase();
  const f = (await create(d)).rows[0];
  await db.query("UPDATE mechanic_work_orders SET status='Cancelled', cancelled_at=now() WHERE id=$1", [d.workOrderId]);
  assert.equal((await estimate(f.id)).status, 'cancelled');
  assert.equal((await workOrder(d)).owner_authorization, 'pending', 'cancelling never authorizes');
});

test('only a decided estimate can carry a decision: accept/decline columns cannot be forged on a draft', async () => {
  const c = await freshCase();
  const e = (await create(c)).rows[0];
  await rejects(
    db.query("UPDATE garage_estimates SET decided_at=now(), decided_by_user_id='customer-a', decision_basis='owner' WHERE id=$1", [e.id]),
    /decision_truth|violates check/i);
  await rejects(decide(e.id, 'accepted'), /GARAGE_OPS04_ESTIMATE_NOT_PENDING/);
  await rejects(decide(e.id, 'maybe'), /GARAGE_OPS04_DECISION_INVALID/);
  await rejects(decide(e.id, 'accepted', { basis: 'self' }), /GARAGE_OPS04_BASIS_INVALID/);
  await rejects(decide(e.id, 'accepted', { actor: '' }), /GARAGE_OPS04_ACTOR_REQUIRED/);
});
