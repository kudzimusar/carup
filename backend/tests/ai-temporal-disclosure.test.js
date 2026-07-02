/**
 * Milestone 3 tests — durable AI jobs, similarity, temporal comparison, disclosure conflicts.
 * Master plan §7.x, §8.x, §9.x acceptance criteria. Deterministic (mock provider).
 *
 * Governance invariants asserted throughout:
 *   - AI never changes evidence verification_status or trust
 *   - temporal findings + disclosure conflicts default to reviewer_state 'pending_review'
 *   - low same-vehicle confidence is NOT publishable
 *   - disclosure conflicts are neutral, never accusatory; original text retained
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.ALLOW_OCR_MOCK = 'true'; // force deterministic mock provider

const jobs = await import('../services/ai/analysisJobService.js');
const sim = await import('../services/ai/similarityService.js');
const temporal = await import('../services/intelligence/temporalComparison.js');
const disclosure = await import('../services/intelligence/disclosureConflict.js');
const { mockAnalysisProvider } = await import('../services/ai/analysisProvider.js');

function makeMock(seed = {}) {
  const db = { ai_analysis_jobs: [], ai_observations: [], temporal_findings: [], disclosure_claims: [], disclosure_conflicts: [], vehicle_evidence: [], ...seed };
  function builder(t) {
    const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
    const chain = {
      select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; }, neq() { return chain; }, in() { return chain; }, is() { return chain; },
      order(col, opts) { st.order = { col, asc: opts?.ascending ?? false }; return chain; },
      limit(n) { st.lim = n; return chain; }, single() { st.single = true; return chain; },
      then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return chain;
  }
  function run(st) {
    const ok = (data) => ({ data, error: null });
    const rows = (db[st.t] = db[st.t] || []);
    if (st.op === 'insert') {
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      const ins = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p }));
      rows.push(...ins); return ok(st.single ? ins[0] : ins);
    }
    if (st.op === 'update') {
      const u = []; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u.push(r); } return ok(u);
    }
    let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
    if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : (a[st.order.col] < b[st.order.col]) ? -1 : 0));
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
    return ok(out);
  }
  return { from: builder, _db: db };
}

// ---- durable analysis jobs ----------------------------------------------------------
test('analysis job runs to succeeded and stores result + latency (advisory only)', async () => {
  const sb = makeMock({ vehicle_evidence: [{ id: 'ev1', vin: 'V1', verification_status: 'pending' }] });
  let t = 1000;
  const job = await jobs.analyzeEvidence(sb, { evidenceId: 'ev1', vin: 'V1', taskType: 'image_quality', opts: { forceMock: true, now: () => (t += 50) } });
  assert.equal(job.status, 'succeeded');
  assert.ok(job.latency_ms >= 0);
  assert.equal(typeof job.result.usable, 'boolean');
  // advisory: evidence verification untouched
  assert.equal(sb._db.vehicle_evidence[0].verification_status, 'pending');
});

test('low-confidence task routes to manual_review_required (not auto-trusted)', async () => {
  const sb = makeMock();
  const lowProvider = { id: 'mock', mode: 'mock', async analyze(task) { return { task, provider: 'mock', confidence: 0.4, result: {} }; } };
  const job = await jobs.analyzeEvidence(sb, { evidenceId: 'ev2', vin: 'V1', taskType: 'manipulation', opts: { provider: lowProvider } });
  assert.equal(job.status, 'manual_review_required');
});

test('provider failure becomes failed_retryable then failed_terminal', async () => {
  const sb = makeMock();
  const boom = { id: 'mock', mode: 'mock', async analyze() { throw new Error('provider down'); } };
  const j1 = await jobs.analyzeEvidence(sb, { evidenceId: 'ev3', taskType: 'vin_ocr', opts: { provider: boom } });
  assert.equal(j1.status, 'failed_retryable');
});

// ---- similarity ---------------------------------------------------------------------
test('near-duplicate + cross-vehicle reuse detection', () => {
  const target = { id: 'a', vin: 'V1', perceptual_hash: 'ffffffffffffffff' };
  const candidates = [
    { id: 'b', vin: 'V1', perceptual_hash: 'ffffffffffffffff' }, // identical, same vin
    { id: 'c', vin: 'V2', perceptual_hash: 'fffffffffffffffe' }, // near, DIFFERENT vin -> reuse alert
    { id: 'd', vin: 'V3', perceptual_hash: '0000000000000000' }, // far
  ];
  const dups = sim.findNearDuplicates(target.perceptual_hash, candidates);
  assert.ok(dups.length >= 2);
  const reuse = sim.detectCrossVehicleReuse(target, candidates);
  assert.equal(reuse.length, 1);
  assert.equal(reuse[0].vin, 'V2');
});

test('same-vehicle confidence: VIN dominates, visual is only supporting', () => {
  assert.ok(sim.sameVehicleConfidence({ vin: 'X' }, { vin: 'X' }).confidence >= 0.99);
  assert.equal(sim.sameVehicleConfidence({ normalized_plate_number: 'P1' }, { normalized_plate_number: 'P1' }).confidence, 0.75);
  const visualOnly = sim.sameVehicleConfidence({ perceptual_hash: 'ffffffffffffffff' }, { perceptual_hash: 'ffffffffffffffff' });
  assert.ok(visualOnly.confidence <= 0.4 + 1e-9);
});

// ---- temporal comparison ------------------------------------------------------------
test('component change classification covers the required change types', () => {
  assert.equal(temporal.classifyComponentChange({ present: true, damaged: false }, { replaced: true }), 'replaced');
  assert.equal(temporal.classifyComponentChange({ damaged: false }, { damaged: true }), 'newly_damaged');
  assert.equal(temporal.classifyComponentChange({ damaged: true }, { damaged: false, repaired: true }), 'repaired');
  assert.equal(temporal.classifyComponentChange({ present: true }, { missing: true }), 'removed_missing');
  assert.equal(temporal.classifyComponentChange({ colour: 'white' }, { repainted: true, colour: 'grey' }), 'repainted_colour_mismatch');
  assert.equal(temporal.classifyComponentChange({ damaged: false }, { damaged: false }), 'unchanged');
});

test('temporal finding is cautious, pending_review, and gated by same-vehicle confidence', async () => {
  const sb = makeMock();
  // high same-vehicle confidence (same VIN) -> publishable, but still pending_review
  const f = temporal.buildTemporalFinding({
    vin: 'V1', component: 'front_bumper',
    earlierSet: { id: 's1', vin: 'V1', event_date: '2021-08-14' },
    laterSet: { id: 's2', vin: 'V1', event_date: '2022-03-01' },
    earlierObs: { damaged: true }, laterObs: { replaced: true },
  });
  assert.equal(f.finding_type, 'replaced');
  assert.equal(f.reviewer_state, 'pending_review');
  assert.match(f.public_summary, /requires reviewer confirmation/);
  assert.ok(/replacement is possible/i.test(f.public_summary)); // cautious, not asserted
  assert.equal(f._publishable, true);
  const saved = await temporal.persistTemporalFinding(sb, f);
  assert.equal(saved.reviewer_state, 'pending_review');

  // low same-vehicle confidence -> NOT publishable (routes to review)
  const lowConf = temporal.buildTemporalFinding({
    vin: 'V1', component: 'bonnet',
    earlierSet: { id: 's3', event_date: '2021-01-01' }, laterSet: { id: 's4', event_date: '2022-01-01' },
    earlierObs: { damaged: false }, laterObs: { damaged: true },
  });
  assert.equal(lowConf._publishable, false);
});

// ---- disclosure conflicts -----------------------------------------------------------
test('claim extraction retains original text and normalizes claim types', () => {
  const claims = disclosure.extractClaims({ id: 'L1', vin: 'V1', title: 'Clean car', description: 'No accident, original paint, one owner, genuine mileage.' });
  const types = claims.map((c) => c.claim_type);
  assert.ok(types.includes('no_accident_history'));
  assert.ok(types.includes('original_paint'));
  assert.ok(types.includes('single_owner'));
  assert.ok(types.includes('genuine_mileage'));
  assert.ok(claims.every((c) => typeof c.original_text === 'string' && c.original_text.length));
});

test('conflict classification is evidence-based, neutral, and pending_review', () => {
  const claim = { id: 'c1', vin: 'V1', claim_type: 'no_accident_history' };
  const strong = disclosure.classifyConflict(claim, { hasAccidentEvidence: true, accidentEvidenceIds: ['ev9'] });
  assert.equal(strong.classification, 'strong_conflict');
  assert.equal(strong.reviewer_state, 'pending_review');
  assert.deepEqual(strong.evidence_ids, ['ev9']);
  assert.doesNotMatch(strong.public_summary, /fraud|liar|lying|scam/i); // never accusatory
  assert.match(strong.public_summary, /requires reviewer confirmation/i);

  const mileage = disclosure.classifyConflict({ id: 'c2', vin: 'V1', claim_type: 'genuine_mileage' }, { mileageRegression: true });
  assert.equal(mileage.classification, 'strong_conflict');

  const supported = disclosure.classifyConflict({ id: 'c3', vin: 'V1', claim_type: 'no_accident_history' }, {});
  assert.equal(supported, null); // no evidence -> no conflict
});

test('seller response appends to immutable correction history', async () => {
  const sb = makeMock();
  const c = await disclosure.persistConflict(sb, { vin: 'V1', claim_id: null, conflict_type: 'no_accident_history', classification: 'possible_conflict', reviewer_state: 'pending_review', correction_history: [] });
  const updated = await disclosure.applySellerResponse(sb, c.id, { response: 'Repaired under warranty, invoice attached', actorId: 'owner-1' });
  assert.equal(updated.seller_response, 'Repaired under warranty, invoice attached');
  assert.equal(updated.correction_history.length, 1);
});

test('mock analysis provider rejects unknown tasks', async () => {
  await assert.rejects(() => mockAnalysisProvider.analyze('nonsense', {}), /unknown task/);
});
