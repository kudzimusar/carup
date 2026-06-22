/**
 * Milestone 2 tests — external source ingestion framework (master plan §6.7).
 *
 *   - end-to-end sandbox import into the taxonomy + provenance model
 *   - idempotent re-import (no duplicate evidence)
 *   - invalid records quarantine without failing the batch
 *   - ambiguous identity routes to the human resolution queue (never auto-attached)
 *   - imported evidence carries full provenance ('imported' chain-of-custody event)
 *   - listing snapshots are immutable + versioned
 *   - identity-candidate resolution maps the record on confirm
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const engine = await import('../services/ingestion/ingestionService.js');
const { resolveIdentity, AUTO_LINK_THRESHOLD } = await import('../services/ingestion/identityResolution.js');
const listingSvc = await import('../services/ingestion/listingSnapshotService.js');
const { sandboxJpAuctionAdapter } = await import('../services/ingestion/adapters/sandboxJpAuctionAdapter.js');
const provenance = await import('../services/evidence/provenanceService.js');

// ---- generic table-aware in-memory mock ---------------------------------------------
function makeMock(seed = {}) {
  const db = { vehicles: [], ingestion_jobs: [], source_records: [], vehicle_identity_candidates: [], listing_snapshots: [], vehicle_evidence: [], evidence_provenance_events: [], ...seed };
  function builder(t) {
    const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
    const chain = {
      select() { return chain; },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; },
      neq() { return chain; }, in() { return chain; }, is() { return chain; },
      order(col, opts) { st.order = { col, asc: opts?.ascending ?? false }; return chain; },
      limit(n) { st.lim = n; return chain; },
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
    if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : (a[st.order.col] < b[st.order.col]) ? -1 : 0));
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
    return ok(out);
  }
  return { from: builder, _db: db };
}

function seededVehicles() {
  return [
    { vin: 'JTDBR32E120111111', chassis_number: 'JTDBR32E120111111', normalized_plate_number: null },
    { vin: 'JTDBR32E120222222', chassis_number: 'JTDBR32E120222222', normalized_plate_number: null },
  ];
}
const lookups = (db) => ({
  findByVin: async (v) => db.vehicles.find((x) => x.vin === v) || null,
  findByChassis: async (v) => db.vehicles.find((x) => x.chassis_number === v) || null,
  findByPlate: async (v) => db.vehicles.find((x) => x.normalized_plate_number === v) || null,
});

// ---- identity resolution ------------------------------------------------------------
test('identity: exact VIN auto-links above threshold', async () => {
  const r = await resolveIdentity({ vin: 'ABC123' }, { findByVin: async () => ({ vin: 'ABC123' }) });
  assert.equal(r.requiresReview, false);
  assert.equal(r.vin, 'ABC123');
  assert.ok(r.confidence >= AUTO_LINK_THRESHOLD);
});

test('identity: make/model/year only requires review (never auto-attach)', async () => {
  const r = await resolveIdentity({ make: 'Mazda', model: 'Demio', year: 2020 }, {});
  assert.equal(r.requiresReview, true);
  assert.equal(r.vin, null);
});

test('identity: conflicting VINs force review', async () => {
  const r = await resolveIdentity(
    { vin: 'V1', chassis_number: 'C1' },
    { findByVin: async () => ({ vin: 'V1' }), findByChassis: async () => ({ vin: 'V2' }) },
  );
  assert.equal(r.requiresReview, true);
});

// ---- listing snapshots --------------------------------------------------------------
test('listing snapshots are versioned and idempotent on identical content', async () => {
  const sb = makeMock();
  const base = { sourceId: 's1', sourceRecordId: 'L1', vin: 'V', listing: { title: 'Car', price: 1000, currency: 'USD' } };
  const a = await listingSvc.createListingSnapshot(sb, base);
  assert.equal(a.created, true); assert.equal(a.snapshot.version, 1);
  const b = await listingSvc.createListingSnapshot(sb, base);
  assert.equal(b.created, false); // identical content -> no new version
  const c = await listingSvc.createListingSnapshot(sb, { ...base, listing: { ...base.listing, price: 900 } });
  assert.equal(c.created, true); assert.equal(c.snapshot.version, 2);
});

// ---- end-to-end sandbox ingestion ---------------------------------------------------
test('sandbox JP auction import: maps, quarantines, queues identity, imports with provenance', async () => {
  const sb = makeMock({ vehicles: seededVehicles() });
  const job = await engine.runIngestionJob(sb, {
    provider: sandboxJpAuctionAdapter, sourceId: 'src-jp', requestedBy: 'admin-1', lookups: lookups(sb._db),
  });

  assert.equal(job.stats.total, 4);
  assert.equal(job.stats.imported, 2);            // Premio + Fit
  assert.equal(job.stats.quarantined, 1);         // BADREC
  assert.equal(job.stats.needs_identity_review, 1); // AMBIG
  assert.equal(job.status, 'partial');            // had quarantine/review

  // 3 imported assets (Premio 2 images + Fit 1) -> 3 evidence rows, all with source + provenance
  const imported = sb._db.vehicle_evidence.filter((e) => e.source_id === 'src-jp');
  assert.equal(imported.length, 3);
  for (const ev of imported) {
    assert.equal(ev.evidence_class, 'auction');
    assert.ok(ev.checksum, 'has sha256 checksum');
    assert.equal(ev.verification_status, 'pending'); // imported evidence is unverified
    assert.equal(ev.visibility_level, 'restricted'); // not public by default
    const chain = await provenance.verifyProvenanceChain(sb, ev.id);
    assert.equal(chain.valid, true);
    assert.ok(chain.length >= 1, 'has an imported provenance event');
  }

  // ambiguous record produced a pending identity candidate
  const pending = sb._db.vehicle_identity_candidates.filter((c) => c.status === 'pending');
  assert.ok(pending.length >= 1);
});

test('re-import is idempotent: no duplicate evidence', async () => {
  const sb = makeMock({ vehicles: seededVehicles() });
  await engine.runIngestionJob(sb, { provider: sandboxJpAuctionAdapter, sourceId: 'src-jp', lookups: lookups(sb._db) });
  const afterFirst = sb._db.vehicle_evidence.length;
  const job2 = await engine.runIngestionJob(sb, { provider: sandboxJpAuctionAdapter, sourceId: 'src-jp', lookups: lookups(sb._db) });
  assert.equal(sb._db.vehicle_evidence.length, afterFirst, 'no new evidence on re-import');
  assert.equal(job2.stats.duplicate, 2);
});

test('resolveIdentityCandidate confirm maps the source record to the vehicle', async () => {
  const sb = makeMock({ vehicles: seededVehicles() });
  sb._db.source_records.push({ id: 'sr1', source_id: 'src-jp', source_record_id: 'AMBIG', status: 'needs_identity_review' });
  sb._db.vehicle_identity_candidates.push({ id: 'cand1', source_record_id: 'sr1', candidate_vin: 'JTDBR32E120111111', match_method: 'make_model_year', confidence: 0.3, status: 'pending' });
  const res = await engine.resolveIdentityCandidate(sb, 'cand1', { decision: 'confirmed', resolvedBy: 'admin-1' });
  assert.equal(res.status, 'confirmed');
  const sr = sb._db.source_records.find((r) => r.id === 'sr1');
  assert.equal(sr.status, 'mapped');
  assert.equal(sr.vehicle_vin, 'JTDBR32E120111111');
});
