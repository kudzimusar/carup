/**
 * PC01-K2B — the evidence review queue is a truthful, paginated, operational-only read.
 *
 * Before K2B the queue returned `.limit(100)` rows and the page presented them as "all evidence".
 * `paged=1` now reads every matching row (readAllPages), classifies each by the provenance authority
 * (via the vehicle's creator), and returns an explicit page with its total. Records on UAT /
 * certification vehicles are counted by class, never deleted; a read failure is an error, never an
 * empty page. Drives the real router + real authorizeRole with only supabase.from mocked.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/vehiclesRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

const REAL_VIN = 'JTDBR32E720012345';
const UAT_VIN = 'JTDBR32E720067890';
const OWNERLESS_VIN = 'JF1GH7KA5BG012345';

let db;
let failEvidenceRead = false;
function evidenceRows(vin, n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    vin,
    verification_status: 'pending',
    evidence_type: 'photo',
    uploaded_at: `2026-10-0${1 + (i % 9)}T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    vehicles: { make: 'Toyota', model: 'Hilux', year: 2018, trust_score: 70 },
  }));
}
function resetDb() {
  failEvidenceRead = false;
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'u_4e5f60718293a4b5', role: 'owner', is_verified: true, email: 'nyasha.owner@mail.co.zw', name: 'Nyasha Owner' },
      { id: 'u_tradeos_k2b_buyer', role: 'owner', is_verified: true, email: 'buyer@carup.test', name: 'Trade OS UAT Buyer' },
    ],
    vehicles: [
      { vin: REAL_VIN, owner_id: 'u_4e5f60718293a4b5', tenant_id: null, make: 'Toyota', seller_description: '' },
      { vin: UAT_VIN, owner_id: 'u_tradeos_k2b_buyer', tenant_id: null, make: 'Toyota', seller_description: '' },
      { vin: OWNERLESS_VIN, owner_id: null, tenant_id: null, make: 'Subaru', seller_description: '' },
    ],
    vehicle_evidence: [
      ...evidenceRows(REAL_VIN, 60, 'real'),
      ...evidenceRows(UAT_VIN, 50, 'uat'),
      ...evidenceRows(OWNERLESS_VIN, 20, 'ownerless'),
    ],
  };
}

function builder(table) {
  const st = { filters: {}, inFilter: null, range: null, limit: null, single: false, maybe: false };
  const run = () => {
    if (table === 'vehicle_evidence' && failEvidenceRead) return { data: null, error: { message: 'statement timeout' } };
    let rows = (db[table] || []).filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
    if (st.inFilter) rows = rows.filter((r) => st.inFilter.vals.includes(r[st.inFilter.k]));
    if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
    if (st.limit !== null) rows = rows.slice(0, st.limit);
    if (st.maybe) return { data: rows[0] || null, error: null };
    if (st.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: rows, error: null };
  };
  const chain = {
    select() { return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    in(k, vals) { st.inFilter = { k, vals }; return chain; },
    order() { return chain; },
    range(from, to) { st.range = [from, to]; return chain; },
    limit(n) { st.limit = n; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return chain;
}

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use(router);
  a.use(errorHandler);
  return a;
})();
function get(path, userId = 'admin-1') {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address();
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { 'x-user-id': userId } }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      req.on('error', (e) => { srv.close(); reject(e); });
      req.end();
    });
  });
}

before(() => { resetDb(); supabase.from = (t) => builder(t); });

test('paged evidence review returns the operational total, not the first 100 rows', async () => {
  resetDb();
  const first = await get('/api/evidence/review?status=pending&paged=1&page=1&page_size=50');
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 60, 'operational total across ALL rows (130 raw)');
  assert.equal(first.body.items.length, 50);
  assert.equal(first.body.has_more, true);
  assert.ok(first.body.items.every((item) => item.vin === REAL_VIN));

  const second = await get('/api/evidence/review?status=pending&paged=1&page=2&page_size=50');
  assert.equal(second.body.items.length, 10);
  assert.equal(second.body.has_more, false);
  const ids = new Set([...first.body.items, ...second.body.items].map((i) => i.id));
  assert.equal(ids.size, 60, 'pages are disjoint and complete');
});

test('paged evidence review states what it set aside, by class, with UNKNOWN never counted', async () => {
  resetDb();
  const res = await get('/api/evidence/review?status=pending&paged=1');
  const p = res.body.provenance;
  assert.equal(p.raw, 130);
  assert.equal(p.operational, 60);
  assert.equal(p.excluded_non_operational, 50);
  assert.equal(p.unknown_requires_review, 20, 'an ownerless vehicle is needs-review, not test and not real');
  assert.equal(p.by_class.uat, 50);
  assert.equal(p.view, 'operational_only');
  assert.equal(JSON.stringify(res.body).includes('carup.test'), false, 'no identity detail leaks into the summary');

  const all = await get('/api/evidence/review?status=pending&paged=1&view=all&page_size=100');
  assert.equal(all.body.total, 130, 'view=all shows every record — nothing deleted');
  assert.equal(all.body.provenance.view, 'all_records');
});

test('page_size is bounded and a read failure is an error, never an empty page', async () => {
  resetDb();
  const capped = await get('/api/evidence/review?status=pending&paged=1&page_size=500');
  assert.equal(capped.body.page_size, 100);

  failEvidenceRead = true;
  const failed = await get('/api/evidence/review?status=pending&paged=1');
  assert.ok(failed.status >= 500, `expected a server error, got ${failed.status}`);
  assert.equal(Array.isArray(failed.body?.items), false, 'no empty items array on failure');
});

test('the legacy unpaged form keeps its array shape for existing callers', async () => {
  resetDb();
  const res = await get('/api/evidence/review?status=pending');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 100);
});
