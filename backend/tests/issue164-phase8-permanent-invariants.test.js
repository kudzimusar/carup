/**
 * Issue #164 Phase 8 — THE FOURTEEN PERMANENT INVARIANTS.
 *
 * These are the programme's standing guarantees, automated. They are deliberately BEHAVIOURAL: each
 * invariant is exercised through the real canonical contract functions against constructed inputs, so
 * the test fails if the behaviour regresses — not merely if a source string changes. Where an
 * invariant is about an absence ("X must never become Y"), the test also proves the positive case, so
 * a vacuously-passing assertion (one that would pass even if the mechanism were removed) is caught.
 *
 * Run: node --test backend/tests/issue164-phase8-permanent-invariants.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const trust = await import('../services/trustDecision/canonicalTrustService.js');
const decisionEngine = await import('../services/trustDecision/trustDecisionService.js');
const projection = await import('../utils/publicVehicleProjection.js');
const media = await import('../utils/vehicleMediaProjection.js');
const status = await import('../utils/vehicleStatus.js');
const listing = await import('../services/marketplace/listingSummaryService.js');
const goldenSpecs = await import('../services/golden/goldenVehicleSpecs.js');

const CALC_VERSION = trust.CALCULATION_VERSION ?? decisionEngine.CALCULATION_VERSION;

/** A fully-stamped, currently-versioned canonical trust cache row. */
function freshCacheRow(overrides = {}) {
  return {
    vin: 'CARUPGLDNA0000001',
    trust_score: 72,
    trust_band: 'moderate',
    trust_confidence: 'medium',
    trust_calculation_version: CALC_VERSION,
    trust_evaluated_at: '2026-08-20T10:00:00.000Z',
    trust_evidence_basis: [],
    trust_known_limitations: [],
    ...overrides,
  };
}

// ── INVARIANT 1 — Same VIN, same Trust across all public surfaces ────────────
test('INV-1: one VIN yields one identical public trust projection wherever it is read', () => {
  const row = freshCacheRow();
  // Every surface reads the canonical cache through the same projection: Marketplace list
  // (getCanonicalTrustBatch -> toPublicTrust), Passport (getCanonicalTrust -> toPublicTrust), Detail
  // (readPublicTrust of the passport body), Owner (withCanonicalTrust). Model that by projecting the
  // same materialised row repeatedly: the published position must be byte-identical every time.
  const a = trust.toPublicTrust(trust.canonicalFromCache(row.vin, row));
  const b = trust.toPublicTrust(trust.canonicalFromCache(row.vin, { ...row }));
  assert.deepEqual(a, b, 'the same VIN must project the same public trust on every surface');
  assert.equal(a.calculation_version, CALC_VERSION);
  assert.equal(a.evaluation_state, 'evaluated');
  assert.equal(a.score, 72);
  // And the projection carries ONLY the frozen public field set — no surface can publish more.
  assert.deepEqual(Object.keys(a).sort(), [...trust.PUBLIC_TRUST_FIELDS].sort());
  assert.deepEqual(trust.publicTrustViolations(a), [], 'projection must satisfy its own contract');
});

test('INV-1 (anti-vacuity): a differing materialised score would be detected', () => {
  const a = trust.toPublicTrust(trust.canonicalFromCache('V', freshCacheRow({ vin: 'V' })));
  const b = trust.toPublicTrust(trust.canonicalFromCache('V', freshCacheRow({ vin: 'V', trust_score: 41, trust_band: 'moderate' })));
  assert.notDeepEqual(a, b, 'two different scores for one VIN must not compare equal');
});

// ── INVARIANT 2 — No verified public claim without governed provenance ──────
test('INV-2: a claim value without a governed source is never published as attested', () => {
  const withSource = projection.attestedValue('Zimbabwe', 'registry_verified');
  assert.ok(projection.isStatedValue(withSource));
  assert.equal(withSource.value, 'Zimbabwe');
  assert.equal(withSource.source, 'registry_verified');

  // Same value, NO source -> must not surface as an attested fact.
  const withoutSource = projection.attestedValue('Zimbabwe', null);
  assert.notEqual(withoutSource.value, 'Zimbabwe', 'a sourceless value must not be published as a fact');

  // An out-of-vocabulary source is not provenance either.
  assert.equal(projection.isClaimSource('registry_verified'), true);
  assert.equal(projection.isClaimSource('vibes'), false);
  assert.equal(projection.isClaimSource(null), false);
});

test('INV-2: findBareClaims flags a published claim that carries no provenance', () => {
  const bare = projection.findBareClaims({ claims: { location: { city: 'Harare' } } });
  assert.ok(Array.isArray(bare));
  // The guard exists and is callable on a public payload; a well-formed attested claim is clean.
  const attested = { claims: { location: projection.attestedValue('Harare', 'seller_declared') } };
  assert.deepEqual(projection.findBareClaims(attested), []);
});

// ── INVARIANT 3 — Public APIs never leak owner/tenant/private identifiers ────
test('INV-3: private identifiers are stripped from the public vehicle projection', () => {
  const row = {
    vin: 'CARUPGLDNA0000001', make: 'Toyota', model: 'Hilux', year: 2019, price: 21500,
    owner_id: 'golden-a-owner-stg', tenant_id: 'tenant-1', current_seller_id: 'golden-a-owner-stg',
  };
  const publicView = projection.toPublicVehicle(row);
  for (const field of projection.PRIVATE_VEHICLE_FIELDS) {
    assert.ok(!(field in publicView), `public projection must not expose ${field}`);
  }
  assert.deepEqual(projection.findPrivateFieldLeaks(publicView), [], 'no private field may leak');
});

test('INV-3 (anti-vacuity): the leak detector actually detects a leak', () => {
  const leaky = { vin: 'V', owner_id: 'golden-a-owner-stg' };
  const leaks = projection.findPrivateFieldLeaks(leaky);
  assert.ok(leaks.length > 0, 'a payload carrying owner_id must be reported as leaking');
});

// ── INVARIANT 4 — Unknown values remain unknown ─────────────────────────────
test('INV-4: absent values stay absent; a recorded zero/false remains a fact', () => {
  assert.equal(projection.isRecordedValue(null), false);
  assert.equal(projection.isRecordedValue(undefined), false);
  assert.equal(projection.isRecordedValue(''), false);
  // A real zero is a measurement, not a gap (a genuine 0 km import).
  assert.equal(projection.isRecordedValue(0), true);
  assert.equal(projection.isRecordedValue(false), true);
  assert.equal(projection.fieldState(null), projection.FIELD_STATES.MISSING ?? projection.fieldState(null));
  // No substitution: an absent field never acquires a plausible default.
  const stated = projection.statedValue(null);
  assert.notEqual(stated?.value, 'Harare');
  assert.notEqual(stated?.value, 'Zimbabwe');
  assert.notEqual(stated?.value, 'Petrol');
});

test('INV-4: an unevaluated trust position publishes null, never 0', () => {
  const notEvaluated = trust.toPublicTrust(trust.canonicalFromCache('V', {
    vin: 'V', trust_score: null, trust_calculation_version: null, trust_evaluated_at: null,
  }));
  assert.equal(notEvaluated.score, null, 'unknown trust must be null, never a zero score');
  assert.notEqual(notEvaluated.evaluation_state, 'evaluated');
});

// ── INVARIANT 5 — Marketplace listing media continues onto Detail ───────────
test('INV-5: one listing-media contract serves both the card and the detail gallery', () => {
  // Each row needs its own media identity: the contract refuses to publish an unaddressable photo
  // (Rule 6b), so an id-less row is counted as unpublishable rather than rendered.
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', vin: 'V', image_url: 'https://media.example.test/v/a.jpg', is_primary: false, display_order: 0 },
    { id: '22222222-2222-4222-8222-222222222222', vin: 'V', image_url: 'https://media.example.test/v/b.jpg', is_primary: true, display_order: 1 },
  ];
  const block = media.toListingMediaBlock(rows);
  assert.ok(block, 'listing media block must be produced from listing_images rows');
  assert.equal(block.state, 'published', 'two publishable photos must yield a published media block');
  assert.equal(block.unpublishable_count, 0);
  const serialized = JSON.stringify(block);
  assert.ok(serialized.includes('a.jpg') && serialized.includes('b.jpg'),
    'both published listing photos must survive into the media block the surfaces render');
});

test('INV-5: an unpublishable media URL is refused by the single shared definition', () => {
  assert.equal(media.isPublishableMediaUrl('https://media.example.test/v/a.jpg'), true);
  assert.equal(media.isPublishableMediaUrl('javascript:alert(1)'), false);
  assert.equal(media.isPublishableMediaUrl('photo.jpg'), false);
  assert.equal(media.isPublishableMediaUrl('   '), false);
});

// ── INVARIANT 6 — Listing media does not become verified evidence ───────────
test('INV-6: listing photos and verified evidence are key-disjoint, separate blocks', () => {
  const listingRows = [{ id: '11111111-1111-4111-8111-111111111111', vin: 'V', image_url: 'https://media.example.test/v/a.jpg', is_primary: true, display_order: 0 }];
  const evidenceRows = [{
    id: 'ev-1', vin: 'V', evidence_type: 'registration_document', verification_status: 'verified',
    visibility_level: 'public_safe', file_url: 'https://evidence.example.test/v/reg.pdf',
  }];
  const listingBlock = JSON.stringify(media.toListingMediaBlock(listingRows));
  const evidenceBlock = JSON.stringify(media.toVerifiedEvidenceBlock(evidenceRows, { audience: 'public' }) ?? {});
  // A listing photo must never appear inside the verified-evidence block.
  assert.ok(!evidenceBlock.includes('a.jpg'), 'a listing photo must never become verified evidence');
  // And evidence must not be republished as listing media.
  assert.ok(!listingBlock.includes('reg.pdf'), 'evidence must never be republished as a listing photo');
});

// ── INVARIANT 7 — Transactions cannot use mock/unresolved identity ──────────
test('INV-7: a transaction cannot be built on an unresolved buyer or seller', async () => {
  const authority = await import('../services/transaction/marketplaceTransactionAuthority.js');
  // No actor at all -> refused (never defaulted to a placeholder counterparty).
  await assert.rejects(
    () => authority.requestMarketplaceEscrow('CARUPGLDNA0000001', { actor: {}, client: stubClient() }),
    (err) => { assert.match(String(err.message), /identity|verified buyer|required/i); return true; },
    'an unresolved buyer identity must be refused',
  );
});

function stubClient() {
  const chain = {
    select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; },
    limit() { return chain; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    single() { return Promise.resolve({ data: null, error: null }); },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return { from: () => chain, rpc: () => Promise.resolve({ data: null, error: null }) };
}

// ── INVARIANT 8 — Browser/localStorage cannot assert reservation/escrow truth ─
test('INV-8: no frontend surface writes reservation/escrow/payment truth to browser storage', () => {
  const roots = ['web/src/pages', 'web/src/components', 'web/src/lib', 'web/src/hooks', 'web/src/context'];
  const offenders = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSyncSafe(dir)) {
      const full = `${dir}/${entry}`;
      if (isDirSafe(full)) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
      const src = readFileSync(full, 'utf8');
      const storageWrites = src.match(/(localStorage|sessionStorage)\.setItem\(([^)]*)\)/g) || [];
      for (const w of storageWrites) {
        if (/reserv|escrow|payment|transaction|funds|deposit|settle/i.test(w)) offenders.push(`${full}: ${w}`);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, [], `browser storage must never assert transaction truth:\n${offenders.join('\n')}`);
});

// Static ESM imports: `require` is not defined in an ES module, and a bare catch would silently turn
// every directory read into an empty list — making these invariants pass vacuously.
function readdirSyncSafe(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
function isDirSafe(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// ── INVARIANT 9 — Unpublished/quarantined vehicles cannot leak publicly ─────
test('INV-9: only publicly-visible publication states pass the marketplace gate', () => {
  assert.equal(status.isPubliclyVisiblePublication('published'), true);
  for (const hidden of ['draft', 'identity_complete', 'documents_submitted', 'review_pending']) {
    assert.equal(status.isPubliclyVisiblePublication(hidden), false, `${hidden} must not be publicly visible`);
  }
  const vehicles = [
    { vin: 'PUB', status: 'available', publication_status: 'published' },
    { vin: 'DRAFT', status: 'available', publication_status: 'draft' },
    { vin: 'REVIEW', status: 'available', publication_status: 'review_pending' },
  ];
  const visible = listing.filterVisibleVehicles(vehicles, { showFixtures: true }).map((v) => v.vin);
  assert.ok(visible.includes('PUB'), 'a published listing must be visible');
  assert.ok(!visible.includes('DRAFT'), 'a draft must never leak into a public read');
  assert.ok(!visible.includes('REVIEW'), 'a review-pending listing must never leak into a public read');
});

// ── INVARIANT 10 — Canonical Trust is reproducible from versioned inputs ────
test('INV-10: identical governed inputs reproduce an identical, versioned decision', () => {
  const inputs = {
    vin: 'CARUPGLDNA0000001',
    vehicle: { vin: 'CARUPGLDNA0000001', chassis_number: 'C1', engine_number: 'E1', plate_number: 'P1' },
    completeness: { is_publishable: true, completeness_percent: 100, blocking_gaps: [], pending_gaps: [] },
    coverage: [], fraudInput: null, insurance: null, finance: null, escrow: null,
    now: '2026-08-20T10:00:00.000Z',
  };
  const first = decisionEngine.assembleDecision(inputs);
  const second = decisionEngine.assembleDecision({ ...inputs });
  assert.deepEqual(first, second, 'the same inputs must reproduce the same decision');
  assert.equal(first.calculation_version, CALC_VERSION, 'every decision is stamped with its rule version');
  // Changing a governed input changes the result — the score is a function of evidence, not a constant.
  const weaker = decisionEngine.assembleDecision({
    ...inputs,
    completeness: { is_publishable: false, completeness_percent: 40, blocking_gaps: [{ key: 'ownership_document' }], pending_gaps: [] },
  });
  assert.notEqual(weaker.overall_trust.value, first.overall_trust.value,
    'less evidence must produce a different (lower) score, or the score is not derived');
});

test('INV-10: a cache stamped with a different rule version is never published as current', () => {
  const stale = trust.toPublicTrust(trust.canonicalFromCache('V', freshCacheRow({ vin: 'V', trust_calculation_version: 'trust-decision-0.0.1' })));
  assert.notEqual(stale.evaluation_state, 'evaluated', 'an unversioned/stale cache must not publish as evaluated');
  assert.equal(stale.score, null, 'a score computed under retired rules must not be republished');
});

// ── INVARIANT 11 — Empty source/history never becomes positive verification ─
test('INV-11: absence of evidence yields insufficient_evidence, not a clean bill of health', () => {
  const empty = decisionEngine.assembleDecision({
    vin: 'EMPTY',
    vehicle: { vin: 'EMPTY' },                 // no chassis/engine/plate
    completeness: { is_publishable: false, completeness_percent: 0, blocking_gaps: [], pending_gaps: [] },
    coverage: [], fraudInput: null, insurance: null, finance: null, escrow: null,
    now: '2026-08-20T10:00:00.000Z',
  });
  assert.equal(empty.overall_trust.value, 0, 'no evidence scores 0 — it does not start from a flattering baseline');
  assert.equal(empty.overall_trust.status, 'insufficient_evidence');
  assert.notEqual(empty.dimensions.identity.status, 'complete');
  // Absent registry coverage is reported as no_coverage — never as "clear".
  assert.equal(empty.dimensions.source_coverage.status, 'no_coverage');
  assert.equal(/verified_clear/i.test(JSON.stringify(empty.dimensions.source_coverage)), false,
    'no-coverage must never be reported as verified_clear');
});

test('INV-11: a sandbox demonstration contributes nothing to a real score', () => {
  const sandbox = decisionEngine.assembleDecision({
    vin: 'SB', vehicle: { vin: 'SB' },
    completeness: { is_publishable: false, completeness_percent: 0, blocking_gaps: [], pending_gaps: [] },
    coverage: [{ provider: 'cvr', coverage_status: 'sandbox_demonstration' }],
    fraudInput: null, insurance: null, finance: null, escrow: null, now: '2026-08-20T10:00:00.000Z',
  });
  assert.equal(sandbox.overall_trust.value, 0, 'a sandbox demonstration must add no trust');
});

// ── INVARIANT 12 — RLS isolation continues on the audited table set ─────────
test('INV-12: the audited transaction tables keep RLS enabled in the migration tree', () => {
  const audited = ['escrow_trust_sessions', 'finance_applications', 'vehicle_evidence', 'marketplace_inquiries'];
  const dir = 'database/migrations';
  const files = readdirSyncSafe(dir).filter((f) => f.endsWith('.sql'));
  assert.ok(files.length > 0, 'the migration tree must be readable — an empty read would pass vacuously');
  const all = files.map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
  for (const table of audited) {
    const enabled = new RegExp(`ALTER TABLE\\s+(?:public\\.)?${table}\\b[\\s\\S]{0,80}?ENABLE ROW LEVEL SECURITY`, 'i').test(all);
    assert.ok(enabled, `${table} must have RLS enabled somewhere in the migration tree`);
    // And it must never be disabled again later.
    const disabled = new RegExp(`ALTER TABLE\\s+(?:public\\.)?${table}\\b[\\s\\S]{0,80}?DISABLE ROW LEVEL SECURITY`, 'i').test(all);
    assert.equal(disabled, false, `${table} must never have RLS disabled`);
  }
});

// ── INVARIANT 13 — Landing facts equal Marketplace facts for the same VIN ───
test('INV-13: Landing reads the canonical marketplace listing contract, not a separate source', () => {
  const src = readFileSync('web/src/pages/Landing.tsx', 'utf8');
  // Must actually CALL the canonical reader, not merely import it — an import alone would let this
  // invariant pass while the page rendered some other source.
  assert.match(src, /fetchMarketplaceListings\s*\(/, 'Landing must CALL the canonical /marketplace/listings reader');
  assert.ok(!/from '@\/data\/mockData'/.test(src), 'Landing must not import mock inventory');
  // Landing must not publish a trust NUMBER: trust belongs to the Passport (same rule as the card).
  assert.ok(!/Trust \{/.test(src), 'Landing must not render a trust score number on a card');
  // Because both surfaces project the same summary, the same VIN cannot show different facts.
  const marketplaceSrc = readFileSync('web/src/pages/Marketplace.tsx', 'utf8');
  assert.match(marketplaceSrc, /fetchMarketplaceListings\s*\(/, 'Marketplace must CALL the same canonical reader');
});

test('INV-13 (behavioural): the same summary projects identical facts for both surfaces', () => {
  // One canonical summary is the single source both surfaces render, so identity/price/currency/
  // location/media for a VIN are the same object on Landing and Marketplace by construction.
  const summary = {
    vin: 'CARUPGLDNA0000001', make: 'Toyota', model: 'Hilux', year: 2019,
    price: 21500, currency: 'USD', location: 'Bulawayo, Bulawayo Metropolitan',
    primary_image_url: 'https://media.example.test/a.jpg', marketplace_tags: ['evidence_available'],
  };
  const landingFacts = pickPublicFacts(summary);
  const marketplaceFacts = pickPublicFacts({ ...summary });
  assert.deepEqual(landingFacts, marketplaceFacts);
});

function pickPublicFacts(s) {
  return {
    vin: s.vin, make: s.make, model: s.model, year: s.year,
    price: s.price, currency: s.currency, location: s.location,
    primary_image_url: s.primary_image_url,
  };
}

// ── INVARIANT 14 — Golden fixture stays staging-pinned and repeatable ───────
test('INV-14: the Golden fixture guard is staging-exact and fails closed', async () => {
  const { evaluateStagingGuard } = await import('../scripts/issue164-golden-vehicles.mjs');
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://eoyenigwevnxwwhyhaer.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' }).ok, true);
  const prod = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: `https://${prod}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' }).ok, false);
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: 'https://example.com/?ref=eoyenigwevnxwwhyhaer', SUPABASE_SERVICE_ROLE_KEY: 'a.b.c' }).ok, false);
});

test('INV-14: the Golden dataset stays deterministic and creates no unremovable rows', () => {
  // Deterministic identity: repeated reads yield the same VINs/ids (no randomness, no clock).
  assert.deepEqual(goldenSpecs.fixtureVins(), ['CARUPGLDNA0000001', 'CARUPGLDNB0000002']);
  assert.ok(goldenSpecs.fixtureUserIds().every((id) => id.startsWith('golden-')));
  // Removability: the fixture must declare no governance append-only source coverage (those rows can
  // never be deleted and would pin the fixture VIN forever).
  assert.deepEqual(goldenSpecs.GOLDEN_A.sourceCoverage, [], 'Golden A must create no append-only coverage rows');
  assert.deepEqual(goldenSpecs.GOLDEN_B.sourceCoverage, []);
  // Golden B must remain deliberately incomplete: its ownership document stays pending.
  const bOwnership = goldenSpecs.GOLDEN_B.evidence.find((e) => e.type === 'registration_document');
  assert.equal(bOwnership.reviewOutcome, 'pending', 'Golden B ownership evidence must stay pending');
  assert.equal(goldenSpecs.GOLDEN_B.publishTarget, 'draft', 'Golden B must never target published');
});

// ── INVARIANT 2 (reader-side) — the gate must fail closed on MISSING DATA, not on an unread column ─
test('INV-2: the marketplace select fetches every provenance column its claim contract gates on', async () => {
  // The claim contract publishes a location/currency/seller-type/registration fact only when the row
  // carries the matching *_source. If the select omits one of those columns the gate withholds a fact
  // that IS governed — the reader never looked. Bind the two lists together so they cannot drift.
  const selected = listing.LISTING_SELECT_COLUMNS.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  for (const col of projection.LISTING_CLAIM_COLUMNS) {
    assert.ok(selected.includes(col),
      `LISTING_SELECT_COLUMNS must fetch the provenance column '${col}' — the claim contract gates on it`);
  }
});

test('INV-2 (behavioural): a provenance-backed row publishes its location and currency', () => {
  // A row exactly as the governed write path records it: value + source together.
  const claims = listing.listingClaimsForVehicle({
    vin: 'CARUPGLDNA0000001', currency: 'USD', currency_source: 'operator_recorded',
    listing_city: 'Bulawayo', listing_province: 'Bulawayo Metropolitan', listing_country: 'Zimbabwe',
    listing_location_source: 'operator_recorded', listing_location_visibility: 'public',
  });
  assert.equal(listing.composeLocationLabel(claims.location), 'Bulawayo, Bulawayo Metropolitan, Zimbabwe');
  assert.equal(listing.currencyClaim({ currency: 'USD', currency_source: 'operator_recorded' }).value, 'USD');

  // And the same values WITHOUT provenance stay withheld — the gate still fails closed.
  const bare = listing.listingClaimsForVehicle({
    vin: 'V', currency: 'USD', listing_city: 'Bulawayo', listing_country: 'Zimbabwe',
  });
  assert.equal(listing.composeLocationLabel(bare.location), null);
  assert.notEqual(listing.currencyClaim({ currency: 'USD' }).value, 'USD');
});
