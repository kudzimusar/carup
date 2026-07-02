/**
 * Workstream 2 — Source Verification Network tests.
 *
 * Covers the verification contract (honesty guards), each sandbox registry adapter's
 * scenarios (match / mismatch / no_record / unavailable / high_risk), and the
 * orchestrator (append-only persistence, identity cross-check, manual verification,
 * fail-closed disablement, sandbox labelling, raw-payload redaction).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const contract = await import('../services/sourceVerification/verificationContract.js');
const { buildRegistryAdapters } = await import('../services/sourceVerification/adapters/registryAdapters.js');
const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/sourceVerification/sourceVerificationService.js');

// ── in-memory supabase mock ───────────────────────────────────────────────────
let db;
function resetDb() {
  db = {
    vehicles: [
      { vin: 'CLEANVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' },
      { vin: 'MISMATCHVIN000001', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' },
      { vin: 'YEARDIFFVIN000001', make: 'Toyota', model: 'Hilux', year: 2020, tenant_id: 't1' },
      { vin: 'UNAVAILVIN0000001', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' },
      { vin: 'STOLENVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' },
    ],
    source_verification_results: [],
    source_verification_coverage_public: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, order: null, single: false, maybe: false, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:00:0${rows.length + i}.000Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}
function installMock() { resetDb(); supabase.from = (t) => builder(t); }

// ── contract honesty guards ────────────────────────────────────────────────────
test('contract: rejects invalid mode', () => {
  assert.throws(() => contract.normalizeVerificationResult('zimra', { mode: 'official', result: 'match' }), /invalid mode/);
});
test('contract: mode unavailable cannot report match', () => {
  assert.throws(() => contract.normalizeVerificationResult('zimra', { mode: 'unavailable', result: 'match' }), /cannot report result/);
});
test('contract: result unavailable requires mode unavailable', () => {
  assert.throws(() => contract.normalizeVerificationResult('cvr', { mode: 'sandbox', result: 'unavailable' }), /requires mode/);
});
test('contract: no_record cannot carry high confidence', () => {
  assert.throws(() => contract.normalizeVerificationResult('vid', { mode: 'sandbox', result: 'no_record', confidence: 0.9 }), /confidence > 0.5/);
});
test('contract: accepts a well-formed sandbox match', () => {
  const r = contract.normalizeVerificationResult('cid', { mode: 'sandbox', result: 'match', confidence: 0.88 });
  assert.equal(r.result, 'match');
  assert.equal(r.mode, 'sandbox');
});

// ── adapters: all five, all scenarios ──────────────────────────────────────────
const adapters = buildRegistryAdapters();
assert.equal(adapters.length, 5);

for (const adapter of adapters) {
  test(`${adapter.provider}: clean VIN -> sandbox match`, async () => {
    const r = await adapter.verify({ vin: 'CLEANVIN00000001' });
    assert.equal(r.mode, 'sandbox');
    assert.equal(r.result, 'match');
    assert.ok(r.confidence > 0);
    assert.ok(r.legal_basis.includes('SANDBOX'));
  });
  test(`${adapter.provider}: MISMATCH VIN -> mismatch with flags`, async () => {
    const r = await adapter.verify({ vin: 'MISMATCHVIN000001' });
    assert.equal(r.result, 'mismatch');
    assert.ok(r.mismatch_flags.length > 0);
  });
  test(`${adapter.provider}: UNAVAIL VIN -> unavailable (mode unavailable, error_class set)`, async () => {
    const r = await adapter.verify({ vin: 'UNAVAILVIN0000001' });
    assert.equal(r.mode, 'unavailable');
    assert.equal(r.result, 'unavailable');
    assert.ok(r.error_class);
  });
  test(`${adapter.provider}: NORECORD VIN -> no_record`, async () => {
    const r = await adapter.verify({ vin: 'NORECORDVIN000001' });
    assert.equal(r.result, 'no_record');
  });
  test(`${adapter.provider}: STOLEN/RISK VIN -> high_risk`, async () => {
    const r = await adapter.verify({ vin: 'STOLENVIN00000001' });
    assert.equal(r.result, 'high_risk');
  });
}

test('cid: high_risk stolen scenario escalates with case reference', async () => {
  const cid = adapters.find((a) => a.provider === 'cid');
  const r = await cid.verify({ vin: 'STOLENVIN00000001' });
  assert.equal(r.identity_fields.stolen_check_status, 'Flagged_Stolen');
  assert.ok(r.mismatch_flags.includes('immediate_escalation'));
});

// ── fail-closed: disabled adapter ───────────────────────────────────────────────
test('adapter disabled by flag -> unavailable / not_contracted (never match)', async () => {
  const [zimra] = buildRegistryAdapters({ zimra: () => false });
  assert.equal(zimra.getMode(), 'unavailable');
  const r = await zimra.verify({ vin: 'CLEANVIN00000001' });
  assert.equal(r.result, 'unavailable');
  assert.equal(r.error_class, 'not_contracted');
});

// ── orchestrator ────────────────────────────────────────────────────────────────
test('orchestrator: verifySource persists append-only row, strips raw_payload from result', async () => {
  installMock();
  svc.initSourceVerification();
  const r = await svc.verifySource('CLEANVIN00000001', 'zimra');
  assert.equal(r.result, 'match');
  assert.equal(r.mode, 'sandbox');
  assert.equal(r.raw_payload, undefined, 'public result must not include raw_payload');
  assert.equal(db.source_verification_results.length, 1);
  assert.ok(db.source_verification_results[0].raw_payload, 'raw retained in storage for audit');
});

test('orchestrator: identity cross-check downgrades match->mismatch when vehicle year differs', async () => {
  installMock();
  svc.initSourceVerification();
  const r = await svc.verifySource('YEARDIFFVIN000001', 'zimra');
  // ZIMRA match fixture declares year 2018; vehicle is 2020 -> derived mismatch.
  assert.equal(r.result, 'mismatch');
  assert.ok(r.mismatch_flags.includes('zimra_year_mismatch'));
});

test('orchestrator: a thrown adapter is recorded fail-closed as unavailable', async () => {
  installMock();
  svc.initSourceVerification();
  // Register a deliberately broken adapter via the contract registry.
  contract.registerAdapter({
    provider: 'vid', displayName: 'broken', supportedQueryTypes: ['vin'],
    getMode: () => 'sandbox',
    verify: async () => { throw new Error('boom'); },
  });
  const r = await svc.verifySource('CLEANVIN00000001', 'vid');
  assert.equal(r.result, 'unavailable');
  assert.equal(r.error_class, 'provider_error');
});

test('orchestrator: verifyAllSources runs all five providers', async () => {
  installMock();
  svc.initSourceVerification();
  const all = await svc.verifyAllSources('CLEANVIN00000001');
  assert.equal(all.length, 5);
  assert.deepEqual([...new Set(all.map((x) => x.provider))].sort(), ['cid', 'cvr', 'vid', 'zimra', 'zinara']);
});

test('orchestrator: manual verification is mode-labelled and carries actor + reason', async () => {
  installMock();
  svc.initSourceVerification();
  const r = await svc.recordManualVerification('CLEANVIN00000001', 'cvr',
    { result: 'match', reason: 'Reviewed original CVR logbook', confidence: 0.7 },
    { id: 'reviewer-1', role: 'reviewer' });
  assert.equal(r.mode, 'manual_verification');
  assert.equal(r.manual_verified_by, 'reviewer-1');
  assert.ok(r.legal_basis.includes('Not a live government API'));
});

test('orchestrator: manual verification rejects an unauthenticated actor', async () => {
  installMock();
  svc.initSourceVerification();
  await assert.rejects(
    () => svc.recordManualVerification('CLEANVIN00000001', 'cvr', { result: 'match' }, null),
    /authenticated actor/,
  );
});

test('orchestrator: getResults includeRaw=false strips raw, true keeps it', async () => {
  installMock();
  svc.initSourceVerification();
  await svc.verifySource('CLEANVIN00000001', 'zimra');
  const pub = await svc.getResults('CLEANVIN00000001', { includeRaw: false });
  assert.equal(pub[0].raw_payload, undefined);
  const priv = await svc.getResults('CLEANVIN00000001', { includeRaw: true });
  assert.ok(priv[0].raw_payload);
});

test('orchestrator: unknown vehicle throws (no result fabricated)', async () => {
  installMock();
  svc.initSourceVerification();
  await assert.rejects(() => svc.verifySource('GHOSTVIN000000001', 'zimra'), /Vehicle not found/);
});
