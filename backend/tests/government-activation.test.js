/**
 * Full Activation — Government Source Activation layer (ZIMRA · CVR · ZINARA · VID · CID).
 *
 * Drives the governed provider path + honest mapping into source_verification_results, using
 * the same in-memory supabase mock as provider-platform.test.js. For every source it proves:
 *   - sandbox success -> result 'match' with honest mode 'sandbox' (never 'live');
 *   - a high_risk VIN -> result 'high_risk' AND a fraud_case is opened (flagged);
 *   - a mismatch VIN  -> result 'mismatch' AND it enters fraud review;
 *   - a KILLED provider and an UNCONTRACTED source -> 'unavailable' (never fabricated);
 *   - the buyer/partner projection exposes only safe fields (no refs/serials/owner identity);
 *   - CID access is logged (append-only provider_request_attempts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const reg = await import('../services/providerPlatform/providerRegistry.js');
const gov = await import('../services/sourceVerification/governmentActivation.js');

// ── in-memory supabase mock (mirrors provider-platform.test.js) ─────────────────
let db;
function reset() {
  db = {
    users: [{ id: 'admin-1', role: 'admin', is_verified: true }],
    vehicles: [], vehicle_evidence: [],
    provider_registry: [], provider_activation_history: [], provider_request_attempts: [],
    provider_health_checks: [], provider_incidents: [],
    source_verification_results: [], fraud_signals: [], fraud_cases: [], fraud_case_events: [],
    government_source_config: [], government_source_batch_imports: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, limit: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    limit(n) { st.limit = n; return chain; },
    single() { st.single = true; return chain; }, maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
let seq = 0;
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    for (const p of list) if (st.table === 'provider_request_attempts' && p.idempotency_key && rows.some(r => r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'dup idempotency' } };
    const ins = list.map((p) => ({ id: p.id || `${st.table}-${++seq}`, created_at: p.created_at || `2026-07-03T00:00:${String(seq % 60).padStart(2, '0')}Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.limit) out = out.slice(0, st.limit);
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}
function install() { seq = 0; reset(); supabase.from = (t) => builder(t); }

function seedVehicle(vin) {
  db.vehicles.push({ vin, make: 'Toyota', model: 'Hilux', year: 2018, plate_number: 'ADZ-1', chassis_number: null, engine_number: null, temp_plate_id: null, owner_id: 'owner-1', tenant_id: null });
  return vin;
}
async function registerSandbox(sourceKey, { killed = false } = {}) {
  const p = await reg.upsertProvider({ provider_key: sourceKey, capability_type: 'government_source', display_name: sourceKey.toUpperCase() }, { id: 'admin-1' });
  await reg.setActivationMode(p.id, 'sandbox', { actor: { id: 'admin-1', role: 'admin' } });
  if (!killed) await reg.setKillSwitch(p.id, false, { actor: { id: 'admin-1' } });
  return db.provider_registry.find(x => x.id === p.id);
}

// ── per-source behavior matrix ───────────────────────────────────────────────────
for (const src of gov.SOURCE_KEYS) {
  test(`${src}: sandbox success -> match with honest mode 'sandbox'`, async () => {
    install();
    await registerSandbox(src);
    const vin = seedVehicle(`${src.toUpperCase()}CLEANVIN`);
    const { result } = await gov.runGovernmentCheck(src, vin, { requestedBy: 'admin-1', actorRole: 'admin' });
    assert.equal(result.result, 'match');
    assert.equal(result.mode, 'sandbox');          // never relabelled 'live'
    assert.notEqual(result.mode, 'live');
    assert.equal(result.provider, src);
    assert.equal(db.source_verification_results.length, 1);
  });

  test(`${src}: high_risk VIN -> high_risk result and a fraud case is opened`, async () => {
    install();
    await registerSandbox(src);
    const vin = seedVehicle(`${src.toUpperCase()}STOLENVIN`);
    const { result, review } = await gov.runGovernmentCheck(src, vin, { requestedBy: 'admin-1', actorRole: 'admin' });
    assert.equal(result.result, 'high_risk');
    assert.ok(review && review.fraud_case_id, 'high_risk must open a fraud case');
    assert.equal(review.blocks_publication, true);
    assert.equal(db.fraud_cases.length, 1);
    assert.equal(db.fraud_cases[0].status, 'open');
  });

  test(`${src}: mismatch VIN -> mismatch result enters review`, async () => {
    install();
    await registerSandbox(src);
    const vin = seedVehicle(`${src.toUpperCase()}MISMATCHVIN`);
    const { result, review } = await gov.runGovernmentCheck(src, vin, { requestedBy: 'admin-1', actorRole: 'admin' });
    assert.equal(result.result, 'mismatch');
    assert.ok(review && review.fraud_case_id, 'mismatch must enter fraud review');
    assert.equal(db.fraud_cases.length, 1);
  });

  test(`${src}: killed provider -> unavailable, never fabricated`, async () => {
    install();
    await registerSandbox(src, { killed: true });
    const vin = seedVehicle(`${src.toUpperCase()}CLEANVIN`);
    const { result } = await gov.runGovernmentCheck(src, vin, { requestedBy: 'admin-1' });
    assert.equal(result.result, 'unavailable');
    assert.equal(result.mode, 'unavailable');
    assert.equal(result.error_class, 'not_contracted');
    assert.notEqual(result.result, 'match');       // fail-closed, no fabrication
  });

  test(`${src}: buyer projection exposes only safe fields`, async () => {
    install();
    await registerSandbox(src);
    const vin = seedVehicle(`${src.toUpperCase()}CLEANVIN`);
    const { result } = await gov.runGovernmentCheck(src, vin, { requestedBy: 'admin-1' });
    const buyer = gov.projectResultForAudience(result, 'buyer');
    const PRIVILEGED = ['customs_ref_number', 'registration_number', 'logbook_serial', 'receipt_number', 'certificate_serial', 'clearance_ref_number', 'case_reference', 'owner_id', 'ownership_verified'];
    for (const k of PRIVILEGED) assert.equal(k in (buyer.identity_fields || {}), false, `buyer must not see ${k} for ${src}`);
    assert.equal('raw_payload' in buyer, false);
    assert.ok(buyer.coverage_status, 'buyer projection carries a coverage_status');
    // every exposed field must be in the source allow-list
    const allow = new Set(gov.GOVERNMENT_FIELD_MAPS[src].buyerSafe);
    for (const k of Object.keys(buyer.identity_fields || {})) assert.ok(allow.has(k), `${k} not buyer-safe for ${src}`);
  });
}

// ── uncontracted source (no provider_registry row) ───────────────────────────────
test('uncontracted source -> unavailable + not_contracted, never fabricated, and logged', async () => {
  install();
  const vin = seedVehicle('ZIMRACLEANVIN'); // NO provider registered
  const { result } = await gov.runGovernmentCheck('zimra', vin, { requestedBy: 'admin-1' });
  assert.equal(result.result, 'unavailable');
  assert.equal(result.mode, 'unavailable');
  assert.equal(result.error_class, 'not_contracted');
  const logged = db.provider_request_attempts.some(a => a.vin === vin && a.outcome === 'unavailable' && a.error_category === 'not_registered');
  assert.ok(logged, 'a query to an unconfigured source is still access-logged');
});

// ── CID strict access logging ────────────────────────────────────────────────────
test('cid: every access is logged in append-only provider_request_attempts', async () => {
  install();
  const provider = await registerSandbox('cid');
  const vin = seedVehicle('CIDCLEANVIN');
  await gov.runGovernmentCheck('cid', vin, { requestedBy: 'admin-1' });
  const logged = db.provider_request_attempts.filter(a => a.provider_id === provider.id && a.vin === vin);
  assert.ok(logged.length >= 1, 'CID access must be logged with provider_id + vin');
  // buyer must NEVER see the stolen-check reference/case fields
  const { result } = await gov.runGovernmentCheck('cid', vin, { requestedBy: 'admin-1' });
  const buyer = gov.projectResultForAudience(result, 'buyer');
  assert.equal('clearance_ref_number' in buyer.identity_fields, false);
  assert.equal('case_reference' in buyer.identity_fields, false);
  assert.ok('stolen_status_category' in buyer.identity_fields || result.result !== 'match');
});

// ── live transport is a stub (never fabricates) ──────────────────────────────────
test('pilot_live transport stub returns unavailable (credential_pending), not a fabricated verdict', async () => {
  install();
  const p = await reg.upsertProvider({ provider_key: 'zimra', capability_type: 'government_source', display_name: 'ZIMRA', credential_ref: 'ZIMRA_API_KEY' }, { id: 'admin-1' });
  // A signed contract is a separate governed action; set it before moving to pilot_live.
  db.provider_registry.find(x => x.id === p.id).contract_status = 'signed';
  // move to pilot_live (allowed: signed contract + credential_ref) and enable
  await reg.setActivationMode(p.id, 'pilot_live', { actor: { id: 'admin-1' } });
  await reg.setKillSwitch(p.id, false, { actor: { id: 'admin-1' } });
  const vin = seedVehicle('ZIMRACLEANVIN');
  const { result } = await gov.runGovernmentCheck('zimra', vin, { requestedBy: 'admin-1' });
  assert.equal(result.result, 'unavailable');      // stub — no live endpoint wired
  assert.equal(result.mode, 'unavailable');
  assert.notEqual(result.result, 'match');
});

// ── operator surfaces ────────────────────────────────────────────────────────────
test('batch import records a Storage path reference only (rejects URLs)', async () => {
  install();
  await registerSandbox('zimra');
  const rec = await gov.recordBatchImport({ sourceKey: 'zimra', fileRef: 'gov-imports/zimra/2026-07-03.csv', checksum: 'sha256:abc', rowCount: 1200 }, { id: 'admin-1' });
  assert.equal(rec.file_ref, 'gov-imports/zimra/2026-07-03.csv');
  assert.equal(rec.status, 'pending');
  assert.equal(db.government_source_batch_imports.length, 1);
  await assert.rejects(() => gov.recordBatchImport({ sourceKey: 'zimra', fileRef: 'https://evil/leak.csv' }, { id: 'admin-1' }), /Storage path/);
});

test('health + emergency-disable: kill switch on and mode -> suspended', async () => {
  install();
  await registerSandbox('cvr');
  let health = await gov.getGovernmentHealth();
  assert.equal(health[0].callable, true);
  const p = await gov.emergencyDisableSource('cvr', { reason: 'incident', actor: { id: 'admin-1', role: 'admin' } });
  assert.equal(p.kill_switch_enabled, true);
  assert.equal(p.activation_mode, 'suspended');
  health = await gov.getGovernmentHealth();
  assert.equal(health[0].callable, false);
});

test('errors surface lists non-clean government attempts', async () => {
  install();
  await registerSandbox('vid', { killed: true });
  const vin = seedVehicle('VIDCLEANVIN');
  await gov.runGovernmentCheck('vid', vin, { requestedBy: 'admin-1' }); // blocked -> unavailable
  const errors = await gov.listGovernmentErrors({ limit: 50 });
  assert.ok(errors.length >= 1);
  assert.ok(errors.every(e => e.capability_type === 'government_source'));
});
