/**
 * PartSentry write-path truth tests (trust-spine audit P0s).
 *
 * 1. Source contract: a failed record can never mutate the odometer or emit a ghost
 *    event. Since OC-5A this holds by construction — the record, the odometer and the
 *    ledger intent are ONE database function in ONE transaction — so the pins assert
 *    that the service makes no write of its own and that the function orders its
 *    check before every write.
 * 2. Behavior: recordPartSentryEntry sends one RPC carrying the attestation and the
 *    work order's organisation as tenant; a refusal reaches no ledger attempt and keeps
 *    its meaning; an unusable reading never reaches the database.
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
const { custodyGeneration } = await import('../services/blockchain/blockchainKeyCustodyService.js');

// ── In-memory supabase stub ─────────────────────────────────────────────────────
let db;
let calls;
let insertErrors;
let watermarkMs;

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
  watermarkMs = 0;
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
  supabase.rpc = async (name, args) => {
    if (name === 'blockchain_custody_rollout_contract') {
      // The authorized generation mirrors the runtime's own derived custody
      // generation (same process-level test secret + version), exactly like an
      // owner-authorized FINALIZED database.
      return {
        data: { state: 'FINALIZED', authorized_generation: custodyGeneration() },
        error: null,
      };
    }
    if (name !== 'blockchain_activate_public_key_boundary') {
      return { data: null, error: { message: `unsupported test RPC: ${name}` } };
    }
    if (args.p_custody_generation !== custodyGeneration()) {
      return {
        data: null,
        error: { message: 'stakeholder signer custody generation is not authorized' },
      };
    }

    // The boundary contract takes no caller timestamp: the fake DB owns a strictly
    // monotonic activation/event boundary, exactly like the real RPC.
    watermarkMs = Math.max(Date.now(), watermarkMs + 1);
    const boundary = new Date(watermarkMs).toISOString();

    const rows = db.public_keys;
    const active = rows.find((row) => row.user_id === args.p_user_id && row.status === 'ACTIVE');
    if (active?.public_key_pem === args.p_public_key_pem) {
      Object.assign(active, {
        key_ref: args.p_key_ref,
        key_version: args.p_key_version,
        custody_provider: args.p_custody_provider,
      });
      return { data: [{ ...active, event_timestamp: boundary }], error: null };
    }
    if (active) {
      active.status = 'REVOKED';
      active.revoked_at = boundary;
    }

    const activated = {
      id: args.p_candidate_id,
      user_id: args.p_user_id,
      public_key_pem: args.p_public_key_pem,
      key_type: args.p_key_type,
      status: 'ACTIVE',
      created_at: boundary,
      revoked_at: null,
      key_ref: args.p_key_ref,
      key_version: args.p_key_version,
      custody_provider: args.p_custody_provider,
    };
    rows.push(activated);
    return { data: [{ ...activated, event_timestamp: boundary }], error: null };
  };
});

// ── 1. Source contract (OC-5A): ONE commit boundary — the service makes no side effect of its own ─────
// The truths this section pinned before OC-5A ("a failed insert performs no side effect") now hold by
// construction: the record, the odometer and the ledger intent are written by ONE database function in
// ONE transaction (partsentry_record_service, migration 20261004160200), and the ledger event follows
// from the committed intent. Proven on real PostgreSQL in oc5a-partsentry-atomic-ledger-intent.test.js.
const RECORD_SQL = readFileSync(join(ROOT, '..', 'database', 'migrations', '20261004160200_oc5a_partsentry_attested_record_and_ledger_intents.sql'), 'utf8').split(/^-- \+migrate Down/m)[0];

test('source: the service writes nothing itself — no log insert, no odometer update, no inline ledger event', () => {
  assert.doesNotMatch(SERVICE_SRC, /\.from\('partsentry_logs'\)\.insert\(/);
  assert.doesNotMatch(SERVICE_SRC, /\.from\('vehicles'\)\.update\(/);
  assert.doesNotMatch(SERVICE_SRC, /\baddEvent\(/);
  assert.match(SERVICE_SRC, /client\.rpc\('partsentry_record_service'/);
});

test('source: inside the one function, the odometer check precedes every write, and the odometer moves only for a mechanic service', () => {
  const body = RECORD_SQL.slice(RECORD_SQL.indexOf('CREATE OR REPLACE FUNCTION public.partsentry_record_service'));
  const check = body.indexOf('cannot be lower than vehicle current odometer');
  const insertLog = body.indexOf('INSERT INTO public.partsentry_logs');
  const moveOdometer = body.indexOf('UPDATE public.vehicles SET mileage');
  const insertIntent = body.indexOf('INSERT INTO public.ledger_event_intents');
  assert.ok(check > 0 && check < insertLog && insertLog < moveOdometer && moveOdometer < insertIntent, 'check → record → odometer → intent');
  assert.match(body, /v_apply := \(p_attestation = 'mechanic_service'\);/);
  assert.match(body, /IF v_apply THEN\s*UPDATE public\.vehicles SET mileage/);
  assert.match(body, /FOR UPDATE;/, 'every write for the vehicle is serialized on its row');
});

// ── 2. Behavior (OC-5A): what the writer sends, and what it never does on a refusal ─────────────────
const { recordPartSentryEntry, PartSentryRecordError } = await import('../services/partsentry/partsentryService.js');

function rpcClient(result) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push({ name, args }); return typeof result === 'function' ? result(args) : result; },
    from: () => { throw new Error('the writer must not touch a table directly'); },
  };
}
const MECHANIC_AUTHORITY = { allowed: true, attestation: 'mechanic_service', workOrderId: 'wo-1', tenantId: 'tenant-garage-1' };
const OWNER_AUTHORITY = { allowed: true, attestation: 'owner_stated', workOrderId: null, tenantId: null };
const committed = (args) => ({
  data: { replayed: false,
    log: { id: 7, vin: args.p_vin, mechanic_id: args.p_actor_id, part_name: args.p_part_name, part_oem: args.p_part_oem, action_type: args.p_action_type,
      description: args.p_description, mileage: args.p_mileage, signature: args.p_signature, timestamp: args.p_timestamp, tenant_id: args.p_tenant_id,
      attestation: args.p_attestation, work_order_id: args.p_work_order_id, odometer_applied: args.p_attestation === 'mechanic_service' },
    intent: { id: 'intent-7', status: 'pending' } },
  error: null,
});

test('a mechanic service: one RPC carrying the attestation, the work order\'s organisation as tenant, and a payload that names the mechanic', async () => {
  const client = rpcClient(committed);
  let ledgerCalls = 0;
  const result = await recordPartSentryEntry({ vin: 'VIN0000000000001', actorId: 'mech-9', authority: MECHANIC_AUTHORITY, partName: 'Brake Pads', partOem: 'BP-01',
    actionType: 'Replaced', description: 'Front pads replaced', mileage: 45000, client, recordLedger: async () => { ledgerCalls += 1; return { status: 'recorded', intentId: 'intent-7', eventId: 99 }; } });
  assert.equal(client.calls.length, 1);
  const { args } = client.calls[0];
  assert.equal(args.p_attestation, 'mechanic_service');
  assert.equal(args.p_tenant_id, 'tenant-garage-1', 'garage attribution comes from the work order\'s organisation, never a header');
  assert.equal(args.p_work_order_id, 'wo-1');
  assert.equal(args.p_ledger_event_type, 'Mechanic Inspection');
  assert.equal(args.p_ledger_payload.mechanicId, 'mech-9');
  assert.equal(result.id, 7);
  assert.equal(result.odometerApplied, true);
  assert.deepEqual(result.ledger, { status: 'recorded', intentId: 'intent-7', eventId: 99 });
  assert.equal(ledgerCalls, 1, 'the ledger event is recorded from the committed intent');
});

test('an owner statement: tenant null, ledgered as an Owner Maintenance Declaration, and no mechanic identity anywhere in the payload', async () => {
  const client = rpcClient(committed);
  await recordPartSentryEntry({ vin: 'VIN0000000000001', actorId: 'owner-1', authority: OWNER_AUTHORITY, partName: 'Air Filter', partOem: null,
    actionType: 'Replaced', description: 'Owner-serviced', mileage: 45000, client, recordLedger: async () => ({ status: 'pending', intentId: 'intent-7' }) });
  const { args } = client.calls[0];
  assert.equal(args.p_tenant_id, null);
  assert.equal(args.p_ledger_event_type, 'Owner Maintenance Declaration');
  assert.equal('mechanicId' in args.p_ledger_payload, false);
});

test('a refused record makes no ledger attempt, and the refusal keeps its meaning (400 / 404 / 409 / 503)', async () => {
  for (const [code, status] of [['22023', 400], ['P0002', 404], ['23505', 409], ['40001', 503]]) {
    const client = rpcClient({ data: null, error: { code, message: 'refused by the database' } });
    let ledgerCalls = 0;
    await assert.rejects(
      () => recordPartSentryEntry({ vin: 'VIN0000000000001', actorId: 'mech-9', authority: MECHANIC_AUTHORITY, partName: 'Brake Pads', partOem: null,
        actionType: 'Replaced', description: 'x', mileage: 45000, client, recordLedger: async () => { ledgerCalls += 1; } }),
      (error) => error instanceof PartSentryRecordError && error.statusCode === status, `code ${code} → ${status}`);
    assert.equal(ledgerCalls, 0, 'no ledger attempt for a record that does not exist');
  }
});

test('an unusable odometer, a bad action, an empty part or no authority is refused before the database is asked', async () => {
  const cases = [
    { mileage: 'NaN' }, { mileage: -1 }, { mileage: 1000.5 }, { mileage: undefined },
    { actionType: 'replaced' }, { partName: '   ' },
    { authority: { allowed: false } }, { authority: { allowed: true, attestation: 'mechanic_verified' } },
  ];
  for (const overrides of cases) {
    const client = rpcClient(committed);
    await assert.rejects(() => recordPartSentryEntry({ vin: 'VIN0000000000001', actorId: 'mech-9', authority: MECHANIC_AUTHORITY, partName: 'Brake Pads',
      partOem: null, actionType: 'Replaced', description: 'x', mileage: 45000, client, ...overrides }), PartSentryRecordError, JSON.stringify(overrides));
    assert.equal(client.calls.length, 0, `${JSON.stringify(overrides)} must not reach the database`);
  }
});

test('source: the add route decides authority first and stamps no header tenant; the read route widens only through the governed read scope', () => {
  const serverSrc = readFileSync(join(ROOT, 'server.js'), 'utf8');
  const add = serverSrc.slice(serverSrc.indexOf("app.post('/api/partsentry/add'"), serverSrc.indexOf("app.get('/api/partsentry/:vin'"));
  const authorityAt = add.indexOf('resolvePartSentryWriteAuthority(');
  const recordAt = add.indexOf('recordPartSentryEntry(');
  assert.ok(authorityAt > 0 && recordAt > authorityAt, 'authority is decided before anything is recorded');
  assert.doesNotMatch(add, /userContext\.tenantId/, 'the route never stamps the caller\'s tenant claim');
  const readIdx = serverSrc.indexOf("app.get('/api/partsentry/:vin'");
  const readSection = serverSrc.slice(readIdx, serverSrc.indexOf('getRepairHistory(vin', readIdx));
  assert.match(readSection, /resolvePartSentryReadScope\(/);
  assert.ok(!readSection.includes('tenant_id ==='), 'no tenant comparison may widen the read');
  assert.ok(!readSection.includes("role === 'mechanic'"), 'a role alone never widens the read');
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
