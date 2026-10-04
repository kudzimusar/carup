/**
 * Milestone 1 route tests — taxonomy discovery, source registry (public-safe),
 * evidence sets, and chain-of-custody provenance (session + evidence object authority, OC-4A).
 *
 * Drives the real evidenceCatalogRouter over HTTP with a table-aware in-memory
 * Supabase mock + the real authorizeRole middleware (x-user-id fallback in test mode — except on the
 * provenance route, which since OC-4A requires a real session; its full contract is proven in
 * oc4a-provenance-object-authority.test.js on PostgreSQL).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/evidenceCatalogRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const provenance = await import('../services/evidence/provenanceService.js');

// ---- table-aware in-memory mock ------------------------------------------------------
const EV1 = '0b6f3c2e-7a43-4c1e-9d3a-5e2f1a7b8c90'; // vehicle_evidence.id is a UUID
let db;
function resetDb() {
  db = {
    users: [
      { id: 'owner-1', role: 'owner', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    user_sessions: ['owner-1', 'admin-1', 'buyer-1'].map((id) => ({ token: `session-${id}`, user_id: id, is_valid: true, expires_at: '2999-01-01T00:00:00.000Z' })),
    vehicles: [{ vin: 'VINSET', owner_id: 'owner-1', current_seller_id: null, tenant_id: null }],
    evidence_sources: [{
      id: 'src1', code: 'gov', display_name: 'Government Registry', source_type: 'government',
      organization: 'CVR', country: 'ZW', verification_status: 'verified', trust_tier: 'high',
      permitted_evidence_classes: ['ownership_transfer'], active: true,
      contact_reference: 'SECRET-CONTACT', credential_reference: 'SECRET-CRED',
    }],
    evidence_sets: [],
    vehicle_evidence: [{ id: EV1, vin: 'VINSET', evidence_class: 'repair', uploaded_by: 'owner-1' }],
    evidence_provenance_events: [],
  };
}

function builder(t) {
  const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    neq() { return chain; },
    in() { return chain; },
    is() { return chain; },
    order(col, opts) { st.order = { col, asc: opts?.ascending ?? false }; return chain; },
    limit(n) { st.lim = n; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.single = true; st.maybe = true; return chain; },
    then(res, rej) {
      try { return Promise.resolve(run(st)).then(res, rej); }
      catch (e) { return rej ? rej(e) : Promise.reject(e); }
    },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.t] = db[st.t] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const inserted = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p }));
    rows.push(...inserted);
    return ok(st.single ? inserted[0] : inserted);
  }
  if (st.op === 'update') {
    const updated = [];
    for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); updated.push(r); }
    return ok(updated);
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : (a[st.order.col] < b[st.order.col]) ? -1 : 0));
  if (st.lim != null) out = out.slice(0, st.lim);
  if (st.single) return out[0] ? ok(out[0]) : (st.maybe ? ok(null) : { data: null, error: { message: 'not found' } });
  return ok(out);
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => builder(t) });
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

const j = (res) => res.json();

test('GET /api/evidence/taxonomy returns all 9 classes (registration added by ZR)', async () => {
  const res = await fetch(`${baseUrl}/api/evidence/taxonomy`);
  assert.equal(res.status, 200);
  const body = await j(res);
  assert.equal(body.classes.length, 9);
  assert.ok(body.classes.some((c) => c.evidence_class === 'registration'));
  assert.ok(body.legacy_type_to_class.odometer_photo === 'inspection');
});

test('GET /api/evidence/sources is public-safe (no credentials leaked)', async () => {
  const res = await fetch(`${baseUrl}/api/evidence/sources`);
  assert.equal(res.status, 200);
  const body = await j(res);
  assert.ok(body.sources.length >= 1);
  const gov = body.sources.find((s) => s.code === 'gov');
  assert.ok(gov);
  assert.equal(gov.contact_reference, undefined);
  assert.equal(gov.credential_reference, undefined);
  assert.equal(gov.trust_tier, 'high');
});

test('POST evidence-sets creates a set (owner) and rejects an invalid class', async () => {
  const ok = await fetch(`${baseUrl}/api/vehicles/VINSET/evidence-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'owner-1', 'x-stakeholder-role': 'owner' },
    body: JSON.stringify({ evidence_class: 'repair', set_type: 'repair_before_during_after', label: 'Front bumper' }),
  });
  assert.equal(ok.status, 201);
  const set = await j(ok);
  assert.equal(set.evidence_class, 'repair');

  const bad = await fetch(`${baseUrl}/api/vehicles/VINSET/evidence-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': 'owner-1', 'x-stakeholder-role': 'owner' },
    body: JSON.stringify({ evidence_class: 'spaceship' }),
  });
  assert.equal(bad.status, 400);
});

test('GET evidence-sets lists created sets', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/VINSET/evidence-sets`);
  assert.equal(res.status, 200);
  const body = await j(res);
  assert.ok(body.sets.length >= 1);
});

test('provenance retrieval is object-scoped (OC-4A): admin gets attribution without IPs, the owner a summary, an unrelated buyer nothing', async () => {
  // Seed a 2-event chain through the same (mocked) client the route uses.
  await provenance.recordProvenanceEvent(supabase, { evidenceId: EV1, vin: 'VINSET', eventType: 'created', actorUserId: 'owner-1', actorRole: 'owner', ipAddress: '10.1.2.3' });
  await provenance.recordProvenanceEvent(supabase, { evidenceId: EV1, vin: 'VINSET', eventType: 'uploaded', actorUserId: 'owner-1', actorRole: 'owner', ipAddress: '10.1.2.3' });
  const url = `${baseUrl}/api/vehicles/VINSET/evidence/${EV1}/provenance`;

  // The old contract accepted an identity ASSERTED by x-user-id; this route now needs a session.
  const asserted = await fetch(url, { headers: { 'x-user-id': 'admin-1', 'x-stakeholder-role': 'admin' } });
  assert.equal(asserted.status, 401);

  const adminRes = await fetch(url, { headers: { 'x-session-token': 'session-admin-1' } });
  assert.equal(adminRes.status, 200);
  const adminBody = await j(adminRes);
  assert.equal(adminBody.audience, 'admin');
  assert.equal(adminBody.chain_valid, true);
  assert.equal(adminBody.events.length, 2);
  assert.ok('content_hash' in adminBody.events[0]);
  assert.equal(adminBody.events[0].actor_user_id, 'owner-1');
  assert.equal('ip_address' in adminBody.events[0], false, 'no audience receives an IP address');

  const ownerRes = await fetch(url, { headers: { 'x-session-token': 'session-owner-1' } });
  assert.equal(ownerRes.status, 200);
  const ownerBody = await j(ownerRes);
  assert.equal(ownerBody.events.length, 2);
  for (const key of ['ip_address', 'actor_user_id', 'content_hash']) assert.equal(key in ownerBody.events[0], false, key);

  // The old contract let ANY signed-in account read the chain of custody of any evidence record.
  const buyerRes = await fetch(url, { headers: { 'x-session-token': 'session-buyer-1' } });
  assert.equal(buyerRes.status, 403);
});
