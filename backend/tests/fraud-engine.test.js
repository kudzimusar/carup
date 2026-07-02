/**
 * Workstream A — Fraud + Duplicate Detection Engine tests.
 *
 * Heavy unit coverage of the pure detectors, the PURE assessPublicationBlock gate, and
 * persistEvaluation against an in-memory supabase mock. Covers: exact duplicate VIN,
 * near-match VIN, duplicate engine, duplicate registration, temp-plate reuse, source
 * identity conflict, cid_high_risk, odometer reversal, conflicting make/model/year,
 * publication block on critical, false-positive resolution, immutable case history
 * (resolution writes an event), and cross-tenant isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const engine = await import('../services/fraud/fraudEngine.js');
const cases = await import('../services/fraud/fraudCaseService.js');

// ── in-memory supabase mock (extends the WS2 builder with .in() and .update()) ────────
let db;
function resetDb() {
  db = {
    vehicles: [
      { vin: 'CLEANVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, normalized_plate_number: 'ABC123', chassis_number: 'CH-CLEAN-1', engine_number: 'EN-CLEAN-1', temp_plate_id: null, owner_id: 'owner-1', tenant_id: 't1', status: 'active' },
    ],
    fraud_signals: [],
    fraud_cases: [],
    fraud_case_events: [],
    fraud_case_resolutions: [],
    vehicle_evidence: [],
    source_verification_results: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, inFilter: null, order: null, single: false, maybe: false, payload: null, updates: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.updates = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    in(k, vals) { st.inFilter = { k, vals }; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function matches(r, st) {
  if (!Object.entries(st.filters).every(([k, v]) => r[k] === v)) return false;
  if (st.inFilter && !st.inFilter.vals.includes(r[st.inFilter.k])) return false;
  return true;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:00:0${rows.length + i}.000Z`, updated_at: `2026-06-26T00:00:0${rows.length + i}.000Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') {
    const updated = [];
    for (const r of rows) {
      if (matches(r, st)) {
        Object.assign(r, st.updates, { updated_at: '2026-06-26T00:01:00.000Z' });
        updated.push(r);
      }
    }
    if (st.single) return updated[0] ? ok(updated[0]) : { data: null, error: { message: 'not found' } };
    return ok(updated);
  }
  let out = rows.filter((r) => matches(r, st));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}
function installMock() { resetDb(); supabase.from = (t) => builder(t); }

// ── pure helpers ──────────────────────────────────────────────────────────────────
test('levenshtein / normalizedDistance behave', () => {
  assert.equal(engine.levenshtein('ABC', 'ABC'), 0);
  assert.equal(engine.levenshtein('ABC', 'ABD'), 1);
  assert.equal(engine.normalizedDistance('ABC', 'ABC'), 0);
  assert.ok(engine.normalizedDistance('AAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAB') < 0.1);
  assert.equal(engine.normalizedDistance('', ''), 0);
});

// ── assessPublicationBlock (PURE) — heavy coverage ──────────────────────────────────
test('assessPublicationBlock: empty -> not blocked', () => {
  const r = engine.assessPublicationBlock([]);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.reasons, []);
});
test('assessPublicationBlock: blocks on blocks_publication flag', () => {
  const r = engine.assessPublicationBlock([{ signal_code: 'duplicate_registration', severity: 'high', blocks_publication: true }]);
  assert.equal(r.blocked, true);
  assert.equal(r.reasons[0].reason, 'signal_blocks_publication');
});
test('assessPublicationBlock: blocks on critical severity even without flag', () => {
  const r = engine.assessPublicationBlock([{ signal_code: 'duplicate_vin', severity: 'critical', blocks_publication: false }]);
  assert.equal(r.blocked, true);
  assert.equal(r.reasons[0].reason, 'critical_severity');
});
test('assessPublicationBlock: low/medium non-blocking signals do not block', () => {
  const r = engine.assessPublicationBlock([
    { signal_code: 'near_match_vin', severity: 'medium', blocks_publication: false },
    { signal_code: 'repeated_rejected_evidence', severity: 'medium', blocks_publication: false },
  ]);
  assert.equal(r.blocked, false);
});
test('assessPublicationBlock: tolerates null/undefined entries', () => {
  const r = engine.assessPublicationBlock([null, undefined, { signal_code: 'x', severity: 'low' }]);
  assert.equal(r.blocked, false);
});

// ── detectors via evaluateVehicle (data injected) ──────────────────────────────────
const baseVehicle = { vin: 'CLEANVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, normalized_plate_number: 'ABC123', chassis_number: 'CH-1', engine_number: 'EN-1', temp_plate_id: null, owner_id: 'owner-1', tenant_id: 't1', status: 'active' };

test('detect: exact duplicate VIN (other vehicle reuses this VIN in a chassis slot) -> critical, blocks', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle,
    others: [{ vin: 'OTHERVIN000000002', chassis_number: 'CLEANVIN00000001', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  const s = signals.find((x) => x.signal_code === 'duplicate_vin');
  assert.ok(s, 'duplicate_vin raised');
  assert.equal(s.severity, 'critical');
  assert.equal(s.blocks_publication, true);
  assert.ok(s.reason_codes.includes('vin_exact_match'));
});

test('detect: duplicate engine -> critical', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle,
    others: [{ vin: 'OTHERVIN000000002', engine_number: 'EN-1', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  const s = signals.find((x) => x.signal_code === 'duplicate_engine');
  assert.ok(s);
  assert.equal(s.severity, 'critical');
  assert.ok(s.reason_codes.includes('other_vin:OTHERVIN000000002'));
});

test('detect: duplicate chassis -> critical', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle,
    others: [{ vin: 'OTHERVIN000000002', chassis_number: 'CH-1', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  assert.ok(signals.find((x) => x.signal_code === 'duplicate_chassis'));
});

test('detect: duplicate registration -> high, blocks', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle,
    others: [{ vin: 'OTHERVIN000000002', normalized_plate_number: 'ABC123', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  const s = signals.find((x) => x.signal_code === 'duplicate_registration');
  assert.ok(s);
  assert.equal(s.severity, 'high');
  assert.equal(s.blocks_publication, true);
});

test('detect: near-match VIN -> medium, requires review, not blocking', async () => {
  // one-char difference on a 16-char VIN -> normalized distance ~0.0625 <= 0.12 threshold
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle,
    others: [{ vin: 'CLEANVIN00000002', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  const s = signals.find((x) => x.signal_code === 'near_match_vin');
  assert.ok(s, 'near_match_vin raised');
  assert.equal(s.severity, 'medium');
  assert.equal(s.requires_review, true);
  assert.equal(s.blocks_publication, false);
  assert.ok(s.confidence > 0.9);
});

test('detect: a totally different VIN does NOT raise near_match_vin', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle,
    others: [{ vin: 'ZZZZ999988887777', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  assert.equal(signals.find((x) => x.signal_code === 'near_match_vin'), undefined);
});

test('detect: near-match threshold is configurable', async () => {
  // 3-char diff: normalized distance ~0.1875 > default 0.12 (no signal) but <= 0.3 (signal)
  const others = [{ vin: 'CLEANVIN000ZZZ01', owner_id: 'owner-2' }];
  const tight = await engine.evaluateVehicle('CLEANVIN00000001', { vehicle: baseVehicle, others, evidence: [], sourceResults: [] });
  assert.equal(tight.find((x) => x.signal_code === 'near_match_vin'), undefined);
  const loose = await engine.evaluateVehicle('CLEANVIN00000001', { vehicle: baseVehicle, others, evidence: [], sourceResults: [], nearMatchThreshold: 0.3 });
  assert.ok(loose.find((x) => x.signal_code === 'near_match_vin'));
});

test('detect: temp-plate reuse -> high, blocks', async () => {
  const v = { ...baseVehicle, temp_plate_id: 'TP-777' };
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: v,
    others: [{ vin: 'OTHERVIN000000002', temp_plate_id: 'TP-777', owner_id: 'owner-2' }],
    evidence: [], sourceResults: [],
  });
  const s = signals.find((x) => x.signal_code === 'temp_plate_reuse');
  assert.ok(s);
  assert.equal(s.severity, 'high');
  assert.equal(s.blocks_publication, true);
});

test('detect: source identity conflict (mismatch) -> high', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], evidence: [],
    sourceResults: [{ provider: 'zimra', result: 'mismatch', confidence: 0.8, mismatch_flags: ['zimra_year_mismatch'] }],
  });
  const s = signals.find((x) => x.signal_code === 'source_identity_conflict');
  assert.ok(s);
  assert.equal(s.severity, 'high');
  assert.ok(s.reason_codes.includes('zimra_year_mismatch'));
});

test('detect: cid high_risk -> critical, escalate, blocks', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], evidence: [],
    sourceResults: [{ provider: 'cid', result: 'high_risk', confidence: 0.95, identity_fields: { stolen_check_status: 'Flagged_Stolen' } }],
  });
  const cid = signals.find((x) => x.signal_code === 'cid_high_risk');
  assert.ok(cid);
  assert.equal(cid.severity, 'critical');
  assert.equal(cid.blocks_publication, true);
  assert.equal(cid.recommended_action, 'block_and_escalate');
  // a cid high_risk also surfaces as a source_identity_conflict (critical)
  assert.ok(signals.find((x) => x.signal_code === 'source_identity_conflict' && x.severity === 'critical'));
});

test('detect: conflicting make/model/year vs source identity -> high, blocks', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], evidence: [],
    sourceResults: [{ provider: 'cvr', result: 'match', identity_fields: { declared_make: 'Nissan', declared_year: 2020 } }],
  });
  const s = signals.find((x) => x.signal_code === 'conflicting_make_model_year');
  assert.ok(s);
  assert.equal(s.severity, 'high');
  assert.ok(s.reason_codes.some((c) => c.startsWith('make:')));
  assert.ok(s.reason_codes.some((c) => c.startsWith('year:')));
});

test('detect: odometer reversal -> high, blocks', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], sourceResults: [],
    evidence: [
      { id: 'e1', evidence_type: 'odometer_photo', metadata: { odometer_km: 90000 }, captured_at: '2026-01-01T00:00:00Z' },
      { id: 'e2', evidence_type: 'odometer_photo', metadata: { odometer_km: 60000 }, captured_at: '2026-03-01T00:00:00Z' },
    ],
  });
  const s = signals.find((x) => x.signal_code === 'odometer_reversal');
  assert.ok(s);
  assert.equal(s.severity, 'high');
  assert.equal(s.blocks_publication, true);
  assert.ok(s.reason_codes.includes('prev_km:90000'));
});

test('detect: impossible mileage (huge jump in a day) -> medium', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], sourceResults: [],
    evidence: [
      { id: 'e1', evidence_type: 'odometer_photo', metadata: { odometer_km: 10000 }, captured_at: '2026-01-01T00:00:00Z' },
      { id: 'e2', evidence_type: 'odometer_photo', metadata: { odometer_km: 90000 }, captured_at: '2026-01-02T00:00:00Z' },
    ],
  });
  assert.ok(signals.find((x) => x.signal_code === 'impossible_mileage'));
});

test('detect: normal increasing mileage raises nothing', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], sourceResults: [],
    evidence: [
      { id: 'e1', evidence_type: 'odometer_photo', metadata: { odometer_km: 50000 }, captured_at: '2026-01-01T00:00:00Z' },
      { id: 'e2', evidence_type: 'odometer_photo', metadata: { odometer_km: 52000 }, captured_at: '2026-03-01T00:00:00Z' },
    ],
  });
  assert.equal(signals.find((x) => ['odometer_reversal', 'impossible_mileage'].includes(x.signal_code)), undefined);
});

test('detect: evidence checksum reuse across vehicles -> high, blocks', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], sourceResults: [],
    evidence: [{ id: 'e1', evidence_type: 'auction_photo', checksum: 'SHAREDSUM123' }],
    foreignEvidence: [{ id: 'f1', vin: 'OTHERVIN000000002', checksum: 'SHAREDSUM123' }],
  });
  const s = signals.find((x) => x.signal_code === 'evidence_checksum_reuse');
  assert.ok(s);
  assert.equal(s.severity, 'high');
  assert.ok(s.reason_codes.includes('other_vin:OTHERVIN000000002'));
});

test('detect: repeated rejected evidence -> medium, review', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], sourceResults: [],
    evidence: [
      { id: 'e1', verification_status: 'rejected' },
      { id: 'e2', verification_status: 'rejected' },
      { id: 'e3', verification_status: 'rejected' },
    ],
  });
  const s = signals.find((x) => x.signal_code === 'repeated_rejected_evidence');
  assert.ok(s);
  assert.equal(s.requires_review, true);
});

test('detect: a clean vehicle with no peers/evidence raises ZERO signals', async () => {
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [{ vin: 'WILDLYDIFFERENT9', owner_id: 'o9' }], evidence: [], sourceResults: [],
  });
  assert.equal(signals.length, 0);
});

test('detect: a broken detector input fails SOFT (no throw, other signals survive)', async () => {
  // evidence with a getter that throws when metadata is read would crash a naive loop; here
  // we pass a source conflict alongside malformed evidence and assert the source signal survives.
  const malformed = [{ id: 'e1', get metadata() { throw new Error('boom'); } }];
  const signals = await engine.evaluateVehicle('CLEANVIN00000001', {
    vehicle: baseVehicle, others: [], evidence: malformed,
    sourceResults: [{ provider: 'cid', result: 'high_risk', confidence: 0.9, identity_fields: {} }],
  });
  assert.ok(signals.find((x) => x.signal_code === 'cid_high_risk'), 'source detector still fired despite broken evidence');
});

// ── persistEvaluation ──────────────────────────────────────────────────────────────
test('persist: critical signals open a case, write signals + an evaluated event, block publication', async () => {
  installMock();
  const signals = [
    { signal_code: 'duplicate_vin', severity: 'critical', confidence: 0.99, reason_codes: ['vin_exact_match'], evidence_refs: [], related_identities: [], blocks_publication: true, requires_review: true, rule_version: engine.RULE_VERSION },
  ];
  const { case: theCase, signals: inserted } = await engine.persistEvaluation('CLEANVIN00000001', signals, { tenantId: 't1', actorId: 'reviewer-1', actorRole: 'reviewer' });
  assert.ok(theCase);
  assert.equal(theCase.status, 'open');
  assert.equal(theCase.highest_severity, 'critical');
  assert.equal(theCase.blocks_publication, true);
  assert.equal(theCase.open_signal_count, 1);
  assert.equal(inserted.length, 1);
  assert.equal(db.fraud_signals.length, 1);
  assert.equal(db.fraud_signals[0].tenant_id, 't1');
  // an append-only 'evaluated' event is written
  const events = db.fraud_case_events.filter((e) => e.case_id === theCase.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'evaluated');
  assert.equal(events[0].actor_id, 'reviewer-1');
  assert.equal(events[0].payload.signal_count, 1);
});

test('persist: no signals -> no case opened, no signal rows', async () => {
  installMock();
  const { case: theCase, signals } = await engine.persistEvaluation('CLEANVIN00000001', [], { tenantId: 't1' });
  assert.equal(theCase, null);
  assert.equal(signals.length, 0);
  assert.equal(db.fraud_cases.length, 0);
  assert.equal(db.fraud_signals.length, 0);
});

test('persist: medium-only signals that require review still open a case', async () => {
  installMock();
  const signals = [{ signal_code: 'near_match_vin', severity: 'medium', blocks_publication: false, requires_review: true, reason_codes: [], evidence_refs: [], related_identities: [] }];
  const { case: theCase } = await engine.persistEvaluation('CLEANVIN00000001', signals, { tenantId: 't1' });
  assert.ok(theCase);
  assert.equal(theCase.status, 'open');
  assert.equal(theCase.blocks_publication, false);
});

test('persist: re-evaluation appends NEW signals + a second event (history is immutable/append-only)', async () => {
  installMock();
  const mk = (code) => [{ signal_code: code, severity: 'high', blocks_publication: true, requires_review: true, reason_codes: [], evidence_refs: [], related_identities: [] }];
  const first = await engine.persistEvaluation('CLEANVIN00000001', mk('duplicate_registration'), { tenantId: 't1', actorId: 'r1', actorRole: 'reviewer' });
  const second = await engine.persistEvaluation('CLEANVIN00000001', mk('temp_plate_reuse'), { tenantId: 't1', actorId: 'r1', actorRole: 'reviewer' });
  // same case reused
  assert.equal(first.case.id, second.case.id);
  // both signal rows retained (append-only)
  assert.equal(db.fraud_signals.length, 2);
  // two evaluated events retained (append-only trail)
  assert.equal(db.fraud_case_events.filter((e) => e.event_type === 'evaluated').length, 2);
});

// ── case service ───────────────────────────────────────────────────────────────────
test('case service: listOpenCases returns active queue and filters by severity', async () => {
  installMock();
  db.fraud_cases.push(
    { id: 'c1', vin: 'V1', tenant_id: 't1', highest_severity: 'critical', open_signal_count: 1, status: 'open', blocks_publication: true, updated_at: '2026-06-26T00:00:01.000Z' },
    { id: 'c2', vin: 'V2', tenant_id: 't1', highest_severity: 'medium', open_signal_count: 1, status: 'investigating', blocks_publication: false, updated_at: '2026-06-26T00:00:02.000Z' },
    { id: 'c3', vin: 'V3', tenant_id: 't1', highest_severity: 'high', open_signal_count: 0, status: 'resolved', blocks_publication: false, updated_at: '2026-06-26T00:00:03.000Z' },
  );
  const open = await cases.listOpenCases({});
  assert.equal(open.length, 2, 'resolved excluded from active queue');
  const critical = await cases.listOpenCases({ severity: 'critical' });
  assert.equal(critical.length, 1);
  assert.equal(critical[0].id, 'c1');
});

test('case service: getCase returns signals + events + resolutions', async () => {
  installMock();
  db.fraud_cases.push({ id: 'c1', vin: 'CLEANVIN00000001', tenant_id: 't1', status: 'open', highest_severity: 'critical', open_signal_count: 1, blocks_publication: true });
  db.fraud_signals.push({ id: 's1', vin: 'CLEANVIN00000001', signal_code: 'duplicate_vin', severity: 'critical', reason_codes: [], evidence_refs: [], related_identities: [] });
  db.fraud_case_events.push({ id: 'ev1', case_id: 'c1', event_type: 'evaluated', payload: {} });
  const full = await cases.getCase('c1');
  assert.equal(full.signals.length, 1);
  assert.equal(full.events.length, 1);
  assert.deepEqual(full.resolutions, []);
});

test('case service: getCase unknown id -> null', async () => {
  installMock();
  assert.equal(await cases.getCase('nope'), null);
});

test('case service: false_positive resolution writes a resolution + an event and dismisses the case', async () => {
  installMock();
  db.fraud_cases.push({ id: 'c1', vin: 'CLEANVIN00000001', tenant_id: 't1', status: 'open', blocks_publication: true, open_signal_count: 2 });
  const { case: updated, resolution } = await cases.resolveCase('c1', { resolution: 'false_positive', reason: 'same plate, different legitimate listing' }, { id: 'reviewer-1', role: 'reviewer' });
  assert.equal(updated.status, 'dismissed');
  assert.equal(updated.blocks_publication, false);
  assert.equal(updated.open_signal_count, 0);
  // append-only resolution row
  assert.equal(db.fraud_case_resolutions.length, 1);
  assert.equal(resolution.resolution, 'false_positive');
  assert.equal(resolution.actor_id, 'reviewer-1');
  // append-only event mirrors it
  const resEvents = db.fraud_case_events.filter((e) => e.event_type === 'resolved');
  assert.equal(resEvents.length, 1);
  assert.equal(resEvents[0].reason, 'same plate, different legitimate listing');
});

test('case service: confirmed_duplicate resolves and keeps publication blocked', async () => {
  installMock();
  db.fraud_cases.push({ id: 'c1', vin: 'CLEANVIN00000001', tenant_id: 't1', status: 'investigating', blocks_publication: true });
  const { case: updated } = await cases.resolveCase('c1', { resolution: 'confirmed_duplicate', reason: 'verified clone' }, { id: 'admin-1', role: 'admin' });
  assert.equal(updated.status, 'resolved');
  assert.equal(updated.blocks_publication, true);
});

test('case service: identity_merge_approved records INTENT only — never auto-merges (case stays investigating)', async () => {
  installMock();
  db.fraud_cases.push({ id: 'c1', vin: 'CLEANVIN00000001', tenant_id: 't1', status: 'investigating', blocks_publication: true });
  const { case: updated } = await cases.resolveCase('c1', { resolution: 'identity_merge_approved', reason: 'same vehicle confirmed' }, { id: 'admin-1', role: 'admin' });
  // not closed — a governed merge step is still required
  assert.equal(updated.status, 'investigating');
  const resEvent = db.fraud_case_events.find((e) => e.event_type === 'resolved');
  assert.equal(resEvent.payload.identity_merge.auto_merged, false);
  assert.equal(resEvent.payload.identity_merge.requires_governed_merge_step, true);
});

test('case service: invalid resolution -> throws (400-shaped)', async () => {
  installMock();
  db.fraud_cases.push({ id: 'c1', vin: 'CLEANVIN00000001', tenant_id: 't1', status: 'open' });
  await assert.rejects(() => cases.resolveCase('c1', { resolution: 'totally_made_up' }, { id: 'a1', role: 'admin' }), /resolution must be one of/);
});

test('case service: resolution requires an authenticated actor', async () => {
  installMock();
  db.fraud_cases.push({ id: 'c1', vin: 'CLEANVIN00000001', tenant_id: 't1', status: 'open' });
  await assert.rejects(() => cases.resolveCase('c1', { resolution: 'released' }, {}), /authenticated actor/);
});

test('case service: resolving an unknown case -> throws not found', async () => {
  installMock();
  await assert.rejects(() => cases.resolveCase('ghost', { resolution: 'released' }, { id: 'a1', role: 'admin' }), /Fraud case not found/);
});

// ── cross-tenant isolation ──────────────────────────────────────────────────────────
test('cross-tenant: a case for tenant A is NOT returned by a tenant B query', async () => {
  installMock();
  db.fraud_cases.push(
    { id: 'cA', vin: 'VA', tenant_id: 'tenantA', highest_severity: 'high', status: 'open', open_signal_count: 1, blocks_publication: true, updated_at: '2026-06-26T00:00:01.000Z' },
    { id: 'cB', vin: 'VB', tenant_id: 'tenantB', highest_severity: 'high', status: 'open', open_signal_count: 1, blocks_publication: true, updated_at: '2026-06-26T00:00:02.000Z' },
  );
  const tenantB = await cases.listOpenCases({ tenant_id: 'tenantB' });
  assert.equal(tenantB.length, 1);
  assert.equal(tenantB[0].id, 'cB');
  assert.ok(!tenantB.some((c) => c.tenant_id === 'tenantA'), 'tenant A case must not leak into tenant B query');
});

test('cross-tenant: persisted signal carries the evaluating tenant only', async () => {
  installMock();
  await engine.persistEvaluation('CLEANVIN00000001', [
    { signal_code: 'duplicate_vin', severity: 'critical', blocks_publication: true, requires_review: true, reason_codes: [], evidence_refs: [], related_identities: [] },
  ], { tenantId: 'tenantA' });
  assert.ok(db.fraud_signals.every((s) => s.tenant_id === 'tenantA'));
  assert.ok(db.fraud_cases.every((c) => c.tenant_id === 'tenantA'));
  const tenantB = await cases.listOpenCases({ tenant_id: 'tenantB' });
  assert.equal(tenantB.length, 0);
});
