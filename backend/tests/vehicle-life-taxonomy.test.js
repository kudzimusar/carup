/**
 * Milestone 1 unit/integration tests — Vehicle Life Evidence Taxonomy + Provenance.
 *
 * Covers master plan acceptance tests for §4.7 (taxonomy) and §5.6 (provenance):
 *   - all life-stage classes; invalid class/subtype combos fail safely
 *   - legacy evidence_type values still map to a class (backward compatibility)
 *   - perceptual-hash abstraction: real hash for PNG, honest "unsupported" otherwise
 *   - immutable hash-chained provenance: builds, verifies, and detects tampering
 *   - source registry public serialization strips restricted credentials
 *   - evidence sets create/list/attach
 *
 * Uses a generic in-memory Supabase mock (same approach as evidence-ai-fraud.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const taxonomy = await import('../services/evidence/evidenceTaxonomy.js');
const phash = await import('../services/evidence/perceptualHash.js');
const provenance = await import('../services/evidence/provenanceService.js');
const sources = await import('../services/evidence/sourceRegistryService.js');
const sets = await import('../services/evidence/evidenceSetService.js');
const { PNG } = await import('pngjs');

// ---- Generic in-memory Supabase mock --------------------------------------------------
function makeMock() {
  const db = {};
  const table = (t) => (db[t] = db[t] || []);
  function builder(t) {
    const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
    const chain = {
      select() { return chain; },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; },
      neq() { return chain; },
      in() { return chain; },
      is() { return chain; },
      order(col, opts) { st.order = { col, asc: opts?.ascending ?? false }; return chain; },
      limit(n) { st.lim = n; return chain; },
      single() { st.single = true; return chain; },
      then(res, rej) {
        try { return Promise.resolve(run(st)).then(res, rej); }
        catch (e) { return rej ? rej(e) : Promise.reject(e); }
      },
    };
    return chain;
  }
  function run(st) {
    const ok = (data) => ({ data, error: null });
    const rows = table(st.t);
    if (st.op === 'insert') {
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      const inserted = list.map((p) => ({ id: p.id || `row-${rows.length + 1}`, created_at: new Date().toISOString(), ...p }));
      rows.push(...inserted);
      return ok(st.single ? inserted[0] : inserted);
    }
    if (st.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) {
          Object.assign(r, st.payload);
          updated.push(r);
        }
      }
      return ok(updated);
    }
    // select
    let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
    if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : (a[st.order.col] < b[st.order.col]) ? -1 : 0));
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
    return ok(out);
  }
  return { from: builder, _db: db };
}

function makePng(seed) {
  const p = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const idx = (y * 16 + x) * 4;
      // gradient that depends on seed so different seeds -> different images
      p.data[idx] = (x * 16 + seed * 7) % 256;
      p.data[idx + 1] = (y * 16 + seed * 13) % 256;
      p.data[idx + 2] = ((x + y) * 8 + seed * 31) % 256;
      p.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(p);
}

// ---- Taxonomy -------------------------------------------------------------------------
test('taxonomy exposes registration separately from transfer/accident', () => {
  const t = taxonomy.getTaxonomy();
  assert.equal(t.classes.length, 9);
  const names = t.classes.map((c) => c.evidence_class).sort();
  assert.deepEqual(names, ['accident', 'auction', 'current_condition', 'dealer_listing', 'import', 'inspection', 'ownership_transfer', 'registration', 'repair'].sort());
  for (const c of t.classes) assert.ok(c.subtypes.length > 0, `${c.evidence_class} has subtypes`);
});

test('every legacy evidence_type maps to a valid class (backward compatibility)', () => {
  for (const legacy of taxonomy.LEGACY_EVIDENCE_TYPES) {
    const cls = taxonomy.classForLegacyType(legacy);
    assert.ok(taxonomy.isValidClass(cls), `${legacy} -> ${cls}`);
  }
  assert.equal(taxonomy.LEGACY_EVIDENCE_TYPES.length, 13);
});

test('resolveClassification accepts explicit class+subtype and rejects bad combos', () => {
  const good = taxonomy.resolveClassification({ evidence_class: 'repair', evidence_subtype: 'before_repair' });
  assert.equal(good.ok, true);
  assert.equal(good.evidence_class, 'repair');

  const badSubtype = taxonomy.resolveClassification({ evidence_class: 'repair', evidence_subtype: 'auction_image' });
  assert.equal(badSubtype.ok, false);

  const badClass = taxonomy.resolveClassification({ evidence_class: 'spaceship' });
  assert.equal(badClass.ok, false);

  const none = taxonomy.resolveClassification({});
  assert.equal(none.ok, false);
});

test('resolveClassification normalizes legacy evidence without forcing registration into accident/transfer', () => {
  const r = taxonomy.resolveClassification({ evidence_type: 'odometer_photo' });
  assert.equal(r.ok, true);
  assert.equal(r.evidence_class, 'inspection');
  assert.equal(r.evidence_subtype, 'odometer_photo');
  assert.equal(taxonomy.resolveClassification({ evidence_type: 'registration_document' }).evidence_class, 'registration');
  assert.equal(taxonomy.resolveClassification({ evidence_type: 'police_clearance_document' }).evidence_class, 'registration');
  assert.equal(taxonomy.resolveClassification({ evidence_class: 'import', evidence_subtype: 'transit_declaration' }).ok, true);
  assert.equal(taxonomy.resolveClassification({ evidence_class: 'registration', evidence_subtype: 'temporary_import_permit' }).ok, true);
});

// ---- Perceptual hash ------------------------------------------------------------------
test('perceptual hash is deterministic and stable for the same PNG', () => {
  const buf = makePng(1);
  const a = phash.computePerceptualHash(buf, 'image/png');
  const b = phash.computePerceptualHash(buf, 'image/png');
  assert.equal(a.supported, true);
  assert.equal(a.algorithm, 'dhash');
  assert.equal(a.hash.length, 16); // 64 bits -> 16 hex chars
  assert.equal(a.hash, b.hash);
});

test('different images produce different perceptual hashes (non-zero hamming distance)', () => {
  const h1 = phash.computePerceptualHash(makePng(1), 'image/png').hash;
  const h2 = phash.computePerceptualHash(makePng(99), 'image/png').hash;
  assert.notEqual(h1, h2);
  assert.ok(phash.hammingDistance(h1, h2) > 0);
  assert.equal(phash.hammingDistance(h1, h1), 0);
  assert.equal(phash.isNearDuplicate(h1, h1), true);
});

test('unsupported formats return supported:false (no fabricated hash)', () => {
  const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const r = phash.computePerceptualHash(jpegish, 'image/jpeg');
  assert.equal(r.supported, false);
  assert.equal(r.hash, null);
  assert.ok(['unsupported_format', 'decoder_unavailable'].includes(r.reason));
});

// ---- Provenance chain -----------------------------------------------------------------
test('provenance chain builds with incrementing sequence and prev_hash linkage', async () => {
  const sb = makeMock();
  const e1 = await provenance.recordProvenanceEvent(sb, { evidenceId: 'ev1', vin: 'VIN1', eventType: 'created', actorUserId: 'u1', actorRole: 'owner' });
  const e2 = await provenance.recordProvenanceEvent(sb, { evidenceId: 'ev1', vin: 'VIN1', eventType: 'uploaded', actorUserId: 'u1', actorRole: 'owner' });
  const e3 = await provenance.recordProvenanceEvent(sb, { evidenceId: 'ev1', vin: 'VIN1', eventType: 'ai_requested', actorType: 'system' });
  assert.equal(e1.sequence, 1);
  assert.equal(e2.sequence, 2);
  assert.equal(e3.sequence, 3);
  assert.equal(e1.prev_hash, null);
  assert.equal(e2.prev_hash, e1.content_hash);
  assert.equal(e3.prev_hash, e2.content_hash);

  const result = await provenance.verifyProvenanceChain(sb, 'ev1');
  assert.equal(result.valid, true);
  assert.equal(result.length, 3);
});

test('provenance verification detects tampering', async () => {
  const sb = makeMock();
  await provenance.recordProvenanceEvent(sb, { evidenceId: 'evX', eventType: 'created', actorRole: 'owner' });
  await provenance.recordProvenanceEvent(sb, { evidenceId: 'evX', eventType: 'approved', actorRole: 'admin' });
  // Simulate an attacker editing a stored event's details (DB triggers would block this in prod).
  sb._db.evidence_provenance_events[1].event_type = 'rejected';
  const result = await provenance.verifyProvenanceChain(sb, 'evX');
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 2);
});

test('rejects unknown provenance event types', async () => {
  const sb = makeMock();
  await assert.rejects(
    () => provenance.recordProvenanceEvent(sb, { evidenceId: 'e', eventType: 'nonsense' }),
    /unknown eventType/,
  );
});

test('public provenance summary omits IP and raw actor id', async () => {
  const sb = makeMock();
  await provenance.recordProvenanceEvent(sb, { evidenceId: 'evP', eventType: 'created', actorUserId: 'secret-user', actorRole: 'owner', ipAddress: '10.0.0.1' });
  const events = await provenance.listProvenanceEvents(sb, 'evP');
  const pub = provenance.toPublicProvenanceSummary(events);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].actor_role, 'owner');
  assert.ok(!('ip_address' in pub[0]));
  assert.ok(!('actor_user_id' in pub[0]));
});

// ---- Source registry ------------------------------------------------------------------
test('source public serialization strips restricted credentials', () => {
  const full = {
    id: 's1', code: 'gov', display_name: 'Gov', source_type: 'government',
    organization: 'CVR', country: 'ZW', verification_status: 'verified', trust_tier: 'high',
    permitted_evidence_classes: ['ownership_transfer'], active: true,
    contact_reference: 'secret-contact', credential_reference: 'secret-cred',
  };
  const pub = sources.toPublicSource(full);
  assert.equal(pub.code, 'gov');
  assert.ok(!('contact_reference' in pub));
  assert.ok(!('credential_reference' in pub));
});

test('sourcePermitsClass enforces permitted_evidence_classes', () => {
  const s = { active: true, permitted_evidence_classes: ['auction', 'import'] };
  assert.equal(sources.sourcePermitsClass(s, 'auction').ok, true);
  assert.equal(sources.sourcePermitsClass(s, 'accident').ok, false);
  assert.equal(sources.sourcePermitsClass({ active: false }, 'auction').ok, false);
});

// ---- Evidence sets --------------------------------------------------------------------
test('evidence set create/list/attach', async () => {
  const sb = makeMock();
  // seed an evidence row to attach
  sb._db.vehicle_evidence = [{ id: 'ev-1', vin: 'VINS', evidence_set_id: null }];
  const set = await sets.createEvidenceSet(sb, { vin: 'VINS', evidence_class: 'repair', set_type: 'repair_before_during_after', label: 'Front bumper repair', event_date: '2022-03-01' }, { id: 'u9' });
  assert.ok(set.id);
  assert.equal(set.evidence_class, 'repair');

  const list = await sets.listEvidenceSetsForVin(sb, 'VINS');
  assert.equal(list.length, 1);

  await sets.attachEvidenceToSet(sb, 'ev-1', set.id);
  assert.equal(sb._db.vehicle_evidence[0].evidence_set_id, set.id);
});

test('evidence set rejects invalid class and missing vin', async () => {
  const sb = makeMock();
  await assert.rejects(() => sets.createEvidenceSet(sb, { vin: 'V', evidence_class: 'bogus' }), /unknown evidence_class/);
  await assert.rejects(() => sets.createEvidenceSet(sb, { evidence_class: 'repair' }), /vin is required/);
});
