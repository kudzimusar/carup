/**
 * OC-P0L — production-security hotfix candidate for GET /api/vehicles/:vin/verify-ledger.
 *
 * Base: the exact production source 78303ed60e639c6ed7b6afa318abaf8f0b43e977, where this route was
 * ANONYMOUS and returned verifyChain(vin) verbatim — chain[] with every ledger event's parsed payload
 * (owner names, national ids), hashes and signer-prefixed signatures — reachable through every path
 * variant Express routes to it (case-insensitive, optional trailing slash, and HEAD).
 *
 * The contract proven here, through the SHIPPED app (real routing, real session tokens against an
 * in-memory Supabase double):
 *   - anonymous → 401; an identity ASSERTED via x-user-id (not a session) → 401; on every variant;
 *   - authenticated but unrelated, or an unknown VIN → the same 403 (existence is not disclosed);
 *   - owner / current seller / admin / government → 200 with the allow-listed projection only:
 *       { vin, verified, count, integrity, failed_at_index?, verified_at }
 *   - no chain / payload / signature / reason key at any depth, and no seeded secret anywhere;
 *   - the verdict itself is UNCHANGED (exposure-only hotfix): `verified` is the verifier's boolean,
 *     including true for an empty ledger, which the production client renders as it always has.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
// The asserted-identity test must measure the route, not an operator opt-in left in the environment.
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { calculateHash } = await import('../services/blockchain/blockchainService.js');

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

class MemoryQuery {
  constructor(db, table) {
    this.db = db; this.table = table; this.filters = []; this.orderSpec = null; this.limitValue = null;
    this.operation = 'select'; this.payload = null;
  }
  select() { return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  neq() { return this; } in() { return this; } is() { return this; } not() { return this; } or() { return this; }
  gt() { return this; } gte() { return this; } lt() { return this; } lte() { return this; }
  ilike() { return this; } like() { return this; } contains() { return this; } match() { return this; } range() { return this; }
  order(column, options = {}) { this.orderSpec = { column, ascending: options.ascending !== false }; return this; }
  limit(value) { this.limitValue = value; return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  upsert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  delete() { this.operation = 'delete'; return this; }
  maybeSingle() { return this.execute({ single: true, maybe: true }); }
  single() { return this.execute({ single: true, maybe: false }); }
  then(resolve, reject) { return this.execute({ single: false, maybe: false }).then(resolve, reject); }
  async execute({ single, maybe }) {
    if (this.operation !== 'select') {
      this.db.writes.push({ table: this.table, op: this.operation });
      return { data: null, error: null };
    }
    let rows = (this.db.data[this.table] || []).filter((row) => this.filters.every((f) => row[f.key] === f.value)).map(clone);
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      rows.sort((a, b) => (ascending ? Number(a[column]) - Number(b[column]) : Number(b[column]) - Number(a[column])));
    }
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const USERS = {
  owner: { id: 'owner-1', role: 'owner' },
  seller: { id: 'seller-1', role: 'dealer' },
  stranger: { id: 'owner-2', role: 'owner' },
  admin: { id: 'admin-1', role: 'admin' },
  government: { id: 'gov-1', role: 'government' },
};
const tokenFor = (who) => `oc3b-ledger-session-${who}`;

// Values that live ONLY inside ledger payloads/signatures. None may appear in any response.
const SECRET_OWNER_NAME = 'Tendai OC3B-Private-Moyo';
const SECRET_NATIONAL_ID = '63-OC3B-1234567-X-42';
const SECRET_OPERATION_ID = 'op-oc3b-never-exported';
const SECRET_SIGNER = 'stakeholder-oc3b-signer-77';

function buildChain(vin, events) {
  let prev = '0'.repeat(64);
  return events.map((e, i) => {
    const timestamp = `2026-0${i + 1}-01T00:00:00.000Z`;
    const current = calculateHash(prev, vin, e.event_type, timestamp, e.payload);
    const row = {
      id: i + 1, vin, event_type: e.event_type, payload: JSON.stringify(e.payload), timestamp,
      previous_hash: prev, current_hash: current, signature: 'SYSTEM_SIGNATURE', operation_id: SECRET_OPERATION_ID,
    };
    prev = current;
    return row;
  });
}

const LEDGER_EVENTS = [
  { event_type: 'OWNERSHIP_TRANSFER', payload: { new_owner_name: SECRET_OWNER_NAME, national_id: SECRET_NATIONAL_ID, signer: SECRET_SIGNER } },
  { event_type: 'SERVICE_LOG', payload: { mechanic: SECRET_SIGNER, note: `${SECRET_OWNER_NAME} collected the car` } },
];

let db;
function resetDb() {
  const chain = buildChain('VIN1', LEDGER_EVENTS);
  db = {
    writes: [],
    data: {
      users: Object.values(USERS).map((u) => ({ id: u.id, role: u.role, is_verified: true })),
      user_sessions: Object.keys(USERS).map((who) => ({ token: tokenFor(who), user_id: USERS[who].id, is_valid: true, expires_at: FUTURE })),
      tenant_users: [],
      vehicles: [
        { vin: 'VIN1', owner_id: 'owner-1', current_seller_id: 'seller-1', tenant_id: null },
        { vin: 'VIN_EMPTY', owner_id: 'owner-1', current_seller_id: null, tenant_id: null },
        { vin: 'VIN_BROKEN', owner_id: 'owner-1', current_seller_id: null, tenant_id: null },
      ],
      blockchain_events: [
        ...chain,
        // A tampered chain: the second event's hash no longer matches its content.
        ...buildChain('VIN_BROKEN', LEDGER_EVENTS).map((row, i) => (i === 1
          ? { ...row, id: 100 + i, payload: JSON.stringify({ ...LEDGER_EVENTS[1].payload, note: `${SECRET_OWNER_NAME} TAMPERED` }) }
          : { ...row, id: 100 + i })),
      ],
      rolling_integrity_checkpoints: [],
      public_keys: [],
    },
  };
}

let server; let baseUrl;
const realFrom = supabase.from;
before(async () => {
  resetDb();
  supabase.from = (table) => new MemoryQuery(db, table);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  supabase.from = realFrom;
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(resetDb);

async function call(path, { method = 'GET', who = null, headers = {} } = {}) {
  const h = { 'x-bypass-rate-limit': 'true', ...headers };
  if (who) h['x-session-token'] = tokenFor(who);
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}
const getLedger = (vin, options = {}) => call(`/api/vehicles/${vin}/verify-ledger`, options);

const SAFE_KEYS = new Set(['vin', 'verified', 'count', 'integrity', 'failed_at_index', 'verified_at']);
const FORBIDDEN_KEYS = ['chain', 'payload', 'signature', 'reason', 'tamperIndex', 'currentHash', 'current_hash', 'operation_id', 'note'];

function allKeys(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); allKeys(v, out); }
  return out;
}

function assertSafeProjection(res, label) {
  assert.equal(typeof res.body, 'object', `${label}: JSON body`);
  for (const key of Object.keys(res.body)) assert.ok(SAFE_KEYS.has(key), `${label}: unexpected key '${key}' in ${res.text}`);
  const keys = allKeys(res.body);
  for (const forbidden of FORBIDDEN_KEYS) assert.ok(!keys.includes(forbidden), `${label}: key '${forbidden}' must not be present`);
  const secrets = [SECRET_OWNER_NAME, SECRET_NATIONAL_ID, SECRET_OPERATION_ID, SECRET_SIGNER, 'SYSTEM_SIGNATURE',
    ...db.data.blockchain_events.map((e) => e.current_hash)];
  for (const secret of secrets) assert.ok(!res.text.includes(secret), `${label}: '${secret}' leaked in ${res.text}`);
}

const VARIANTS = [
  '/api/vehicles/VIN1/verify-ledger',
  '/api/vehicles/VIN1/verify-ledger/',
  '/api/vehicles/VIN1/Verify-Ledger',
  '/API/Vehicles/VIN1/verify-ledger',
];

for (const path of VARIANTS) {
  test(`OC-P0L: anonymous ${path} is refused 401 and receives no ledger content`, async () => {
    const res = await call(path);
    assert.equal(res.status, 401, `${res.status} ${res.text.slice(0, 300)}`);
    assert.ok(!res.text.includes(SECRET_OWNER_NAME));
  });
}

test('OC-P0L: an anonymous HEAD is refused too (it used to run the verifier and leak the size)', async () => {
  const res = await call('/api/vehicles/VIN1/verify-ledger', { method: 'HEAD' });
  assert.equal(res.status, 401);
});

test('OC-P0L: an identity asserted by x-user-id (no session) is refused 401', async () => {
  const res = await getLedger('VIN1', { headers: { 'x-user-id': 'owner-1' } });
  assert.equal(res.status, 401, `${res.status} ${res.text.slice(0, 300)}`);
  assert.ok(!res.text.includes(SECRET_OWNER_NAME));
});

test('OC-P0L: an authenticated caller unrelated to the vehicle is refused 403', async () => {
  const res = await getLedger('VIN1', { who: 'stranger' });
  assert.equal(res.status, 403, `${res.status} ${res.text.slice(0, 300)}`);
  assert.ok(!res.text.includes(SECRET_OWNER_NAME));
});

test('OC-P0L: an unknown VIN answers the same 403 as an unrelated one (existence not disclosed)', async () => {
  const res = await getLedger('VIN_DOES_NOT_EXIST', { who: 'stranger' });
  assert.equal(res.status, 403);
  // Not by the body either: it used to say reason 'not_found' here and 'not_scoped' for a stranger.
  const known = await getLedger('VIN1', { who: 'stranger' });
  assert.deepEqual(res.body, known.body);
});

for (const who of ['owner', 'seller', 'admin', 'government']) {
  test(`OC-P0L: the ${who} receives the safe integrity projection only — no chain, payload or signature`, async () => {
    const res = await getLedger('VIN1', { who });
    assert.equal(res.status, 200, `${who} must be 200, got ${res.status} ${res.text.slice(0, 300)}`);
    assertSafeProjection(res, who);
    assert.equal(res.body.vin, 'VIN1');
    assert.equal(res.body.verified, true);
    assert.equal(res.body.integrity, 'verified');
    assert.equal(res.body.count, LEDGER_EVENTS.length);
    assert.ok(!Number.isNaN(Date.parse(res.body.verified_at)));
    assert.equal('failed_at_index' in res.body, false);
  });
}

test('OC-P0L: a tampered chain reports integrity "broken" with an index and no reason text or payload', async () => {
  const res = await getLedger('VIN_BROKEN', { who: 'owner' });
  assert.equal(res.status, 200, res.text);
  assertSafeProjection(res, 'broken');
  assert.equal(res.body.verified, false);
  assert.equal(res.body.integrity, 'broken');
  assert.equal(res.body.failed_at_index, 1);
  assert.ok(!res.text.includes('TAMPERED'));
});

test('OC-P0L: an empty ledger keeps the production verdict (verified:true) — exposure-only, the client is unchanged', async () => {
  const res = await getLedger('VIN_EMPTY', { who: 'owner' });
  assert.equal(res.status, 200, res.text);
  assertSafeProjection(res, 'empty');
  const { verified_at: _at, ...shape } = res.body;
  assert.deepEqual(shape, { vin: 'VIN_EMPTY', verified: true, count: 0, integrity: 'empty' },
    'the production client renders anything but verified:true as "Tampered"; the corrected contract ships with the RC');
});

test('OC-P0L: the route reads what it needs and writes nothing', async () => {
  await getLedger('VIN1', { who: 'owner' });
  assert.deepEqual(db.writes, [], 'an integrity read performs no write');
});

test('OC-P0L: the projection never changes the verdict — for every report shape', async () => {
  const { toLedgerIntegrityReport } = await import('../services/blockchain/ledgerIntegrityProjection.js');
  const at = new Date('2026-10-04T00:00:00.000Z');
  for (const report of [null, {}, { verified: false }, { verified: false, tamperIndex: 3 }, { verified: 'true', count: 2 },
    { verified: true }, { verified: true, count: 0 }, { verified: true, count: 2, chain: [{ payload: { secret: 1 } }] }]) {
    const out = toLedgerIntegrityReport('V', report, at);
    assert.equal(out.verified, report?.verified === true, JSON.stringify(report));
    assert.ok(!JSON.stringify(out).includes('secret'), 'nothing from the chain is copied');
  }
});
