/**
 * Issue #164 Phase 7 — Golden Reference Vehicle Dataset: source certification tests.
 *
 * These prove the fixture ORCHESTRATION invariants deterministically, without a live database. Real
 * DB behaviour (RLS, constraints, RPCs) is proven separately by the owner-run staging sequence (§16);
 * here we prove what source certification can prove: the staging guard fails closed, ids are
 * deterministic, bootstrap/cleanup are idempotent and contained, the fixture NEVER seeds a trust or
 * verification conclusion (it calls refreshCanonicalTrust and performs governed review instead),
 * media and evidence never cross, Golden A becomes publishable while Golden B stays honestly
 * incomplete, and every synthetic record is marked. The completeness gate uses the REAL
 * evaluateCompleteness against the in-memory store, so A-publishable / B-not-publishable are not
 * asserted by fiat.  Run: node --test backend/tests/issue164-phase7-golden-vehicles.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fixture = await import('../services/golden/goldenVehicleFixture.js');
const specs = await import('../services/golden/goldenVehicleSpecs.js');
const { evaluateStagingGuard } = await import('../scripts/issue164-golden-vehicles.mjs');
const { SERVICE_ROLE_TOKEN, ANON_TOKEN } = await import('./helpers/goldenTestTokens.mjs');

// ── minimal, faithful in-memory supabase mock (records every write) ──────────
function makeMock() {
  const db = {};
  const writes = [];      // every insert/update payload, for invariant assertions
  let seq = 0;
  const tbl = (t) => (db[t] = db[t] || []);
  // Support jsonb path filters like `payload->>vin` so outbox cleanup can be exercised.
  const getVal = (row, col) => {
    const m = /^(\w+)->>(\w+)$/.exec(col);
    return m ? row[m[1]]?.[m[2]] : row[col];
  };
  const match = (row, filters) => filters.every(([op, col, val]) => {
    const v = getVal(row, col);
    return op === 'eq' ? v === val : op === 'in' ? val.includes(v) : true;
  });

  // Narrow a row to the columns a select actually asked for. `*` (including embedded shapes like
  // `*, vehicles(...)`) returns the whole row, as PostgREST does.
  const project = (row, cols) => {
    if (!cols || String(cols).includes('*')) return { ...row };
    const out = {};
    for (const name of String(cols).split(',').map((c) => c.trim()).filter(Boolean)) out[name] = row[name];
    return out;
  };

  function builder(table) {
    const st = { table, op: 'select', filters: [], payload: null, cols: '*', head: false, wantCount: false };
    const exec = () => {
      const rows = tbl(table);
      if (st.op === 'select') {
        const found = rows.filter((r) => match(r, st.filters));
        if (st.wantCount && st.head) return { data: null, count: found.length, error: null };
        // PROJECT to the requested columns. This mock used to return the whole row whatever the
        // select asked for, which made it strictly more generous than PostgREST — and that is how a
        // real defect shipped: verify() probed `storage_bucket`/`file_path` on rows whose select
        // never requested them, and every test passed because the mock handed them over anyway. A
        // mock that answers questions the server would not answer cannot prove the server's contract.
        return { data: found.map((r) => project(r, st.cols)), error: null, count: found.length };
      }
      if (st.op === 'insert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        const inserted = arr.map((r) => {
          const row = { id: r.id ?? `${table}_${++seq}`, ...r };
          rows.push(row);
          writes.push({ table, op: 'insert', row });
          return { ...row };
        });
        return { data: inserted, error: null };
      }
      if (st.op === 'update') {
        const affected = rows.filter((r) => match(r, st.filters));
        affected.forEach((r) => { Object.assign(r, st.payload); writes.push({ table, op: 'update', patch: st.payload, id: r.id }); });
        return { data: affected.map((r) => ({ ...r })), error: null };
      }
      if (st.op === 'delete') {
        const keep = [], removed = [];
        for (const r of rows) (match(r, st.filters) ? removed : keep).push(r);
        db[table] = keep;
        return { data: removed.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: null };
    };
    const chain = {
      select(cols, opts) { st.cols = cols; if (opts?.head) st.head = true; if (opts?.count) st.wantCount = true; return chain; },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      delete() { st.op = 'delete'; return chain; },
      eq(c, v) { st.filters.push(['eq', c, v]); return chain; },
      in(c, v) { st.filters.push(['in', c, v]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { const r = exec(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      single() { const r = exec(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.data?.length ? null : { message: 'no rows' } }); },
      then(res, rej) { try { return Promise.resolve(exec()).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return chain;
  }
  return { client: { from: (t) => builder(t) }, db, writes };
}

// Injected spies for the canonical services (real DB behaviour is out of scope for source tests). The
// REAL evaluateCompleteness is used so publishability is derived, not asserted.
async function makeDeps(client, opts = {}) {
  const { evaluateCompleteness } = await import('../services/evidence/completenessEvaluator.js');
  const calls = { refreshCanonicalTrust: [], createInquiry: [], recordManualVerification: [], uploadToStorage: [] };
  return {
    deps: {
      client,
      evaluateCompleteness,
      refreshCanonicalTrust: async (vin) => { calls.refreshCanonicalTrust.push(vin); return { vin, written: true }; },
      getCanonicalTrust: async (vin) => ({ vin, evaluation_state: 'evaluated', calculation_version: 'trust-decision-1.0.0', score: 72, band: 'moderate' }),
      toPublicTrust: (rec) => ({ vin: rec.vin, evaluation_state: rec.evaluation_state, calculation_version: rec.calculation_version, score: rec.score, band: rec.band }),
      createInquiry: async (c, payload, actor) => {
        calls.createInquiry.push({ payload, actor });
        // Emulate the real service's insert so the bootstrap's reuse-guard is genuinely exercised.
        const { data } = await c.from('marketplace_inquiries').insert({
          listing_id: payload.listing_id, buyer_id: actor.id, inquiry_type: payload.inquiry_type, status: 'new',
        }).select('id').single();
        return { id: data.id };
      },
      recordManualVerification: async (vin, provider) => {
        calls.recordManualVerification.push({ vin, provider });
        // Emulate the append-only service insert so bootstrap's reuse-guard is genuinely exercised.
        const { data } = await client.from('source_verification_results').insert({ vin, provider, mode: 'manual_verification', result: 'match' }).select('id').single();
        return { id: data.id, vin, provider };
      },
      submitFinancingApplication: async (vin, userId, bankId, amount) => {
        const { data } = await client.from('finance_applications').insert({ vin, user_id: userId, bank_id: bankId, requested_amount: amount, status: 'Pending' }).select('id').single();
        return { id: data.id, status: 'Pending' };
      },
      createInsurancePolicy: async (vin, insurerId) => {
        const { data } = await client.from('insurance_records').insert({ vin, insurer_id: insurerId, active: true }).select('id').single();
        return { id: data.id, policyNumber: 'PH7-POL' };
      },
      addRepairLog: async (vin, mechanicId, partName) => {
        const { data } = await client.from('partsentry_logs').insert({ vin, mechanic_id: mechanicId, part_name: partName }).select('id').single();
        return { id: data.id };
      },
      // Phase 8, Cluster C: the fixture now puts real bytes through the canonical storage contract
      // instead of writing unresolvable `.test` URLs. These source tests have no Supabase, so the
      // uploader is injected — but it MIRRORS the real contract's return shape, which is what the
      // orchestration depends on: a public bucket yields an absolute URL, a private bucket yields the
      // relative storage path for later signing.
      uploadToStorage: async (bucket, path, buffer, mime) => {
        calls.uploadToStorage.push({ bucket, path, bytes: buffer?.length ?? 0, mime });
        return bucket === 'vehicle-images'
          ? `https://storage.test.invalid/storage/v1/object/public/${bucket}/${path}`
          : path;
      },
      generateSecureReadUrl: async (bucket, path) => `https://storage.test.invalid/signed/${bucket}/${path}`,
      // verify() now proves the locators are RETRIEVABLE, not merely present — the check the Phase 7
      // fixture lacked, which is how five dangling `.test` photo URLs passed verification and then
      // failed in a real browser. The probe is injected here so the invariant is exercised without a
      // network; in staging it defaults to the real fetch.
      fetchImpl: async (url) => {
        const isImage = url.includes('/vehicle-images/');
        const isDoc = url.includes('/ocr-documents/');
        if (!isImage && !isDoc) return { ok: false, status: 404, headers: { get: () => '' } };
        return {
          ok: true,
          status: 200,
          headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (isImage ? 'image/png' : 'application/pdf') : '') },
        };
      },
      ...opts,
    },
    calls,
  };
}

// The fixture here used to be the literal string 'a.b.c' — three segments, and nothing else. That is
// exactly what let a legacy anon key through the guard, so the credential now has to be a real
// service_role token for this to pass.
test('guard: an anon JWT on the approved host is refused', () => {
  const r = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: ANON_TOKEN });
  assert.equal(r.ok, false);
  assert.match(r.reason, /service_role/);
});

test('guard: staging URL with service-role JWT passes', () => {
  const r = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN });
  assert.equal(r.ok, true);
});

test('guard: production ref is refused (fail closed)', () => {
  const prod = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
  const r = evaluateStagingGuard({ SUPABASE_URL: `https://${prod}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN });
  assert.equal(r.ok, false);
  assert.match(r.reason, /forbidden production ref/);
});

test('guard: non-staging url, missing url, and non-JWT key all refused', () => {
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://other.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN }).ok, false);
  assert.equal(evaluateStagingGuard({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN }).ok, false);
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-a-jwt' }).ok, false);
});

test('guard: prod DB URL anywhere in scope is refused even with a staging SUPABASE_URL', () => {
  const prod = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
  const r = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN, DATABASE_URL: `postgres://x@db.${prod}.supabase.co/postgres` });
  assert.equal(r.ok, false);
});

test('deterministic fixture ids/VINs are stable and structurally valid', async () => {
  const { isStructurallyValidVin } = await import('../services/marketplace/marketplaceListingEligibility.js');
  for (const v of specs.GOLDEN_VEHICLES) assert.equal(isStructurallyValidVin(v.vin), true, `${v.vin} must be structurally valid`);
  // Re-import yields identical ids (no randomness / no Date in the spec identifiers).
  const again = await import('../services/golden/goldenVehicleSpecs.js');
  assert.deepEqual(again.fixtureVins(), specs.fixtureVins());
  assert.deepEqual(again.fixtureUserIds(), specs.fixtureUserIds());
});

test('bootstrap is idempotent: a second run adds no duplicate rows', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  const after1 = Object.fromEntries(Object.entries(db).map(([t, r]) => [t, r.length]));
  await fixture.bootstrap(deps);
  const after2 = Object.fromEntries(Object.entries(db).map(([t, r]) => [t, r.length]));
  assert.deepEqual(after2, after1, 'row counts must be identical after a second bootstrap');
});

test('cleanup is idempotent and contained: fixture removed, unrelated preserved', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  // Seed an UNRELATED vehicle + user that cleanup must never touch.
  db.vehicles = [{ vin: 'REALVIN0000000001', owner_id: 'real-user' }];
  db.users = [{ id: 'real-user', email: 'real@example.com' }];
  db.vehicle_evidence = [{ id: 'ev-real', vin: 'REALVIN0000000001', evidence_type: 'registration_document' }];
  await fixture.bootstrap(deps);
  const clean1 = await fixture.cleanup(deps);
  // Unrelated survives
  assert.ok(db.vehicles.find((v) => v.vin === 'REALVIN0000000001'), 'unrelated vehicle must survive cleanup');
  assert.ok(db.users.find((u) => u.id === 'real-user'), 'unrelated user must survive cleanup');
  assert.ok(db.vehicle_evidence.find((e) => e.id === 'ev-real'), 'unrelated evidence must survive cleanup');
  // Fixture removed
  for (const vin of specs.fixtureVins()) assert.equal(db.vehicles.find((v) => v.vin === vin), undefined);
  for (const id of specs.fixtureUserIds()) assert.equal(db.users.find((u) => u.id === id), undefined);
  // Idempotent: a second cleanup deletes nothing
  const clean2 = await fixture.cleanup(deps);
  const totalDeleted2 = Object.values(clean2.deleted || {}).reduce((a, b) => a + (b || 0), 0);
  assert.equal(totalDeleted2, 0, 'second cleanup must delete zero rows');
  assert.equal(clean1.ok && clean2.ok, true);
});

test('trust is DERIVED, never seeded: no fixture write sets a non-null trust_score; refresh IS called', async () => {
  const { client, writes } = makeMock();
  const { deps, calls } = await makeDeps(client);
  await fixture.bootstrap(deps);
  // No insert/update ever writes a non-null trust_score, and none touch trust_* stamp columns.
  for (const w of writes) {
    const payload = w.op === 'insert' ? w.row : w.patch;
    if (payload && 'trust_score' in payload) assert.equal(payload.trust_score, null, `write to ${w.table} must not set a non-null trust_score`);
    for (const k of Object.keys(payload || {})) {
      assert.ok(!/^trust_(band|calculation_version|confidence|evaluated_at|known_limitations|evidence_basis)$/.test(k), `fixture must not write cache column ${k}`);
    }
  }
  // The canonical writer WAS invoked for both vehicles.
  assert.ok(calls.refreshCanonicalTrust.includes(specs.GOLDEN_A.vin));
  assert.ok(calls.refreshCanonicalTrust.includes(specs.GOLDEN_B.vin));
});

test('Golden A becomes publishable and is published (derived via real evaluateCompleteness)', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  const { evaluateCompleteness } = await import('../services/evidence/completenessEvaluator.js');
  const comp = await evaluateCompleteness(specs.GOLDEN_A.vin, { client });
  assert.equal(comp.is_publishable, true, 'Golden A must be publishable');
  const vehA = db.vehicles.find((v) => v.vin === specs.GOLDEN_A.vin);
  assert.equal(vehA.publication_status, 'published', 'Golden A must be published');
});

test('Golden B stays incomplete: not publishable, not published, ownership NOT verified', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  const { evaluateCompleteness } = await import('../services/evidence/completenessEvaluator.js');
  const comp = await evaluateCompleteness(specs.GOLDEN_B.vin, { client });
  assert.equal(comp.is_publishable, false, 'Golden B must NOT be publishable');
  const vehB = db.vehicles.find((v) => v.vin === specs.GOLDEN_B.vin);
  assert.notEqual(vehB.publication_status, 'published');
  const ownershipVerified = db.vehicle_evidence.some((e) => e.vin === specs.GOLDEN_B.vin
    && ['registration_document', 'ownership_transfer_document'].includes(e.evidence_type)
    && ['verified', 'confirmed', 'approved'].includes(e.verification_status));
  assert.equal(ownershipVerified, false, 'absence of a verified ownership doc must NOT become verification');
});

test('no positive verification from missing evidence (anti-vacuity): verifying B would flip publishability', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  const { evaluateCompleteness } = await import('../services/evidence/completenessEvaluator.js');
  assert.equal((await evaluateCompleteness(specs.GOLDEN_B.vin, { client })).is_publishable, false);
  // Flip B's ownership doc to verified and prove the gate WOULD open — so the B assertion is meaningful.
  const doc = db.vehicle_evidence.find((e) => e.vin === specs.GOLDEN_B.vin && e.evidence_type === 'registration_document');
  doc.verification_status = 'verified';
  assert.equal((await evaluateCompleteness(specs.GOLDEN_B.vin, { client })).is_publishable, true);
});

test('media and evidence never cross (Golden A)', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  const media = db.listing_images.filter((m) => m.vin === specs.GOLDEN_A.vin);
  const evidence = db.vehicle_evidence.filter((e) => e.vin === specs.GOLDEN_A.vin);
  assert.equal(media.length, specs.GOLDEN_A.listingImageCount);
  assert.ok(evidence.length >= specs.GOLDEN_A.evidence.length);
  // Distinct tables, distinct urls: no listing image url appears as an evidence file_url and vice versa.
  const mediaUrls = new Set(media.map((m) => m.image_url));
  const evidenceUrls = new Set(evidence.map((e) => e.file_url));
  for (const u of mediaUrls) assert.ok(!evidenceUrls.has(u));
});

test('no duplicate communication/transaction graph on re-bootstrap (inquiry stays single)', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  await fixture.bootstrap(deps);
  const inqA = (db.marketplace_inquiries || []).filter((i) => i.listing_id === specs.GOLDEN_A.vin);
  assert.equal(inqA.length, 1, 'exactly one buyer inquiry for Golden A after two bootstraps');
});

test('synthetic markers present: users are @carup-staging.test; evidence carries the synthetic marker', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  for (const id of specs.fixtureUserIds()) {
    const u = db.users.find((x) => x.id === id);
    assert.match(u.email, /@carup-staging\.test$/);
  }
  for (const e of db.vehicle_evidence) {
    assert.ok(e.metadata && e.metadata[specs.GOLDEN_MARKER] === true, 'every fixture evidence row carries the GOLDEN_MARKER');
    assert.equal(e.metadata.marker, specs.SYNTHETIC_DOCUMENT_MARKER);
  }
});

test('verify() passes against a freshly bootstrapped store', async () => {
  const { client } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  const r = await fixture.verify(deps);
  const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.equal(r.ok, true, `verify should pass; failed: ${failed.join(', ')}`);
});

test('guard: a URL that only CONTAINS the staging ref in path/query is refused (exact host required)', () => {
  const attack = evaluateStagingGuard({ SUPABASE_URL: 'https://example.com/?ref=eoyenigwevnxwwhyhaer', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN });
  assert.equal(attack.ok, false, 'a non-staging host with the ref in the query must be refused');
  const subdomainAttack = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co.evil.com', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN });
  assert.equal(subdomainAttack.ok, false, 'a look-alike host must be refused');
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN }).ok, true);
});

test('Golden A trust must be evaluated: a not_evaluated refresh makes bootstrap a required failure', async () => {
  const { client } = makeMock();
  const { deps } = await makeDeps(client, {
    // Simulate refreshCanonicalTrust that could not produce a canonical decision.
    getCanonicalTrust: async (vin) => ({ vin, evaluation_state: 'not_evaluated', calculation_version: null, score: null, band: 'insufficient_evidence' }),
    toPublicTrust: (rec) => ({ vin: rec.vin, evaluation_state: rec.evaluation_state, calculation_version: rec.calculation_version, score: rec.score, band: rec.band }),
  });
  const r = await fixture.bootstrap(deps);
  assert.equal(r.ok, false, 'bootstrap must fail when Golden A trust is not evaluated');
  assert.ok(r.requiredFailed.some((n) => n === 'A:trust_read'), `A:trust_read must be a required failure; got ${r.requiredFailed.join(', ')}`);
});

test('fixture creates NO append-only rows (keeps Golden A fully removable)', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  // source_verification_results and escrow_trust_events are governance append-only (delete-blocked) and
  // FK-chain to the vehicle; creating either would permanently pin the fixture VIN. The fixture must
  // create neither, so cleanup can always remove the whole graph.
  assert.equal((db.source_verification_results || []).length, 0, 'must not create source coverage rows');
  assert.equal((db.escrow_trust_sessions || []).length, 0, 'must not create escrow sessions');
  assert.equal((db.escrow_trust_events || []).length, 0, 'must not create escrow events');
});

test('cleanup removes the fixture outbox events (domain_events) it created', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  // Seed synthetic outbox events for the fixture graph (as the real services would) + one unrelated.
  db.domain_events = [
    { id: 'de1', event_type: 'finance.application.status_changed', payload: { vin: specs.GOLDEN_A.vin } },
    { id: 'de2', event_type: 'marketplace.inquiry.created', payload: { recipientUserId: specs.GOLDEN_A.buyerId } },
    { id: 'de-real', event_type: 'other', payload: { vin: 'REALVIN0000000002' } },
  ];
  await fixture.cleanup(deps);
  assert.equal(db.domain_events.find((e) => e.id === 'de1'), undefined, 'fixture vin-scoped event must be removed');
  assert.equal(db.domain_events.find((e) => e.id === 'de2'), undefined, 'fixture recipient-scoped event must be removed');
  assert.ok(db.domain_events.find((e) => e.id === 'de-real'), 'unrelated event must survive');
});

// ── Issue #164 Phase 8, Cluster C — locators must be real ────────────────────────────────────────
// Phase 7 wrote `media.carup-staging.test` / `evidence.carup-staging.test` URLs straight into the
// rows. `.test` is reserved by RFC 2606, so every Golden A photo was broken in the browser and every
// evidence file was unopenable, while bootstrap and verify both reported success. These three tests
// fail on the baseline `993c1179`.

test('bootstrap writes canonical storage locators, never a reserved .test host', async () => {
  const { client, db } = makeMock();
  const { deps, calls } = await makeDeps(client);
  await fixture.bootstrap(deps);

  const mediaUrls = (db.listing_images || []).map((r) => r.image_url);
  assert.ok(mediaUrls.length > 0, 'expected listing media');
  for (const url of mediaUrls) {
    assert.doesNotMatch(url, /carup-staging\.test/, `listing media must not use the reserved host: ${url}`);
    assert.match(url, /\/vehicle-images\//, 'listing media belongs in the public vehicle-images bucket');
  }

  for (const ev of (db.vehicle_evidence || [])) {
    assert.doesNotMatch(String(ev.file_url), /carup-staging\.test/, 'evidence must not use the reserved host');
    assert.equal(ev.storage_bucket, 'ocr-documents', 'documents route to the private bucket');
    assert.ok(ev.file_path, 'evidence must carry a storage path for signed reads');
    assert.notEqual(ev.storage_bucket, 'phase7-golden', 'the phase7-golden bucket has never existed');
  }

  // Real bytes were produced and handed to the canonical uploader, not just a string.
  assert.ok(calls.uploadToStorage.length > 0, 'bootstrap must upload through the storage contract');
  assert.ok(calls.uploadToStorage.every((u) => u.bytes > 0), 'every upload must carry real bytes');
});

test('bootstrap REPAIRS Phase 7 locators in place instead of duplicating the rows', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  const spec = specs.GOLDEN_A;

  // Seed the store exactly as Phase 7 left it: rows pointing at the unresolvable host.
  db.listing_images = specs.legacyListingImageUrls(spec).map((url, i) => ({
    id: `li${i}`, vin: spec.vin, image_url: url, is_primary: false, display_order: i,
  }));
  db.vehicle_evidence = [{
    id: 've1', vin: spec.vin, vehicle_id: spec.vin, evidence_type: 'registration_document',
    verification_status: 'pending', file_url: specs.legacyEvidenceFileUrl(spec, 'registration_document'),
    storage_bucket: 'phase7-golden', file_path: `phase7-golden/${spec.vin}/registration_document.pdf`,
  }];

  await fixture.bootstrap(deps);

  const aMedia = db.listing_images.filter((r) => r.vin === spec.vin);
  assert.equal(aMedia.length, spec.listingImageCount,
    'repair must not insert new rows beside the legacy ones — the governed media count is exact');
  assert.ok(aMedia.every((r) => !/carup-staging\.test/.test(r.image_url)), 'every legacy URL must be repaired');

  const reg = db.vehicle_evidence.filter((r) => r.vin === spec.vin && r.evidence_type === 'registration_document');
  assert.equal(reg.length, 1, 'evidence repair must not duplicate the row');
  assert.equal(reg[0].id, 've1', 'the SAME row is repaired, preserving its id and review history');
  assert.equal(reg[0].storage_bucket, 'ocr-documents');
});

test('verify() FAILS when a listing image cannot actually be retrieved', async () => {
  const { client } = makeMock();
  // Everything is bootstrapped correctly, but the object is not retrievable — the exact condition
  // Phase 7 shipped and could not detect.
  const { deps } = await makeDeps(client, {
    fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => '' } }),
  });
  await fixture.bootstrap(deps);
  const r = await fixture.verify(deps);
  assert.equal(r.ok, false, 'verify must not pass while the media is unreachable');
  const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.some((n) => n.endsWith(':media_fetchable')), `expected a media_fetchable failure, got ${failed}`);
});

// ── Issue #164 Phase 8 — the verifier must LOAD the fields it verifies ───────────────────────────
// Found by the owner during the first guarded staging sequence run, which stopped at
// `verify_1: ["A:evidence_fetchable","B:evidence_fetchable"]` after every upload had succeeded.
// verify() selected `id, evidence_type, verification_status, file_url` but the fetchability probe
// requires `storage_bucket` and `file_path` to mint a signed read for the private bucket — so it was
// handed rows that could not carry a locator and reported "no storage locator" for every document.
//
// Two things hid it. The mock returned the whole row whatever the select asked for (now fixed: it
// projects, and reverting the select alone reproduces the owner's exact failure). And
// `evidence_bucket_exists` passed VACUOUSLY, because filtering undefined buckets leaves an empty
// array and `[].every()` is true — an invariant that cannot fail is not an invariant.

test('verify() loads the private-storage locator fields it probes with', async () => {
  const { client } = makeMock();
  const selects = [];
  const spyClient = {
    from: (table) => {
      const chain = client.from(table);
      const originalSelect = chain.select.bind(chain);
      chain.select = (cols, opts) => { selects.push({ table, cols }); return originalSelect(cols, opts); };
      return chain;
    },
  };
  const { deps } = await makeDeps(spyClient);
  await fixture.bootstrap(deps);
  selects.length = 0;
  await fixture.verify(deps);

  const evidenceReads = selects.filter((s) => s.table === 'vehicle_evidence');
  assert.ok(evidenceReads.length > 0, 'verify() must read vehicle_evidence');
  for (const field of ['storage_bucket', 'file_path']) {
    assert.ok(
      evidenceReads.some((s) => String(s.cols).includes(field)),
      `verify() probes e.${field} to mint the signed read, so its select must request it`,
    );
  }
});

test('evidence_bucket_exists cannot pass vacuously when no bucket was loaded', async () => {
  const { client, db } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);
  // Strip the locator from a stored row: the check must FAIL, not shrug at an empty set.
  for (const row of db.vehicle_evidence) { delete row.storage_bucket; delete row.file_path; }
  const r = await fixture.verify(deps);
  const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.some((n) => n.endsWith(':evidence_fetchable')),
    `an unlocatable document must fail evidence_fetchable, got: ${failed.join(', ')}`);
});

// ── Codex P2: a storage removal error must FAIL cleanup, not be recorded and ignored ─────────────
// The error was copied into `detail` and the step returned normally, so the reporter marked
// `del:storage_objects` ok and cleanup went on to delete the locator rows. The sequence could then
// report PASS while leaving orphaned objects that nothing in the database can find again.
test('cleanup FAILS when a storage object cannot be removed', async () => {
  const { client } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);

  const failing = {
    ...client,
    storage: { from: () => ({ remove: async () => ({ data: null, error: { message: 'bucket unavailable' } }) }) },
  };
  const r = await fixture.cleanup({ ...deps, client: failing });
  const storageStep = r.steps.find((s) => s.name === 'del:storage_objects');
  assert.ok(storageStep, 'the storage step must exist');
  assert.equal(storageStep.ok, false, 'a real removal error must fail the step');
  assert.equal(r.ok, false, 'cleanup as a whole must not report success');
});

test('cleanup still succeeds when the objects are simply already gone (idempotent)', async () => {
  const { client } = makeMock();
  const { deps } = await makeDeps(client);
  await fixture.bootstrap(deps);

  const empty = {
    ...client,
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
  };
  const r = await fixture.cleanup({ ...deps, client: empty });
  const storageStep = r.steps.find((s) => s.name === 'del:storage_objects');
  assert.equal(storageStep.ok, true, 'removing nothing is the desired end state, not a failure');
});
