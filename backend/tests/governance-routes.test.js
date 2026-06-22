/**
 * Milestone 5 — governance route tests (master plan §11.8).
 *
 * Drives the REAL governanceRoutes + authorizeRole + services over HTTP with a mocked
 * Supabase (NODE_ENV=test enables x-user-id / x-stakeholder-role header auth). Proves:
 *   - unauthorized roles are blocked (403) on privileged routes
 *   - a governed decision creates a review_decisions row AND a trust_audit_events row
 *   - a decision alone never writes trust_change_log (trust only via governed path)
 *   - non-privileged callers see a public-safe disputes projection (no leaks)
 *   - dispute lifecycle endpoints work end-to-end
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const governanceRouter = (await import('../routes/governanceRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

let db;
function resetDb() {
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'rev-1', role: 'reviewer', is_verified: true },
      { id: 'gov-1', role: 'government', is_verified: true },
      { id: 'owner-1', role: 'owner', is_verified: true },
      { id: 'dealer-1', role: 'dealer', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    user_sessions: [],
    tenant_users: [],
    temporal_findings: [
      { id: 'tf1', vin: 'VIN1', reviewer_state: 'pending_review', public_summary: 'bumper', created_at: '2026-06-01T00:00:00Z' },
      { id: 'tf2', vin: 'VIN1', reviewer_state: 'confirmed', public_summary: 'door', created_at: '2026-06-02T00:00:00Z' },
    ],
    disclosure_conflicts: [
      { id: 'dc1', vin: 'VIN1', reviewer_state: 'pending_review', public_summary: 'claim', created_at: '2026-06-03T00:00:00Z' },
    ],
    vehicle_identity_candidates: [{ id: 'ic1', vin: 'VIN1', status: 'pending', created_at: '2026-06-04T00:00:00Z' }],
    vehicle_evidence: [{ id: 'ev1', vin: 'VIN1', verification_status: 'pending', created_at: '2026-06-05T00:00:00Z' }],
    review_decisions: [],
    review_tasks: [],
    trust_audit_events: [],
    organization_audit_logs: [],
    organization_users: [],
    trust_change_log: [],
    disputes: [
      { id: 'd-pub', vin: 'VIN9', subject_type: 'temporal_finding', subject_id: 'tfx', raised_by: 'owner-1', raised_by_role: 'owner', status: 'resolved', created_at: '2026-06-10T00:00:00Z' },
    ],
    dispute_events: [],
  };
}

let seq = 0;
function builder(table) {
  if (!db[table]) db[table] = [];
  const st = { table, op: 'select', filters: [], order: null, single: false, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters.push([k, v]); return chain; },
    neq() { return chain; }, in() { return chain; }, is() { return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending !== false }; return chain; },
    limit() { return chain; },
    single() { st.single = true; return run(st, { maybe: false }); },
    maybeSingle() { st.single = true; return run(st, { maybe: true }); },
    then(res, rej) { return run(st, { maybe: false }).then(res, rej); },
  };
  return chain;
}

function run(st, { maybe }) {
  const rows = db[st.table];
  const ok = (data) => Promise.resolve({ data, error: null });
  const match = (r) => st.filters.every(([k, v]) => r[k] === v);

  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p) => ({ id: p.id || `${st.table}-${++seq}`, created_at: p.created_at || new Date().toISOString(), ...clone(p) }));
    rows.push(...ins);
    return ok(st.single ? clone(ins[0]) : clone(ins));
  }
  if (st.op === 'update') {
    const updated = [];
    for (const r of rows) if (match(r)) { Object.assign(r, clone(st.payload)); updated.push(clone(r)); }
    if (st.single) return Promise.resolve({ data: updated[0] || null, error: updated.length || maybe ? null : { message: 'No rows updated' } });
    return ok(updated);
  }
  let out = rows.filter(match).map(clone);
  if (st.order) out = out.sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.col] || '').localeCompare(String(b[st.order.col] || '')));
  if (st.single) return Promise.resolve({ data: out[0] || null, error: out.length || maybe ? null : { message: 'No rows found' } });
  return ok(out);
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => builder(t) });
  const app = express();
  app.use(express.json());
  app.use(governanceRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

function hdr(userId, role) {
  const h = { 'content-type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  if (role) h['x-stakeholder-role'] = role;
  return h;
}
async function call(method, path, { userId, role, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: hdr(userId, role), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- authorization -----------------------------------------------------------

test('review-queue requires a reviewer role (owner blocked, admin allowed)', async () => {
  assert.equal((await call('GET', '/api/governance/review-queue', { userId: 'owner-1' })).status, 403);
  const ok = await call('GET', '/api/governance/review-queue', { userId: 'admin-1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.total, 4);
});

test('decisions endpoint blocks non-reviewer roles (403)', async () => {
  const res = await call('POST', '/api/governance/decisions', { userId: 'owner-1', body: { targetType: 'temporal_findings', targetId: 'tf1', vin: 'VIN1', decision: 'confirm', notes: 'x' } });
  assert.equal(res.status, 403);
});

test('spoofed x-stakeholder-role does not grant reviewer authority (403)', async () => {
  const res = await call('POST', '/api/governance/decisions', { userId: 'owner-1', role: 'admin', body: { targetType: 'temporal_findings', targetId: 'tf1', decision: 'confirm' } });
  assert.equal(res.status, 403);
});

test('a governed decision creates a review_decisions row + a trust_audit_events row, but no trust_change_log', async () => {
  const res = await call('POST', '/api/governance/decisions', { userId: 'admin-1', body: { targetType: 'temporal_findings', targetId: 'tf1', vin: 'VIN1', decision: 'confirm', notes: 'invoice', policyVersion: 'v1' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.decision.decision, 'confirm');
  assert.equal(db.temporal_findings[0].reviewer_state, 'confirmed');
  assert.equal(db.review_decisions.length, 1);
  assert.ok(db.trust_audit_events.some((e) => e.event_type === 'GOVERNANCE_DECISION_APPLIED'));
  assert.equal(db.trust_change_log.length, 0); // decision alone never changes trust
});

test('decisions validates required fields (400)', async () => {
  const res = await call('POST', '/api/governance/decisions', { userId: 'admin-1', body: { targetType: 'temporal_findings' } });
  assert.equal(res.status, 400);
});

test('decision on a missing target returns 404', async () => {
  const res = await call('POST', '/api/governance/decisions', { userId: 'admin-1', body: { targetType: 'temporal_findings', targetId: 'nope', decision: 'confirm' } });
  assert.equal(res.status, 404);
});

// --- disputes ----------------------------------------------------------------

test('buyer cannot raise a dispute (403); owner can (201)', async () => {
  assert.equal((await call('POST', '/api/governance/disputes', { userId: 'buyer-1', body: { vin: 'VIN1', subjectType: 'temporal_finding', subjectId: 'tf2', reason: 'wrong' } })).status, 403);
  const ok = await call('POST', '/api/governance/disputes', { userId: 'owner-1', body: { vin: 'VIN1', subjectType: 'temporal_finding', subjectId: 'tf2', reason: 'wrong' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.dispute.status, 'open');
});

test('full dispute lifecycle over HTTP: respond -> assign -> resolve(upheld) supersedes finding', async () => {
  const created = await call('POST', '/api/governance/disputes', { userId: 'owner-1', body: { vin: 'VIN1', subjectType: 'temporal_findings', subjectId: 'tf2', reason: 'wrong' } });
  const id = created.body.dispute.id;

  assert.equal((await call('POST', `/api/governance/disputes/${id}/respond`, { userId: 'owner-1', body: { response: 'invoice' } })).status, 200);
  assert.equal((await call('POST', `/api/governance/disputes/${id}/assign`, { userId: 'admin-1', body: { reviewerId: 'rev-1' } })).status, 200);

  const resolved = await call('POST', `/api/governance/disputes/${id}/resolve`, { userId: 'gov-1', body: { resolution: 'accepted', outcome: 'upheld', targetType: 'temporal_findings', targetId: 'tf2' } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.dispute.status, 'resolved');
  assert.equal(db.temporal_findings[1].reviewer_state, 'superseded'); // corrected, retained
  assert.ok(db.review_decisions.some((d) => d.target_id === 'tf2' && d.decision === 'supersede'));
});

test('non-reviewer cannot assign or resolve (403)', async () => {
  assert.equal((await call('POST', '/api/governance/disputes/d-pub/assign', { userId: 'owner-1', body: { reviewerId: 'rev-1' } })).status, 403);
  assert.equal((await call('POST', '/api/governance/disputes/d-pub/resolve', { userId: 'dealer-1', body: { resolution: 'x' } })).status, 403);
});

test('vehicles/:vin/disputes is public-safe for non-privileged callers', async () => {
  // privileged sees full rows
  const priv = await call('GET', '/api/vehicles/VIN9/disputes', { userId: 'admin-1' });
  assert.equal(priv.status, 200);
  assert.equal(priv.body.disputes.length, 1);
  assert.ok('raised_by' in priv.body.disputes[0]);

  // non-privileged gets a stripped, public-safe projection (no raised_by / internal ids)
  const pub = await call('GET', '/api/vehicles/VIN9/disputes', { userId: 'buyer-1' });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.disputes.length, 1);
  assert.equal('raised_by' in pub.body.disputes[0], false);
  assert.ok('public_state' in pub.body.disputes[0]);
});
