/**
 * Milestone 4 tests — buyer vehicle history report assembly, completeness/limitations,
 * versioning, expiring share links, and public-safe boundaries (master plan §10.8).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const reportSvc = await import('../services/report/reportService.js');
const express = (await import('express')).default;
const router = (await import('../routes/reportRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

function makeMock(seed = {}, { failTables = [] } = {}) {
  const db = {
    vehicles: [], vehicle_evidence: [], listing_snapshots: [], temporal_findings: [],
    disclosure_conflicts: [], report_versions: [], users: [], vehicle_ownership_history: [],
    partsentry_logs: [], mechanic_work_orders: [], insurance_records: [], vid_inspections: [],
    ...seed,
  };
  function builder(t) {
    const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
    const chain = {
      select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; }, update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; }, neq() { return chain; }, in() { return chain; }, is() { return chain; },
      order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; }, limit(n) { st.lim = n; return chain; }, single() { st.single = true; return chain; },
      then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return chain;
  }
  function run(st) {
    if (failTables.includes(st.t)) return { data: null, error: { message: `${st.t} unavailable` } };
    const ok = (data) => ({ data, error: null }); const rows = (db[st.t] = db[st.t] || []);
    if (st.op === 'insert') { const list = Array.isArray(st.payload) ? st.payload : [st.payload]; const ins = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p })); rows.push(...ins); return ok(st.single ? ins[0] : ins); }
    if (st.op === 'update') { const u = []; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u.push(r); } return ok(u); }
    let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
    if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
    return ok(out);
  }
  return { from: builder, _db: db };
}

function seed() {
  return {
    users: [{ id: 'owner-1', role: 'owner', is_verified: true }],
    vehicles: [{ vin: 'V1', make: 'Toyota', model: 'Premio', year: 2021 }],
    vehicle_evidence: [
      { id: 'e1', vin: 'V1', evidence_class: 'auction', evidence_subtype: 'auction_image', verification_status: 'verified', visibility_level: 'public_safe', event_date: '2021-08-14', odometer_value: 62000, odometer_unit: 'km', source_id: 's-jp' },
      { id: 'e2', vin: 'V1', evidence_class: 'inspection', evidence_subtype: 'odometer_reading', verification_status: 'verified', visibility_level: 'public_safe', event_date: '2022-03-01', odometer_value: 48000, odometer_unit: 'km', source_id: 's-insp' },
      { id: 'e3', vin: 'V1', evidence_class: 'accident', verification_status: 'pending', visibility_level: 'restricted', event_date: '2021-09-01', source_id: 's-x' }, // must NOT appear publicly
    ],
    listing_snapshots: [{ id: 'l1', vin: 'V1', version: 1, captured_at: '2022-04-01', title: 'Clean Premio', price: 12000, currency: 'USD', advertised_mileage: 49000, mileage_unit: 'km' }],
    temporal_findings: [
      { id: 't1', vin: 'V1', finding_type: 'replaced', component: 'front_bumper', reviewer_state: 'confirmed', public_summary: 'Front bumper appears different; requires reviewer confirmation.', internal_explanation: 'SECRET', severity: 'high', supporting_asset_ids: ['e1'] },
      { id: 't2', vin: 'V1', finding_type: 'newly_damaged', component: 'bonnet', reviewer_state: 'pending_review', public_summary: 'pending', internal_explanation: 'SECRET', severity: 'high' },
    ],
    disclosure_conflicts: [],
  };
}

test('assembleReport (public) excludes pending/restricted data and detects mileage anomaly', async () => {
  const sb = makeMock(seed());
  const r = await reportSvc.assembleReport(sb, 'V1', { audience: 'public' });
  // pending accident evidence excluded
  assert.equal(r.evidence_index.find((e) => e.evidence_id === 'e3'), undefined);
  // only confirmed temporal finding surfaces; internal explanation never present
  assert.equal(r.visual_comparisons.length, 1);
  assert.equal('internal_explanation' in r.visual_comparisons[0], false);
  // mileage anomaly (62000 -> 48000 later) flagged as an alert
  assert.equal(r.mileage_history.anomaly, true);
  assert.ok(r.key_alerts.some((a) => a.category === 'mileage'));
  // completeness + limitations explicit; missing classes shown, not hidden
  assert.ok(r.completeness.classes_missing.length > 0);
  assert.ok(r.limitations.some((l) => /NOT proof of a clean history/i.test(l)));
});

test('canonical lifecycle prevents administrative documents becoming accidents and converges ownership/service/mileage', async () => {
  const seeded = seed();
  seeded.vehicles[0] = { ...seeded.vehicles[0], mileage: 78450, updated_at: '2026-08-24T12:00:00Z' };
  seeded.vehicle_evidence.push(
    { id: 'reg-doc', vin: 'V1', evidence_type: 'registration_document', evidence_class: null, verification_status: 'verified', visibility_level: 'public_safe', captured_at: '2026-08-20', source_id: 'registry-upload' },
    { id: 'insurance-doc', vin: 'V1', evidence_type: 'insurance_document', evidence_class: null, verification_status: 'verified', visibility_level: 'public_safe', captured_at: '2026-08-21', source_id: 'insurance-upload' },
    { id: 'police-doc', vin: 'V1', evidence_type: 'police_clearance_document', evidence_class: null, verification_status: 'verified', visibility_level: 'public_safe', captured_at: '2026-08-22', source_id: 'police-upload' },
    { id: 'inspection-doc', vin: 'V1', evidence_type: 'inspection_photo', evidence_class: null, verification_status: 'verified', visibility_level: 'public_safe', captured_at: '2026-08-23', source_id: 'inspection-upload' },
  );
  seeded.vehicle_ownership_history = [
    { id: 'own-1', vin: 'V1', transfer_date: '2026-08-18' },
  ];
  seeded.partsentry_logs = [
    {
      id: 'part-1', vin: 'V1', timestamp: '2026-08-24T09:00:00Z', action_type: 'Replaced',
      mileage: 78450, public_card_eligible: false, suspicion_status: null, verification_status: 'verified',
    },
  ];

  const sb = makeMock(seeded);
  const report = await reportSvc.assembleReport(sb, 'V1', { audience: 'public' });

  assert.equal(report.sections.accident_repair.accident, 0, 'insurance/police documents are not accident events');
  assert.ok(report.sections.accident_repair.repair >= 1, 'recorded replacement converges into repair history');
  assert.equal(report.sections.ownership_transfer, 1);
  assert.ok(report.timeline.some((item) => item.evidence_id === 'inspection-doc' && item.evidence_class === 'inspection'), 'verified public-safe inspection evidence remains visible');
  assert.ok(report.lifecycle_projection.count_states.inspection.value >= 1, 'known public-safe inspection count remains positive');
  assert.equal(report.lifecycle_projection.count_states.inspection.state, 'partial');
  assert.equal(report.sections.inspection, report.lifecycle_projection.count_states.inspection.value, 'published section count equals the known partial count');
  assert.equal(report.lifecycle_projection.source_states.vid_inspections, 'unavailable');
  assert.ok(report.mileage_history.observations.some((item) => item.value === 78450));
  assert.equal(report.evidence_index.find((item) => item.evidence_id === 'insurance-doc')?.lifecycle_category, 'insurance');
  assert.equal(report.evidence_index.find((item) => item.evidence_id === 'police-doc')?.lifecycle_category, 'clearance');
  assert.ok(report.lifecycle_projection?.version);
});

test('canonical lifecycle reports partial/unavailable coverage instead of converting collaborator failures to zero', async () => {
  const seeded = seed();
  seeded.vehicle_evidence.push(
    { id: 'repair-evidence', vin: 'V1', evidence_type: 'repair_photo', evidence_class: 'repair', verification_status: 'verified', visibility_level: 'public_safe', captured_at: '2026-08-20', source_id: 'garage-upload' },
  );

  const sb = makeMock(seeded, { failTables: ['partsentry_logs', 'vehicle_ownership_history'] });
  const report = await reportSvc.assembleReport(sb, 'V1', { audience: 'public' });

  assert.equal(report.lifecycle_projection.source_states.partsentry, 'unavailable');
  assert.equal(report.lifecycle_projection.source_states.ownership_ledger, 'unavailable');
  assert.deepEqual(report.lifecycle_projection.count_states.repair, { value: 1, state: 'partial' });
  assert.deepEqual(report.lifecycle_projection.count_states.ownership_transfer, { value: 0, state: 'partial' });

  // A positive public-safe count remains a known lower bound under partial coverage.
  // A partial zero stays withheld so an unread source can never become a false "zero records" claim.
  assert.equal(report.sections.accident_repair.repair, 1);
  assert.equal(report.sections.ownership_transfer, null);
  // Accident depends only on public evidence, which loaded successfully, so zero remains a real zero
  // for current coverage rather than being globally suppressed.
  assert.equal(report.sections.accident_repair.accident, 0);

  assert.ok(report.completeness.classes_unavailable.includes('repair'));
  assert.ok(report.completeness.classes_unavailable.includes('ownership_transfer'));
  assert.ok(report.limitations.some((item) => /does not convert an unread source into a zero count/i.test(item)));
});

test('assembleReport (admin) sees pending + restricted', async () => {
  const sb = makeMock(seed());
  const r = await reportSvc.assembleReport(sb, 'V1', { audience: 'admin' });
  assert.ok(r.evidence_index.find((e) => e.evidence_id === 'e3')); // privileged sees pending
  assert.equal(r.visual_comparisons.length, 2);
});

test('report versioning is immutable + share link expiry enforced', async () => {
  const sb = makeMock(seed());
  const v1 = await reportSvc.generateReportVersion(sb, 'V1', { actorId: 'owner-1' });
  assert.equal(v1.version, 1);
  assert.ok(v1.content_hash);
  const v2 = await reportSvc.generateReportVersion(sb, 'V1', { actorId: 'owner-1' });
  assert.equal(v2.version, 2);
  assert.equal(v2.supersedes_version, 1);

  const link = await reportSvc.createShareLink(sb, v1.id, { ttlSeconds: 3600 });
  assert.ok(link.share_token);

  const ok = await reportSvc.getReportByShareToken(sb, link.share_token);
  assert.equal(ok.ok, true);
  assert.equal(ok.report.vin, 'V1');

  // expired
  const expired = await reportSvc.getReportByShareToken(sb, link.share_token, { now: Date.now() + 2 * 3600 * 1000 });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired');

  // revoked
  await reportSvc.revokeShare(sb, v1.id, { correctionNotice: 'data corrected' });
  const revoked = await reportSvc.getReportByShareToken(sb, link.share_token);
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, 'revoked');
});

let server; let baseUrl;
before(async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeMock(seed()).from(t) });
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('GET /api/vehicles/:vin/report serves a public report; shared-token 410 when missing', async () => {
  // dedicated server with a stable mock db so the share flow persists across requests
  const sb = makeMock(seed());
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => sb.from(t) });
  const app = express(); app.use(express.json()); app.use(router); app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/vehicles/V1/report`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.vin, 'V1');
  assert.ok(Array.isArray(body.limitations) && body.limitations.length);

  const gone = await fetch(`${baseUrl}/api/reports/shared/does-not-exist`);
  assert.equal(gone.status, 404);
});
