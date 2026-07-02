/**
 * Consolidated golden journey (integration goal A–P) — drives every M1–M6 service in one
 * end-to-end flow against a single shared in-memory Postgres-shaped mock. Proves the program
 * invariants hold across milestone boundaries: AI is advisory, findings are governed before
 * public, disclosure language is neutral, supersession is auditable, report versions are
 * immutable, and public output leaks nothing private.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.ALLOW_OCR_MOCK = 'true';

const { sandboxJpAuctionAdapter } = await import('../services/ingestion/adapters/sandboxJpAuctionAdapter.js');
const ingestion = await import('../services/ingestion/ingestionService.js');
const provenance = await import('../services/evidence/provenanceService.js');
const jobs = await import('../services/ai/analysisJobService.js');
const temporal = await import('../services/intelligence/temporalComparison.js');
const listingSvc = await import('../services/ingestion/listingSnapshotService.js');
const disclosure = await import('../services/intelligence/disclosureConflict.js');
const governance = await import('../services/governance/governanceService.js');
const disputes = await import('../services/governance/disputeService.js');
const report = await import('../services/report/reportService.js');

// ---- shared table-aware mock --------------------------------------------------------
function makeMock(seed = {}) {
  const db = {
    users: [], vehicles: [], vehicle_evidence: [], evidence_sources: [], evidence_sets: [],
    evidence_provenance_events: [], ingestion_jobs: [], source_records: [], vehicle_identity_candidates: [],
    listing_snapshots: [], ai_analysis_jobs: [], ai_observations: [], temporal_findings: [],
    disclosure_claims: [], disclosure_conflicts: [], review_tasks: [], review_decisions: [],
    disputes: [], dispute_events: [], trust_change_log: [], trust_audit_events: [], organization_audit_logs: [], ...seed,
  };
  function builder(t) {
    const st = { t, op: 'select', filters: {}, neq: {}, order: null, lim: null, single: false, payload: null };
    const chain = {
      select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; }, neq(k, v) { st.neq[k] = v; return chain; },
      in() { return chain; }, is() { return chain; },
      order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
      limit(n) { st.lim = n; return chain; }, single() { st.single = true; return chain; },
      then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return chain;
  }
  function run(st) {
    const ok = (data) => ({ data, error: null }); const rows = (db[st.t] = db[st.t] || []);
    if (st.op === 'insert') {
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      const ins = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p }));
      rows.push(...ins); return ok(st.single ? ins[0] : ins);
    }
    if (st.op === 'update') {
      const u = []; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u.push(r); } return ok(u);
    }
    let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
    for (const [k, v] of Object.entries(st.neq)) out = out.filter((r) => r[k] !== v);
    if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : (a[st.order.col] < b[st.order.col]) ? -1 : 0));
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
    return ok(out);
  }
  return { from: builder, _db: db };
}

const VIN = 'JTDBR32E120111111'; // matches the sandbox auction fixture

test('golden journey A–P: import → analyze → find → govern → report → dispute → correct → privacy', async () => {
  const sb = makeMock({
    users: [{ id: 'owner-1', role: 'owner' }, { id: 'admin-1', role: 'admin' }],
    vehicles: [{ vin: VIN, chassis_number: VIN, make: 'Toyota', model: 'Premio', year: 2021 }],
    evidence_sources: [{ id: 'src-jp', code: 'jp_auction_sandbox', active: true, permitted_evidence_classes: ['auction', 'import'] }],
  });
  const lookups = {
    findByVin: async (v) => sb._db.vehicles.find((x) => x.vin === v) || null,
    findByChassis: async (v) => sb._db.vehicles.find((x) => x.chassis_number === v) || null,
    findByPlate: async () => null,
  };

  // A + B: vehicle exists; import sandbox auction evidence
  const job = await ingestion.runIngestionJob(sb, { provider: sandboxJpAuctionAdapter, sourceId: 'src-jp', lookups });
  assert.ok(['succeeded', 'partial'].includes(job.status));
  const auctionEvidence = sb._db.vehicle_evidence.filter((e) => e.vin === VIN && e.evidence_class === 'auction');
  assert.ok(auctionEvidence.length >= 1, 'A/B: auction evidence imported');

  // C: inspection + current-condition evidence (verified, public-safe so it reaches the buyer)
  const inspIns = await sb.from('vehicle_evidence').insert({
    vehicle_id: VIN, vin: VIN, evidence_type: 'inspection_photo', evidence_class: 'inspection', evidence_subtype: 'odometer_reading',
    verification_status: 'verified', visibility_level: 'public_safe', event_date: '2022-03-01', odometer_value: 48000, odometer_unit: 'km', source_id: 'src-jp', checksum: 'c-insp',
  }).select();
  const inspectionEv = inspIns.data[0];
  await sb.from('vehicle_evidence').insert({ vehicle_id: VIN, vin: VIN, evidence_type: 'dealer_listing_photo', evidence_class: 'current_condition', verification_status: 'verified', visibility_level: 'public_safe', event_date: '2022-04-01' }).select();

  // D: provenance / chain-of-custody for the inspection evidence
  await provenance.recordProvenanceEvent(sb, { evidenceId: inspectionEv.id, vin: VIN, eventType: 'created', actorUserId: 'owner-1', actorRole: 'owner', ipAddress: '10.0.0.9' });
  await provenance.recordProvenanceEvent(sb, { evidenceId: inspectionEv.id, vin: VIN, eventType: 'uploaded', actorUserId: 'owner-1', actorRole: 'owner', ipAddress: '10.0.0.9' });
  const chain = await provenance.verifyProvenanceChain(sb, inspectionEv.id);
  assert.equal(chain.valid, true, 'D: provenance chain valid');

  // E: mock analysis job — advisory only (does not change verification)
  const before = sb._db.vehicle_evidence.find((e) => e.id === inspectionEv.id).verification_status;
  const aiJob = await jobs.analyzeEvidence(sb, { evidenceId: inspectionEv.id, vin: VIN, taskType: 'image_quality', opts: { forceMock: true } });
  assert.ok(['succeeded', 'manual_review_required'].includes(aiJob.status));
  assert.equal(sb._db.vehicle_evidence.find((e) => e.id === inspectionEv.id).verification_status, before, 'E: AI did not change verification (advisory)');

  // F: same-vehicle + temporal finding (auction 2021 vs inspection 2022, front bumper replaced)
  const set1 = (await sb.from('evidence_sets').insert({ vin: VIN, evidence_class: 'auction', event_date: '2021-08-14' }).select()).data[0];
  const set2 = (await sb.from('evidence_sets').insert({ vin: VIN, evidence_class: 'inspection', event_date: '2022-03-01' }).select()).data[0];
  const finding = temporal.buildTemporalFinding({
    vin: VIN, component: 'front_bumper',
    earlierSet: { id: set1.id, vin: VIN, event_date: '2021-08-14' }, laterSet: { id: set2.id, vin: VIN, event_date: '2022-03-01' },
    earlierObs: { damaged: true }, laterObs: { replaced: true },
  });
  assert.equal(finding._publishable, true, 'F: same-vehicle confidence high -> publishable');
  const tf = await temporal.persistTemporalFinding(sb, finding);
  assert.equal(tf.reviewer_state, 'pending_review', 'F: finding defaults to pending_review');

  // G: listing snapshot + claim extraction
  const snap = (await listingSvc.createListingSnapshot(sb, { sourceId: 'src-jp', sourceRecordId: 'LISTING-1', vin: VIN, listing: { title: 'Clean Premio', description: 'No accident, genuine mileage, one owner', price: 12000, currency: 'USD', advertised_mileage: 49000 } })).snapshot;
  const claims = await disclosure.persistClaims(sb, disclosure.extractClaims({ ...snap, vin: VIN }));
  assert.ok(claims.some((c) => c.claim_type === 'no_accident_history'), 'G: extracted no_accident claim with original text');

  // H: disclosure conflict (claim vs accident evidence) — neutral, pending_review
  const accidentEv = (await sb.from('vehicle_evidence').insert({ vehicle_id: VIN, vin: VIN, evidence_type: 'damage_photo', evidence_class: 'accident', verification_status: 'verified', visibility_level: 'restricted' }).select()).data[0];
  const claim = claims.find((c) => c.claim_type === 'no_accident_history');
  const conflictObj = disclosure.classifyConflict(claim, { hasAccidentEvidence: true, accidentEvidenceIds: [accidentEv.id] });
  const conflict = await disclosure.persistConflict(sb, conflictObj);
  assert.equal(conflict.classification, 'strong_conflict');
  assert.equal(conflict.reviewer_state, 'pending_review', 'H: conflict pending review');
  assert.doesNotMatch(conflict.public_summary, /fraud|liar|scam/i, 'H: neutral language');

  // I: confirm both findings through governance
  const admin = { id: 'admin-1', role: 'admin' };
  const trustBefore = sb._db.trust_change_log.length;
  await governance.applyDecision(sb, { targetType: 'temporal_findings', targetId: tf.id, vin: VIN, decision: 'confirm', reviewer: admin, notes: 'reviewed images' });
  await governance.applyDecision(sb, { targetType: 'disclosure_conflicts', targetId: conflict.id, vin: VIN, decision: 'confirm', reviewer: admin, notes: 'confirmed conflict' });
  assert.equal(sb._db.temporal_findings.find((f) => f.id === tf.id).reviewer_state, 'confirmed', 'I: finding confirmed');
  assert.ok(sb._db.review_decisions.length >= 2, 'I: decisions audited (append-only)');
  assert.ok(sb._db.trust_audit_events.length >= 2, 'I: trust_audit_events written');
  assert.equal(sb._db.trust_change_log.length, trustBefore, 'I: applyDecision alone never changes trust score');

  // J + K: buyer report shows the confirmed finding with safe language
  const v1 = await report.generateReportVersion(sb, VIN, { actorId: 'admin-1', audience: 'public' });
  assert.equal(v1.version, 1);
  const pubReport = v1.payload;
  assert.ok(pubReport.visual_comparisons.some((c) => /requires reviewer confirmation/i.test(c.public_summary || '')), 'K: temporal finding shown with cautious language');
  assert.ok(pubReport.limitations.length > 0 && pubReport.limitations.some((l) => /NOT proof of a clean history/i.test(l)), 'K: missing data never shown as clean');

  // L: seller dispute
  const dispute = await disputes.submitDispute(sb, { id: 'owner-1', role: 'owner' }, { vin: VIN, subjectType: 'temporal_finding', subjectId: tf.id, reason: 'bumper was only refinished, not replaced' });
  assert.equal(dispute.status, 'open');

  // M: resolve dispute upheld -> supersede the finding through the governed path
  await disputes.resolveDispute(sb, admin, dispute.id, { resolution: 'Refinish confirmed; replacement claim withdrawn', outcome: 'upheld', targetType: 'temporal_findings', targetId: tf.id });
  assert.equal(sb._db.temporal_findings.find((f) => f.id === tf.id).reviewer_state, 'superseded', 'M: finding superseded via governance');
  assert.ok(sb._db.dispute_events.length >= 1, 'M: dispute events recorded (auditable)');

  // N: new report version after correction
  const v2 = await report.generateReportVersion(sb, VIN, { actorId: 'admin-1', audience: 'public' });
  assert.equal(v2.version, 2);
  assert.equal(v2.payload.visual_comparisons.some((c) => c.reviewer_state === 'confirmed'), false, 'N: superseded finding no longer confirmed-public in v2');

  // O: old version immutable — v1 snapshot still shows the finding as captured
  const shareV1 = await report.createShareLink(sb, v1.id, { ttlSeconds: 3600 });
  const shared = await report.getReportByShareToken(sb, shareV1.share_token);
  assert.equal(shared.ok, true);
  assert.equal(shared.version, 1);
  assert.ok(shared.report.visual_comparisons.length >= 1, 'O: v1 shared report retains its original finding (immutable snapshot)');

  // P: public privacy — no private/internal data leaks
  const pub = await report.assembleReport(sb, VIN, { audience: 'public' });
  const blob = JSON.stringify(pub);
  assert.equal(/internal_explanation/.test(blob), false, 'P: no internal explanations');
  assert.equal(/10\.0\.0\.9/.test(blob), false, 'P: no IP addresses');
  assert.equal(/service[_-]?role|SUPABASE_SERVICE_ROLE/i.test(blob), false, 'P: no service secrets');
  // restricted/pending accident evidence must not appear in the public evidence index
  assert.equal(pub.evidence_index.some((e) => e.evidence_id === accidentEv.id), false, 'P: restricted accident evidence excluded from public report');
  // public provenance summary excludes IP + raw actor id
  const provEvents = await provenance.listProvenanceEvents(sb, inspectionEv.id);
  const pubProv = provenance.toPublicProvenanceSummary(provEvents);
  assert.equal(pubProv.some((e) => 'ip_address' in e || 'actor_user_id' in e), false, 'P: provenance public summary omits IP + actor id');
});
