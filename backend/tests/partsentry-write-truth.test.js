/**
 * PartSentry write-path truth tests (trust-spine audit P0s).
 *
 * 1. Source contract: partsentryService must check the insert result error BEFORE
 *    any side effect (vehicles.mileage update, blockchain addEvent) so a failed
 *    insert can never silently mutate the odometer or emit a ghost event.
 * 2. Behavior: addRepairLog happy path returns the new log id and performs the
 *    side effects; an insert failure throws and performs NONE of them.
 * 3. Work orders route contract: PATCH is tenant-scoped in the UPDATE itself and
 *    only accepts the DB CHECK status set; create persists customer_name and the
 *    authenticated mechanic identity.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_SRC = readFileSync(join(ROOT, 'services', 'partsentry', 'partsentryService.js'), 'utf8');
const WORK_ORDERS_SRC = readFileSync(join(ROOT, 'routes', 'workOrdersRoutes.js'), 'utf8');

const { supabase } = await import('../db/supabase.js');
const { addRepairLog } = await import('../services/partsentry/partsentryService.js');

// ── In-memory supabase stub ─────────────────────────────────────────────────────
let db;
let calls;
let insertErrors;

function resetDb() {
  db = {
    vehicles: [{ vin: 'VIN0000000000001', mileage: 40000 }],
    partsentry_logs: [],
    blockchain_events: [],
    public_keys: [],
    rolling_integrity_checkpoints: [],
  };
  calls = { inserts: [], updates: [], upserts: [] };
  insertErrors = {};
}

function builder(table) {
  const st = { table, op: 'select', filters: [], gt: null, single: false, maybe: false, head: false, payload: null };
  const chain = {
    select(_cols, opts) {
      if (opts?.head) { st.head = true; }
      return chain;
    },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    upsert(p) { st.op = 'upsert'; st.payload = p; return chain; },
    eq(k, v) { st.filters.push([k, v]); return chain; },
    gt(k, v) { st.gt = [k, v]; return chain; },
    order() { return chain; },
    limit() { return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { return Promise.resolve(run(st)).then(res, rej); },
  };
  return chain;
}

function run(st) {
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    if (insertErrors[st.table]) {
      return { data: null, error: { message: insertErrors[st.table] } };
    }
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const inserted = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, ...p }));
    rows.push(...inserted);
    calls.inserts.push({ table: st.table, payload: st.payload });
    return { data: st.single ? inserted[0] : inserted, error: null };
  }
  if (st.op === 'update') {
    calls.updates.push({ table: st.table, payload: st.payload, filters: st.filters });
    const matched = [];
    for (const r of rows) {
      if (st.filters.every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); matched.push(r); }
    }
    return { data: st.single ? (matched[0] || null) : matched, error: null };
  }
  if (st.op === 'upsert') {
    calls.upserts.push({ table: st.table, payload: st.payload });
    return { data: [st.payload], error: null };
  }
  let out = rows.filter((r) => st.filters.every(([k, v]) => r[k] === v));
  if (st.gt) out = out.filter((r) => r[st.gt[0]] > st.gt[1]);
  if (st.head) return { count: out.length, data: null, error: null };
  if (st.maybe) return { data: out[0] || null, error: null };
  if (st.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'No rows found' } };
  return { data: out, error: null };
}

beforeEach(() => {
  resetDb();
  supabase.from = (t) => builder(t);
});

// ── 1. Source contract: error check precedes every side effect ──────────────────
test('source: insert result destructures the error', () => {
  assert.match(SERVICE_SRC, /const\s*\{\s*data:\s*inserted\s*,\s*error\s*\}\s*=\s*await\s+supabase\.from\('partsentry_logs'\)\.insert\(/);
});

test('source: the insert error throw precedes the vehicles.mileage update and addEvent', () => {
  const insertIdx = SERVICE_SRC.indexOf(".from('partsentry_logs').insert(");
  assert.ok(insertIdx > -1, 'insert into partsentry_logs must exist');
  const errorThrowMatch = /if\s*\(error\)\s*throw\s+new\s+Error\(error\.message\)/.exec(SERVICE_SRC);
  assert.ok(errorThrowMatch, 'insert error must be rethrown');
  const vehiclesUpdateIdx = SERVICE_SRC.indexOf(".from('vehicles').update(");
  const addEventIdx = SERVICE_SRC.indexOf('await addEvent(');
  assert.ok(vehiclesUpdateIdx > -1, 'vehicles mileage update must exist');
  assert.ok(addEventIdx > -1, 'blockchain addEvent must exist');
  assert.ok(errorThrowMatch.index > insertIdx, 'error check belongs to the insert result');
  assert.ok(errorThrowMatch.index < vehiclesUpdateIdx, 'error must be checked BEFORE the odometer update');
  assert.ok(errorThrowMatch.index < addEventIdx, 'error must be checked BEFORE the blockchain event');
});

// ── 2. Behavior: happy path and failure isolation ───────────────────────────────
test('addRepairLog happy path returns the inserted log id and performs the side effects', async () => {
  const result = await addRepairLog('VIN0000000000001', 'mech-9', 'Brake Pads', 'BP-01', 'Replaced', 'Front pads replaced', 45000);

  assert.equal(result.id, 'partsentry_logs-1');
  assert.equal(result.vin, 'VIN0000000000001');
  assert.equal(result.mechanicId, 'mech-9');
  assert.ok(result.signature, 'log carries a signature');

  assert.equal(db.partsentry_logs.length, 1);
  assert.equal(db.partsentry_logs[0].mechanic_id, 'mech-9');

  const vehicleUpdates = calls.updates.filter((u) => u.table === 'vehicles');
  assert.equal(vehicleUpdates.length, 1, 'odometer updated exactly once');
  assert.equal(db.vehicles[0].mileage, 45000);

  assert.equal(db.blockchain_events.length, 1, 'one blockchain event emitted');
  assert.equal(db.blockchain_events[0].event_type, 'Mechanic Inspection');
});

test('a failed insert throws and performs NO side effect (no odometer mutation, no ghost event)', async () => {
  insertErrors.partsentry_logs = 'new row for relation "partsentry_logs" violates check constraint "partsentry_logs_action_type_check"';

  await assert.rejects(
    () => addRepairLog('VIN0000000000001', 'mech-9', 'Brake Pads', 'BP-01', 'replaced', 'lowercase enum rejected by DB', 45000),
    /violates check constraint/
  );

  assert.equal(db.partsentry_logs.length, 0, 'no log row persisted');
  const vehicleUpdates = calls.updates.filter((u) => u.table === 'vehicles');
  assert.equal(vehicleUpdates.length, 0, 'odometer must NOT be mutated after a failed insert');
  assert.equal(db.vehicles[0].mileage, 40000, 'odometer unchanged');
  assert.equal(db.blockchain_events.length, 0, 'no ghost blockchain event');
});

test('odometer rollback is rejected before anything is written', async () => {
  await assert.rejects(
    () => addRepairLog('VIN0000000000001', 'mech-9', 'Brake Pads', 'BP-01', 'Replaced', 'rollback attempt', 30000),
    /Mileage verification failure/
  );
  assert.equal(db.partsentry_logs.length, 0);
  assert.equal(db.blockchain_events.length, 0);
});

// ── 3. Work orders route contract ───────────────────────────────────────────────
test('source: PATCH /api/mechanic/work-orders/:id exists, tenant-scoped with a status allowlist', () => {
  assert.match(WORK_ORDERS_SRC, /router\.patch\('\/api\/mechanic\/work-orders\/:id'/, 'PATCH route must exist');

  const patchIdx = WORK_ORDERS_SRC.indexOf("router.patch('/api/mechanic/work-orders/:id'");
  const patchSection = WORK_ORDERS_SRC.slice(patchIdx);

  // Status transitions restricted to the DB CHECK set.
  assert.match(WORK_ORDERS_SRC, /\[\s*'In Progress'\s*,\s*'Completed'\s*,\s*'Cancelled'\s*\]/, 'status allowlist must match the DB CHECK set');
  assert.match(patchSection, /WORK_ORDER_STATUSES\.includes\(status\)/, 'PATCH must validate status against the allowlist');

  // Tenant scoping inside the UPDATE chain itself, and 404 when nothing matched.
  assert.match(patchSection, /\.eq\('tenant_id',\s*orgId\)/, 'PATCH update must be tenant-scoped');
  assert.match(patchSection, /NotFoundError/, "another tenant's work order must 404, not update");
});

test('source: create persists customer_name and the authenticated mechanic identity', () => {
  const postIdx = WORK_ORDERS_SRC.indexOf("router.post('/api/mechanic/work-orders'");
  const postSection = WORK_ORDERS_SRC.slice(postIdx, WORK_ORDERS_SRC.indexOf('router.patch'));
  assert.match(postSection, /customer_name/, 'create must persist customer_name');
  assert.match(postSection, /mechanic_id:\s*req\.userContext\.id/, 'mechanic identity must come from req.userContext, never the client');
  assert.match(postSection, /\.from\('vehicles'\)/, 'create must resolve the customer from vehicles.owner_id');
  assert.match(postSection, /owner_id/, 'create must resolve customer_id from vehicles.owner_id');
});
