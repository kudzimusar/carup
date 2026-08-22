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

  function builder(table) {
    const st = { table, op: 'select', filters: [], payload: null, cols: '*', head: false, wantCount: false };
    const exec = () => {
      const rows = tbl(table);
      if (st.op === 'select') {
        const found = rows.filter((r) => match(r, st.filters));
        if (st.wantCount && st.head) return { data: null, count: found.length, error: null };
        return { data: found.map((r) => ({ ...r })), error: null, count: found.length };
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
  const calls = { refreshCanonicalTrust: [], createInquiry: [], recordManualVerification: [] };
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
      requestMarketplaceEscrow: async (vin, { actor }) => {
        // Idempotent like the real upsert-by-key: one session per vin+buyer.
        const { data: ex } = await client.from('escrow_trust_sessions').select('id').eq('vin', vin).eq('buyer_id', actor.id).maybeSingle();
        if (ex?.id) return { status: 'eligible', transaction_intent_id: ex.id };
        const { data } = await client.from('escrow_trust_sessions').insert({ vin, buyer_id: actor.id, status: 'eligible' }).select('id').single();
        return { status: 'eligible', transaction_intent_id: data.id };
      },
      createInsurancePolicy: async (vin, insurerId) => {
        const { data } = await client.from('insurance_records').insert({ vin, insurer_id: insurerId, active: true }).select('id').single();
        return { id: data.id, policyNumber: 'PH7-POL' };
      },
      addRepairLog: async (vin, mechanicId, partName) => {
        const { data } = await client.from('partsentry_logs').insert({ vin, mechanic_id: mechanicId, part_name: partName }).select('id').single();
        return { id: data.id };
      },
      ...opts,
    },
    calls,
  };
}

test('guard: staging URL with service-role JWT passes', () => {
  const r = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' });
  assert.equal(r.ok, true);
});

test('guard: production ref is refused (fail closed)', () => {
  const prod = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
  const r = evaluateStagingGuard({ SUPABASE_URL: `https://${prod}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /forbidden production ref/);
});

test('guard: non-staging url, missing url, and non-JWT key all refused', () => {
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://other.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' }).ok, false);
  assert.equal(evaluateStagingGuard({ SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' }).ok, false);
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-a-jwt' }).ok, false);
});

test('guard: prod DB URL anywhere in scope is refused even with a staging SUPABASE_URL', () => {
  const prod = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
  const r = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c', DATABASE_URL: `postgres://x@db.${prod}.supabase.co/postgres` });
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
  const attack = evaluateStagingGuard({ SUPABASE_URL: 'https://example.com/?ref=eoyenigwevnxwwhyhaer', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' });
  assert.equal(attack.ok, false, 'a non-staging host with the ref in the query must be refused');
  const subdomainAttack = evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co.evil.com', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' });
  assert.equal(subdomainAttack.ok, false, 'a look-alike host must be refused');
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' }).ok, true);
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
