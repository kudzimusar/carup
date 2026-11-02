/**
 * OC-5R-REL-01 — an odometer photo is PRIVATE BY TYPE, decided by the server.
 *
 * The native client asks for `visibility_level: 'private'`, but before this block the server only
 * honoured that request: an odometer photo uploaded with 'public_safe' — or with no visibility at
 * all — was stored in the public `vehicle-images` bucket, and only the OCR step refused it later.
 * The route-level proofs live in oc4c-native-odometer-ocr.test.js (upload, remote locators,
 * reclassification, the OCR-time gate). This file pins the shared rule they all use:
 *   1. which evidence is private by type (canonical odometer pairs + the legacy odometer_photo);
 *   2. the visibility resolver: private by default, never public — not even for a reviewer;
 *   3. the provider ingestion path skips such assets instead of recording them under the public bucket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const { isPrivateByTypeRow, PRIVATE_BY_TYPE_CANONICAL } = await import('../services/evidence/evidenceTaxonomy.js');
const { resolveEvidenceVisibility, isPrivateByTypeUpload, PRIVATE_EVIDENCE_BUCKET, evidenceStorageBucket } = await import('../services/evidence/evidenceService.js');
const engine = await import('../services/ingestion/ingestionService.js');
const { sandboxJpAuctionAdapter } = await import('../services/ingestion/adapters/sandboxJpAuctionAdapter.js');

// ── 1. The rule ───────────────────────────────────────────────────────────────────────────────
test('REL-01: the canonical odometer pairs and the legacy odometer_photo are private by type', () => {
  assert.deepEqual([...PRIVATE_BY_TYPE_CANONICAL].sort(), ['current_condition:odometer', 'inspection:odometer_reading']);
  assert.equal(isPrivateByTypeRow({ evidence_class: 'current_condition', evidence_subtype: 'odometer' }), true);
  assert.equal(isPrivateByTypeRow({ evidence_class: 'inspection', evidence_subtype: 'odometer_reading' }), true);
  assert.equal(isPrivateByTypeRow({ evidence_type: 'odometer_photo' }), true, 'legacy-only row');
  assert.equal(isPrivateByTypeUpload({ evidenceClass: 'current_condition', evidenceSubtype: 'odometer', evidenceType: 'odometer_photo' }), true);
  assert.equal(PRIVATE_EVIDENCE_BUCKET, 'ocr-documents');
});

test('REL-01: other photos are not private by type (anti-vacuity)', () => {
  for (const row of [
    { evidence_class: 'current_condition', evidence_subtype: 'dashboard', evidence_type: 'vehicle_life_photo' },
    { evidence_class: 'current_condition', evidence_subtype: 'interior', evidence_type: 'vehicle_life_photo' },
    { evidence_class: 'auction', evidence_subtype: 'auction_image', evidence_type: 'auction_photo' },
    { evidence_type: 'damage_photo' },
  ]) assert.equal(isPrivateByTypeRow(row), false, JSON.stringify(row));
});

// ── 2. The resolver ───────────────────────────────────────────────────────────────────────────
test('REL-01: private by type defaults to private, and a public request is clamped and reported', () => {
  assert.deepEqual(resolveEvidenceVisibility({ privateByType: true }), { visibility: 'private', refused: false, requested: null });
  assert.deepEqual(resolveEvidenceVisibility({ requested: 'public_safe', privateByType: true }), { visibility: 'private', refused: true, requested: 'public_safe' });
});

test('REL-01: not even the review capability widens a private-by-type upload', () => {
  const out = resolveEvidenceVisibility({ requested: 'public_safe', mayPublish: true, privateByType: true });
  assert.equal(out.visibility, 'private');
  assert.equal(out.refused, true);
  // Anti-vacuity: the same capability DOES widen an ordinary document.
  assert.equal(resolveEvidenceVisibility({ requested: 'public_safe', isDocument: true, mayPublish: true }).visibility, 'public_safe');
});

test('REL-01: a narrower non-public level is still honoured for a private-by-type upload', () => {
  assert.equal(resolveEvidenceVisibility({ requested: 'government_only', privateByType: true }).visibility, 'government_only');
  assert.equal(resolveEvidenceVisibility({ requested: 'restricted', privateByType: true }).visibility, 'restricted');
  assert.equal(resolveEvidenceVisibility({ requested: 'bogus', privateByType: true }).visibility, 'private');
});

test('REL-01: ordinary photos keep their public default (the rule is scoped to the type)', () => {
  assert.equal(resolveEvidenceVisibility({ requested: 'public_safe', isDocument: false, mayPublish: false }).visibility, 'public_safe');
  assert.equal(resolveEvidenceVisibility({}).visibility, 'public_safe');
});

// ── 2b. The bucket ────────────────────────────────────────────────────────────────────────────
test('REL-01: the bucket is private by TYPE — even if a visibility decision ever said public', () => {
  assert.equal(evidenceStorageBucket({ privateByType: true, visibility: 'public_safe' }), 'ocr-documents');
  assert.equal(evidenceStorageBucket({ privateByType: true }), 'ocr-documents');
  assert.equal(evidenceStorageBucket({ isDocument: true, visibility: 'public_safe' }), 'ocr-documents');
  for (const visibility of ['private', 'restricted', 'government_only']) assert.equal(evidenceStorageBucket({ visibility }), 'ocr-documents', visibility);
  // Anti-vacuity: an ordinary public photo still goes to the public bucket.
  assert.equal(evidenceStorageBucket({ visibility: 'public_safe' }), 'vehicle-images');
  assert.equal(evidenceStorageBucket({}), 'vehicle-images');
});

// ── 3. Provider ingestion ─────────────────────────────────────────────────────────────────────
function makeMock(seed = {}) {
  const db = { vehicles: [], ingestion_jobs: [], source_records: [], vehicle_identity_candidates: [], listing_snapshots: [], vehicle_evidence: [], evidence_provenance_events: [], ...seed };
  function builder(t) {
    const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
    const chain = {
      select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; }, update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; }, neq() { return chain; }, in() { return chain; }, is() { return chain; },
      order(col, opts) { st.order = { col, asc: opts?.ascending ?? false }; return chain; }, limit(n) { st.lim = n; return chain; },
      single() { st.single = true; return chain; },
      then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return chain;
  }
  function run(st) {
    const ok = (data) => ({ data, error: null });
    const rows = (db[st.t] = db[st.t] || []);
    if (st.op === 'insert') {
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      const inserted = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p }));
      rows.push(...inserted);
      return ok(st.single ? inserted[0] : inserted);
    }
    if (st.op === 'update') {
      const updated = [];
      for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); updated.push(r); }
      return ok(updated);
    }
    let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
    return ok(out);
  }
  return { from: builder, _db: db };
}

test('REL-01: provider ingestion never records an odometer photo under the public bucket — it is skipped', async () => {
  const sb = makeMock({ vehicles: [
    { vin: 'JTDBR32E120111111', chassis_number: 'JTDBR32E120111111', normalized_plate_number: null },
    { vin: 'JTDBR32E120222222', chassis_number: 'JTDBR32E120222222', normalized_plate_number: null },
  ] });
  const lookups = {
    findByVin: async (v) => sb._db.vehicles.find((x) => x.vin === v) || null,
    findByChassis: async (v) => sb._db.vehicles.find((x) => x.chassis_number === v) || null,
    findByPlate: async () => null,
  };
  const withOdometer = {
    ...sandboxJpAuctionAdapter,
    id: 'rel01_odometer_probe',
    mapRecord(raw) {
      const n = sandboxJpAuctionAdapter.mapRecord(raw);
      return { ...n, assets: [...(n.assets || []), { ref: 'https://partner.invalid/odo.jpg', mime_type: 'image/jpeg', evidence_class: 'current_condition', evidence_subtype: 'odometer', legacy_evidence_type: 'odometer_photo' }] };
    },
  };
  await engine.runIngestionJob(sb, { provider: withOdometer, sourceId: 'src-jp', requestedBy: 'admin-1', lookups });
  const imported = sb._db.vehicle_evidence;
  assert.ok(imported.length > 0, 'anti-vacuity: the ordinary auction images were imported');
  assert.equal(imported.some((e) => e.evidence_subtype === 'odometer' || e.evidence_type === 'odometer_photo'), false, 'no odometer row was recorded');
  assert.ok(imported.every((e) => e.evidence_class === 'auction'));
});
