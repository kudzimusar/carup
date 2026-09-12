/**
 * Issue #164 — Canonical Vehicle Truth Closure, Phase 3 permanent guard.
 *
 * Phase 0 built the canonical projection, Phase 1 converged the public reads onto it, Phase 2
 * added the derived-fact resolver. Phase 3 builds the ONE trust read path every surface will
 * consume, and this suite holds the promises that make it safe to converge onto.
 *
 * The guarantees, and the regression each test is watching for:
 *
 *   1. THE PUBLIC SHAPE IS CLOSED. `toPublicTrust` emits exactly PUBLIC_TRUST_FIELDS from every
 *      path — computed, cached, stale, unevaluated, unavailable — and never leaks the internal
 *      decision, the resolved facts or the cache descriptor. A surface that can see the raw
 *      decision will eventually render a dimension the contract never promised.
 *   2. REPRODUCIBILITY (INV-TRUST-4). The same inputs yield the same score AND the same
 *      calculation_version, replayed any number of times. A score nobody can reproduce is not
 *      auditable, which is the property that disqualified the old engine.
 *   3. ZERO EVIDENCE NEVER SCORES AS HIGH OR VERIFIED (INV-TRUST-3). The vehicle with nothing
 *      behind it scores 0 in the `insufficient_evidence` band with zero substantiated facts —
 *      and, critically, is DISTINGUISHABLE from a vehicle that was genuinely scored low, because
 *      confidence and evidence_basis are separate axes from the number (Issue #164 §8).
 *   4. A STALE CACHE IS NEVER PUBLISHED AS CANONICAL. A row whose trust_calculation_version is
 *      not the running one has its score WITHHELD — not served, not silently recomputed into the
 *      response as if it had been current. Same for the unversioned rows every production and
 *      staging vehicle carries today.
 *   5. THE BATCH PATH AND THE SINGLE PATH AGREE. One VIN yields one score wherever it is read
 *      (INV-TRUST-1), and a 48-card list costs ONE query and zero recomputes.
 *   6. THE CACHE HAS ONE WRITER, AND IT STAMPS. Nothing is persisted without the version and the
 *      instant that produced it; a non-canonical record cannot even be expressed as a patch.
 *   7. THE FACT RESOLVER IS PROVENANCE, NOT SCORE. Phase 2's resolver adds disclosure and
 *      withholds legacy claims; it cannot move the number, because that would break the replay
 *      guarantee under an unchanged CALCULATION_VERSION.
 *   8. EVERY PARTNER TRUST ENDPOINT PUBLISHES THE SAME ONE POSITION (§10). `/trust-summary` and
 *      `/decision` both carry the canonical `trust` projection and neither restates the score as
 *      `overall_trust`. Guarding only `/trust-summary` is how Blocker 2 happened: `/decision`
 *      shipped as `{decision}` alone and the whole suite stayed green.
 *   9. A FOREIGN WRITER OF trust_score CANNOT INHERIT THE STAMP (§11). The two writers that are
 *      not `refreshCanonicalTrust` null all six stamp columns in the SAME update, so the row they
 *      leave behind classifies `unversioned` and is refused; the third historical writer (the OCR
 *      approval) was retired outright by O2-X1, which §11 also pins.
 *
 * TESTING APPROACH. Every I/O dependency of the service is an injectable option with a real
 * default, so this suite runs hermetically against the SHIPPED module — no mocking of internals,
 * no re-implementation of the logic under test. Decisions are produced by the real
 * `assembleDecision`, facts by the real `resolveVehicleFacts`; only the Supabase client and the
 * clock are fakes. The env stanza below is the same one trust-decision-integration.test.js uses:
 * backend/db/supabase.js throws at import without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
 *
 * ANTI-VACUITY. Four controls, because a service that answered "not evaluated" to everything
 * would pass most of this file:
 *   · the fully-evidenced fixture must score 84 in the `high` band with all seven governed facts
 *     substantiated (test 12) — the mirror of the zero-evidence assertions;
 *   · the band vocabulary is derived by exercising `assembleDecision` across the score range and
 *     compared to TRUST_BANDS, so a drift upstream fails here (test 5);
 *   · `publicTrustViolations` must REJECT doctored shapes (test 33), or every "violations is
 *     empty" assertion elsewhere proves nothing;
 *   · the fakes are observably consumed — query counts and update payloads are asserted, so a
 *     path that silently stopped reading or writing is visible as a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { assembleDecision, CALCULATION_VERSION } = await import('../services/trustDecision/trustDecisionService.js');
const {
  PUBLIC_TRUST_FIELDS,
  EVIDENCE_BASIS_FIELDS,
  TRUST_CACHE_COLUMNS,
  TRUST_EVALUATION_STATES,
  TRUST_BANDS,
  TRUST_CONFIDENCE,
  TRUST_SOURCES,
  TRUST_CACHE_STATUS,
  RECOMPUTE,
  getCanonicalTrust,
  getCanonicalTrustBatch,
  toPublicTrust,
  refreshCanonicalTrust,
  canonicalFromDecision,
  canonicalFromCache,
  classifyCache,
  buildCachePatch,
  publicTrustViolations,
} = await import('../services/trustDecision/canonicalTrustService.js');
const { resolveVehicleFacts } = await import('../services/evidence/vehicleFactResolver.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVIDENCED_VIN = 'JTDBR32E870JJ00001';
const BARE_VIN = 'JTDBR32E870JJ00002';
const NOW = '2026-08-17T12:00:00.000Z';

/** A vehicle whose identity is complete — the +10 identity term is earned, not assumed. */
const evidencedVehicle = {
  vin: EVIDENCED_VIN,
  chassis_number: 'CH-0001',
  engine_number: 'EN-0001',
  plate_number: 'ABC1234',
};

/** A vehicle CarUp knows nothing about beyond its VIN. */
const bareVehicle = { vin: BARE_VIN };

const fullCompleteness = {
  completeness_percent: 100,
  is_publishable: true,
  publication_status: 'publishable',
  blocking_gaps: [],
  pending_gaps: [],
};

/** Three live registry connections. Sandbox rows are added to prove they contribute +0. */
const connectedCoverage = [
  { provider: 'zimra', coverage_status: 'source_connected' },
  { provider: 'cid', coverage_status: 'source_connected' },
  { provider: 'vid', coverage_status: 'partner_file_reviewed' },
  { provider: 'cvr', coverage_status: 'sandbox_demonstration' },
];

/** Authoritative rows behind all seven governed facts. */
const evidencedRows = {
  zimra_declarations: [{
    id: 'z1', vin: EVIDENCED_VIN, duty_paid_zig: 1200, duty_calculated_zig: 1200,
    customs_stamp_date: '2026-01-05', verified_at: '2026-01-06T00:00:00.000Z', customs_ref_number: 'ZW-88',
  }],
  cid_clearance_records: [{
    id: 'c1', vin: EVIDENCED_VIN, stolen_check_status: 'Cleared', cleared_at: '2026-01-07T00:00:00.000Z',
  }],
  cvr_ownership_records: [{
    id: 'r1', vin: EVIDENCED_VIN, status: 'Current', issue_date: '2026-01-02',
    registration_number: 'ABC1234', logbook_serial_number: 'ZW00991',
  }],
  vid_inspections: [{
    id: 'v1', vin: EVIDENCED_VIN, inspection_status: 'Passed', inspected_at: '2026-01-08T00:00:00.000Z',
  }],
  insurance_records: [{ id: 'i1', vin: EVIDENCED_VIN, active: true, start_date: '2026-01-01' }],
  zinara_licensing_records: [{
    id: 'n1', vin: EVIDENCED_VIN, status: 'Current', licensing_term_start: '2026-01-01',
  }],
  trust_fact_requests: [{
    id: 't1', vin: EVIDENCED_VIN, trust_fact: 'passport_verified', status: 'approved',
    reviewed_at: '2026-01-09T00:00:00.000Z',
  }],
  trust_audit_events: [{
    id: 'a1', vin: EVIDENCED_VIN, trust_fact: 'passport_verified',
    event_type: 'TRUST_FACT_APPROVED', created_at: '2026-01-09T00:00:01.000Z',
  }],
};

const readerFor = (rows) => async (table) => rows[table] || [];
const EMPTY_READ = readerFor({});

function evidencedDecision(now = NOW) {
  return assembleDecision({
    vin: EVIDENCED_VIN,
    vehicle: evidencedVehicle,
    completeness: fullCompleteness,
    coverage: connectedCoverage,
    now,
  });
}

function bareDecision(now = NOW) {
  return assembleDecision({ vin: BARE_VIN, vehicle: bareVehicle, coverage: [], now });
}

const decideWith = (decision) => {
  const calls = [];
  const fn = async (vin, opts) => { calls.push({ vin, opts }); return decision; };
  fn.calls = calls;
  return fn;
};

/**
 * A Supabase-shaped fake. It records every call, so a path that stops reading or starts writing
 * shows up as a count rather than as a silent behaviour change.
 */
function fakeClient({ vehicles = [], rows = {}, failVehicleRead = false, failUpdate = null } = {}) {
  const calls = { vehicleSelects: [], factSelects: [], updates: [] };
  const client = {
    calls,
    from(table) {
      return {
        select(columns) {
          if (table === 'vehicles') calls.vehicleSelects.push(columns);
          else calls.factSelects.push(table);
          const source = table === 'vehicles' ? vehicles : (rows[table] || []);
          const failed = failVehicleRead && table === 'vehicles';
          return {
            eq(column, value) {
              const matched = source.filter((row) => String(row[column]) === String(value));
              const settled = Promise.resolve(
                failed ? { data: null, error: { message: 'transport failure' } } : { data: matched, error: null },
              );
              settled.maybeSingle = async () => (failed
                ? { data: null, error: { message: 'transport failure' } }
                : { data: matched[0] || null, error: null });
              return settled;
            },
            in(column, values) {
              const wanted = new Set(values.map(String));
              return Promise.resolve(
                failed
                  ? { data: null, error: { message: 'transport failure' } }
                  : { data: source.filter((row) => wanted.has(String(row[column]))), error: null },
              );
            },
          };
        },
        update(patch) {
          return {
            eq(column, value) {
              calls.updates.push({ table, patch, column, value });
              return Promise.resolve(failUpdate ? { error: { message: failUpdate } } : { error: null });
            },
          };
        },
      };
    },
  };
  return client;
}

/** A cache row as the one writer would have left it. */
function freshCacheRow(overrides = {}) {
  return {
    vin: EVIDENCED_VIN,
    trust_score: 84,
    trust_calculation_version: CALCULATION_VERSION,
    trust_evaluated_at: NOW,
    trust_band: 'high',
    trust_confidence: 'high',
    trust_known_limitations: ['Some source results are SANDBOX demonstrations, not live government confirmations.'],
    trust_evidence_basis: {
      governed_facts_total: 7,
      governed_facts_substantiated: 7,
      governed_facts_adverse: 0,
      connected_sources: 3,
      unbacked_legacy_claims: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. The contract shape
// ---------------------------------------------------------------------------

test('the public contract is exactly the ten documented fields', () => {
  assert.deepEqual([...PUBLIC_TRUST_FIELDS], [
    'vin', 'score', 'band', 'evaluation_state', 'confidence', 'evidence_basis',
    'calculation_version', 'evaluated_at', 'known_limitations', 'source',
  ]);
  assert.deepEqual([...EVIDENCE_BASIS_FIELDS], [
    'governed_facts_total', 'governed_facts_substantiated', 'governed_facts_adverse',
    'connected_sources', 'unbacked_legacy_claims',
  ]);
});

test('the public shape carries no field outside the contract, from EVERY path', async () => {
  const expected = [...PUBLIC_TRUST_FIELDS].sort();
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });

  const records = {
    computed_evaluated: canonicalFromDecision(evidencedDecision(), { facts }),
    computed_zero_evidence: canonicalFromDecision(bareDecision(), { facts: null }),
    computed_off_version: canonicalFromDecision({ ...evidencedDecision(), calculation_version: 'trust-decision-0.9.0' }),
    computed_unstamped: canonicalFromDecision(assembleDecision({ vin: BARE_VIN, vehicle: bareVehicle })),
    cache_fresh: canonicalFromCache(EVIDENCED_VIN, freshCacheRow()),
    cache_stale: canonicalFromCache(EVIDENCED_VIN, freshCacheRow({ trust_calculation_version: 'trust-decision-0.9.0' })),
    cache_unversioned: canonicalFromCache(EVIDENCED_VIN, { vin: EVIDENCED_VIN, trust_score: 84 }),
    cache_absent: canonicalFromCache(EVIDENCED_VIN, null),
    malformed: canonicalFromDecision(null),
    read_failure: await getCanonicalTrust(EVIDENCED_VIN, {
      client: fakeClient({ failVehicleRead: true }), recompute: RECOMPUTE.NEVER,
    }),
  };

  for (const [label, record] of Object.entries(records)) {
    const shape = toPublicTrust(record);
    assert.deepEqual(Object.keys(shape).sort(), expected, `${label} published an off-contract key set`);
    assert.deepEqual(publicTrustViolations(shape), [], `${label} violated the contract`);
  }
});

test('the internal decision, facts and cache descriptor never reach a public surface', async () => {
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });
  const record = canonicalFromDecision(evidencedDecision(), { facts, cache: { status: 'absent' } });

  assert.ok(record.decision, 'the record must retain the decision for auditors');
  assert.ok(record.facts, 'the record must retain the resolved facts for auditors');

  const shape = toPublicTrust(record);
  assert.equal(shape.decision, undefined);
  assert.equal(shape.facts, undefined);
  assert.equal(shape.cache, undefined);
  assert.equal(JSON.stringify(shape).includes('"dimensions"'), false);
});

test('toPublicTrust accepts a raw trust decision, so no caller needs a second projection', () => {
  const decision = evidencedDecision();
  const fromDecision = toPublicTrust(decision);
  const fromRecord = toPublicTrust(canonicalFromDecision(decision));
  assert.deepEqual(fromDecision, fromRecord);
  assert.equal(fromDecision.score, decision.overall_trust.value);
  assert.equal(fromDecision.band, decision.overall_trust.status);
});

test('the band vocabulary is the decision engine\'s own, not a parallel one', () => {
  // Derived by exercising the real scorer across the range, so a change to scoreBand upstream
  // fails here instead of drifting into a second vocabulary.
  const produced = new Set([
    assembleDecision({ vin: 'B0', vehicle: bareVehicle, coverage: [], now: NOW }).overall_trust.status,
    assembleDecision({
      vin: 'B1', vehicle: bareVehicle, coverage: [],
      completeness: { completeness_percent: 20, is_publishable: false, publication_status: 'incomplete', blocking_gaps: [] },
      now: NOW,
    }).overall_trust.status,
    assembleDecision({ vin: 'B2', vehicle: bareVehicle, coverage: [], completeness: fullCompleteness, now: NOW }).overall_trust.status,
    evidencedDecision().overall_trust.status,
  ]);
  assert.deepEqual([...produced].sort(), [...TRUST_BANDS].sort());
  assert.ok(TRUST_BANDS.includes('insufficient_evidence'), 'insufficient_evidence must stay in the vocabulary');
});

test('confidence and evaluation state are separate axes from the number', () => {
  assert.deepEqual([...TRUST_CONFIDENCE], ['high', 'medium', 'low', 'not_evaluated']);
  assert.deepEqual(Object.values(TRUST_EVALUATION_STATES), ['evaluated', 'stale', 'not_evaluated', 'unavailable']);
  assert.deepEqual([...TRUST_SOURCES], ['computed', 'cache', 'none']);
});

// ---------------------------------------------------------------------------
// 2. Reproducibility — INV-TRUST-4
// ---------------------------------------------------------------------------

test('the same inputs reproduce the same score AND the same calculation version', () => {
  const runs = [1, 2, 3].map(() => toPublicTrust(canonicalFromDecision(evidencedDecision())));
  for (const run of runs.slice(1)) assert.deepEqual(run, runs[0]);
  assert.equal(runs[0].calculation_version, CALCULATION_VERSION);
  assert.ok(Number.isFinite(runs[0].score));
});

test('reproducibility survives the facts being resolved in a different row order', async () => {
  const reversed = Object.fromEntries(
    Object.entries(evidencedRows).map(([table, rows]) => [table, [...rows].reverse()]),
  );
  const a = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });
  const b = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(reversed), vehicle: evidencedVehicle });
  assert.deepEqual(
    toPublicTrust(canonicalFromDecision(evidencedDecision(), { facts: a })),
    toPublicTrust(canonicalFromDecision(evidencedDecision(), { facts: b })),
  );
});

test('a decision replayed from recorded inputs yields the identical record', async () => {
  const client = fakeClient({ vehicles: [], rows: evidencedRows });
  const decide = decideWith(evidencedDecision());
  const first = await getCanonicalTrust(EVIDENCED_VIN, { client, decide, recompute: RECOMPUTE.ALWAYS });
  const second = await getCanonicalTrust(EVIDENCED_VIN, { client, decide, recompute: RECOMPUTE.ALWAYS });
  assert.deepEqual(toPublicTrust(first), toPublicTrust(second));
  assert.equal(decide.calls.length, 2, 'recompute:always must actually recompute both times');
});

// ---------------------------------------------------------------------------
// 3. Zero evidence — INV-TRUST-3, principle 9
// ---------------------------------------------------------------------------

test('a vehicle with zero evidence scores 0 in the insufficient_evidence band', async () => {
  const facts = await resolveVehicleFacts(BARE_VIN, { read: EMPTY_READ, vehicle: bareVehicle });
  const shape = toPublicTrust(canonicalFromDecision(bareDecision(), { facts }));

  assert.equal(shape.score, 0);
  assert.equal(shape.band, 'insufficient_evidence');
  assert.notEqual(shape.band, 'high');
  assert.equal(shape.confidence, 'not_evaluated');
  assert.equal(shape.evidence_basis.governed_facts_substantiated, 0);
  assert.equal(shape.evidence_basis.connected_sources, 0);
  assert.ok(shape.known_limitations.some((line) => /no governed vehicle fact/i.test(line)));
  assert.ok(shape.known_limitations.some((line) => /no live government\/partner source/i.test(line)));
});

test('an unevidenced vehicle is distinguishable from one genuinely scored low', async () => {
  const unevidencedFacts = await resolveVehicleFacts(BARE_VIN, { read: EMPTY_READ, vehicle: bareVehicle });
  const unevidenced = toPublicTrust(canonicalFromDecision(bareDecision(), { facts: unevidencedFacts }));

  // Real evidence, real registry connections, and a real adverse finding that drags the score
  // down. The NUMBER is low in both cases; only the other axes tell them apart.
  const adverseRows = {
    ...evidencedRows,
    cid_clearance_records: [{
      id: 'c9', vin: EVIDENCED_VIN, stolen_check_status: 'Flagged_Stolen', cleared_at: '2026-02-01T00:00:00.000Z',
    }],
  };
  const scoredLowFacts = await resolveVehicleFacts(EVIDENCED_VIN, {
    read: readerFor(adverseRows), vehicle: evidencedVehicle,
  });
  const scoredLow = toPublicTrust(canonicalFromDecision(assembleDecision({
    vin: EVIDENCED_VIN,
    vehicle: evidencedVehicle,
    completeness: { completeness_percent: 60, is_publishable: false, publication_status: 'incomplete', blocking_gaps: ['insurance'] },
    coverage: [
      { provider: 'zimra', coverage_status: 'source_connected' },
      { provider: 'cid', coverage_status: 'risk_flagged' },
    ],
    now: NOW,
  }), { facts: scoredLowFacts }));

  assert.equal(unevidenced.confidence, 'not_evaluated');
  assert.equal(scoredLow.confidence, 'medium');
  assert.equal(unevidenced.evidence_basis.governed_facts_substantiated, 0);
  assert.ok(scoredLow.evidence_basis.governed_facts_substantiated > 0);
  assert.ok(scoredLow.evidence_basis.governed_facts_adverse > 0);
  assert.ok(scoredLow.evidence_basis.connected_sources > unevidenced.evidence_basis.connected_sources);
  assert.notEqual(unevidenced.band, 'high');
  assert.notEqual(scoredLow.band, 'high');
});

test('nothing adds a floor, a baseline or a fallback to a zero score', async () => {
  const client = fakeClient({
    // The legacy hand-set value is present on the row and must not be reachable as a fallback.
    vehicles: [{ vin: BARE_VIN, trust_score: 84 }],
  });
  const record = await getCanonicalTrust(BARE_VIN, {
    client, decide: decideWith(bareDecision()), read: EMPTY_READ,
  });
  const shape = toPublicTrust(record);
  assert.equal(shape.score, 0, 'the stored 84 must never be substituted for the computed 0');
  assert.equal(shape.source, 'computed');
});

test('an empty ledger and zero source coverage are never scored as verified', () => {
  const shape = toPublicTrust(canonicalFromDecision(bareDecision()));
  assert.equal(shape.score, 0);
  assert.notEqual(shape.evaluation_state, TRUST_EVALUATION_STATES.STALE);
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.EVALUATED);
  assert.ok(shape.known_limitations.length > 0, 'a score of 0 must arrive with its limitations');
});

// ---------------------------------------------------------------------------
// 4. Anti-vacuity — the fully evidenced fixture must score high
// ---------------------------------------------------------------------------

test('ANTI-VACUITY: a fully evidenced vehicle scores high with all seven facts substantiated', async () => {
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });
  const shape = toPublicTrust(canonicalFromDecision(evidencedDecision(), { facts }));

  // completeness 100% (+50) + 3 connected sources (+24) + complete identity (+10) = 84,
  // the number the UAT fixture used to hand-write. Here it is earned.
  assert.equal(shape.score, 84);
  assert.equal(shape.band, 'high');
  assert.equal(shape.confidence, 'high');
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.EVALUATED);
  assert.equal(shape.evidence_basis.governed_facts_total, 7);
  assert.equal(shape.evidence_basis.governed_facts_substantiated, 7);
  assert.equal(shape.evidence_basis.governed_facts_adverse, 0);
  assert.equal(shape.evidence_basis.connected_sources, 3);
});

test('a sandbox source contributes nothing to the canonical score', () => {
  const withoutSandbox = assembleDecision({
    vin: EVIDENCED_VIN,
    vehicle: evidencedVehicle,
    completeness: fullCompleteness,
    coverage: connectedCoverage.filter((row) => row.coverage_status !== 'sandbox_demonstration'),
    now: NOW,
  });
  assert.equal(
    toPublicTrust(canonicalFromDecision(withoutSandbox)).score,
    toPublicTrust(canonicalFromDecision(evidencedDecision())).score,
  );
  assert.ok(
    toPublicTrust(canonicalFromDecision(evidencedDecision())).known_limitations
      .some((line) => /SANDBOX/.test(line)),
    'the sandbox source must still be disclosed even though it scores +0',
  );
});

// ---------------------------------------------------------------------------
// 5. Cache discipline and staleness
// ---------------------------------------------------------------------------

test('cache classification: only a complete, current-version row is fresh', () => {
  assert.equal(classifyCache(freshCacheRow()), TRUST_CACHE_STATUS.FRESH);
  assert.equal(classifyCache(null), TRUST_CACHE_STATUS.ABSENT);
  assert.equal(classifyCache({ vin: EVIDENCED_VIN, trust_score: 84 }), TRUST_CACHE_STATUS.UNVERSIONED);
  assert.equal(
    classifyCache(freshCacheRow({ trust_calculation_version: 'trust-decision-0.9.0' })),
    TRUST_CACHE_STATUS.STALE,
  );
  for (const broken of [
    { trust_score: null },
    { trust_evaluated_at: null },
    { trust_band: 'excellent' },
    { trust_confidence: 'pretty_sure' },
  ]) {
    assert.equal(classifyCache(freshCacheRow(broken)), TRUST_CACHE_STATUS.INCOMPLETE, JSON.stringify(broken));
  }
});

test('a stale cache version is NEVER published as canonical', () => {
  const stale = freshCacheRow({ trust_calculation_version: 'trust-decision-0.9.0' });
  const shape = toPublicTrust(canonicalFromCache(EVIDENCED_VIN, stale));

  assert.equal(shape.score, null, 'a score computed under different rules must be withheld');
  assert.equal(shape.band, null);
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.STALE);
  assert.equal(shape.calculation_version, 'trust-decision-0.9.0');
  assert.ok(shape.known_limitations.some((line) => line.includes('trust-decision-0.9.0') && line.includes(CALCULATION_VERSION)));
  assert.deepEqual(publicTrustViolations(shape), []);
});

test('only the version differs and the score is still withheld', () => {
  const fresh = toPublicTrust(canonicalFromCache(EVIDENCED_VIN, freshCacheRow()));
  const stale = toPublicTrust(canonicalFromCache(EVIDENCED_VIN, freshCacheRow({ trust_calculation_version: 'x' })));
  assert.equal(fresh.score, 84);
  assert.equal(stale.score, null, 'the version is the only difference and it must be decisive');
});

test('an unversioned legacy score — every row on staging today — is not published', () => {
  // Measured: 16 of 16 staging vehicles carry a trust_score (50.0 .. 96.8) and none carries a
  // version, because the four legacy writers stamp nothing.
  for (const legacy of [50, 74, 80, 84, 90, 96.8]) {
    const shape = toPublicTrust(canonicalFromCache(EVIDENCED_VIN, { vin: EVIDENCED_VIN, trust_score: legacy }));
    assert.equal(shape.score, null, `the unversioned ${legacy} must not be published`);
    assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.NOT_EVALUATED);
    assert.ok(shape.known_limitations.some((line) => /predates the canonical trust authority/.test(line)));
  }
});

test('a stale cache is recomputed rather than served by the single read path', async () => {
  const client = fakeClient({ vehicles: [freshCacheRow({ trust_calculation_version: 'trust-decision-0.9.0' })] });
  const decide = decideWith(evidencedDecision());
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, { client, decide, read: readerFor(evidencedRows) }));

  assert.equal(decide.calls.length, 1, 'a stale cache must trigger exactly one recompute');
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.EVALUATED);
  assert.equal(shape.source, 'computed');
  assert.equal(shape.calculation_version, CALCULATION_VERSION);
});

test('a fresh cache is served without a recompute', async () => {
  const client = fakeClient({ vehicles: [freshCacheRow()] });
  const decide = decideWith(evidencedDecision());
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, { client, decide }));

  assert.equal(decide.calls.length, 0, 'a fresh cache entry must not be recomputed');
  assert.equal(shape.source, 'cache');
  assert.equal(shape.score, 84);
});

test('recompute:never reports the cache state instead of computing', async () => {
  const client = fakeClient({ vehicles: [{ vin: EVIDENCED_VIN, trust_score: 96.8 }] });
  const decide = decideWith(evidencedDecision());
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, { client, decide, recompute: RECOMPUTE.NEVER }));

  assert.equal(decide.calls.length, 0);
  assert.equal(shape.score, null);
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.NOT_EVALUATED);
});

test('a decision produced under a foreign version is reported stale even when freshly computed', () => {
  const shape = toPublicTrust(canonicalFromDecision({
    ...evidencedDecision(), calculation_version: 'trust-decision-2.0.0',
  }));
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.STALE);
  assert.equal(shape.score, null);
});

test('an unstamped decision is not canonical and is never published', () => {
  const shape = toPublicTrust(canonicalFromDecision(assembleDecision({
    vin: EVIDENCED_VIN, vehicle: evidencedVehicle, completeness: fullCompleteness, coverage: connectedCoverage,
  })));
  assert.equal(shape.evaluated_at, null);
  assert.equal(shape.score, null);
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.NOT_EVALUATED);
  assert.ok(shape.known_limitations.some((line) => /no evaluation timestamp/.test(line)));
});

test('a failed cache read reports unavailable, never "not evaluated"', async () => {
  const client = fakeClient({ failVehicleRead: true });
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, { client, recompute: RECOMPUTE.NEVER }));
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.UNAVAILABLE);
  assert.equal(shape.score, null);
  assert.equal(shape.source, 'none');
});

test('a failed decision reports unavailable rather than a fabricated score', async () => {
  const client = fakeClient({ vehicles: [] });
  const failing = async () => { throw new Error('coverage lookup failed'); };
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, { client, decide: failing, read: EMPTY_READ }));
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.UNAVAILABLE);
  assert.equal(shape.score, null);
});

// ---------------------------------------------------------------------------
// 6. The batch path
// ---------------------------------------------------------------------------

test('a 48-VIN list costs ONE query and zero recomputes', async () => {
  const vins = Array.from({ length: 48 }, (_, i) => `VIN${String(i).padStart(5, '0')}`);
  const client = fakeClient({
    vehicles: vins.map((vin, i) => freshCacheRow({ vin, trust_score: 40 + i, trust_band: 'moderate' })),
  });
  const decide = decideWith(evidencedDecision());

  const map = await getCanonicalTrustBatch(vins, { client, decide });

  assert.equal(client.calls.vehicleSelects.length, 1, 'a list must not fan out into per-VIN queries');
  assert.equal(client.calls.factSelects.length, 0, 'the list path must not resolve provenance per card');
  assert.equal(decide.calls.length, 0, 'the batch path takes no decide and must never recompute');
  assert.equal(client.calls.updates.length, 0, 'a read must never write');
  assert.equal(map.size, 48);
});

test('every requested VIN gets an entry, including the ones with no evaluation', async () => {
  const client = fakeClient({ vehicles: [freshCacheRow()] });
  const map = await getCanonicalTrustBatch([EVIDENCED_VIN, BARE_VIN, '  ', null, EVIDENCED_VIN], { client });

  assert.deepEqual([...map.keys()], [EVIDENCED_VIN, BARE_VIN]);
  assert.equal(map.get(EVIDENCED_VIN).score, 84);
  assert.equal(map.get(BARE_VIN).score, null);
  assert.equal(map.get(BARE_VIN).evaluation_state, TRUST_EVALUATION_STATES.NOT_EVALUATED);
});

test('the batch path withholds a stale entry exactly as the single path does', async () => {
  const stale = freshCacheRow({ trust_calculation_version: 'trust-decision-0.9.0' });
  const client = fakeClient({ vehicles: [stale] });
  const batch = toPublicTrust((await getCanonicalTrustBatch([EVIDENCED_VIN], { client })).get(EVIDENCED_VIN));
  const single = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, {
    client: fakeClient({ vehicles: [stale] }), recompute: RECOMPUTE.NEVER,
  }));
  assert.deepEqual(batch, single);
  assert.equal(batch.score, null);
});

test('the batch path and the single path agree for the same VIN', async () => {
  const row = freshCacheRow();
  const batch = await getCanonicalTrustBatch([EVIDENCED_VIN], { client: fakeClient({ vehicles: [row] }) });
  const single = await getCanonicalTrust(EVIDENCED_VIN, { client: fakeClient({ vehicles: [row] }) });
  assert.deepEqual(toPublicTrust(batch.get(EVIDENCED_VIN)), toPublicTrust(single));
});

test('a recomputed decision and the cache it produced agree on score, band and version', async () => {
  const decision = evidencedDecision();
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });
  const computed = canonicalFromDecision(decision, { facts });
  const patch = buildCachePatch(computed);

  const cached = canonicalFromCache(EVIDENCED_VIN, { vin: EVIDENCED_VIN, ...patch });
  const a = toPublicTrust(computed);
  const b = toPublicTrust(cached);

  for (const field of PUBLIC_TRUST_FIELDS) {
    if (field === 'source') continue; // the one field that MUST differ — it names the origin
    assert.deepEqual(b[field], a[field], `round-tripping through the cache changed ${field}`);
  }
  assert.equal(a.source, 'computed');
  assert.equal(b.source, 'cache');
});

test('a failed batch read marks the chunk unavailable rather than unevaluated', async () => {
  const client = fakeClient({ failVehicleRead: true });
  const map = await getCanonicalTrustBatch([EVIDENCED_VIN, BARE_VIN], { client });
  for (const record of map.values()) {
    assert.equal(record.evaluation_state, TRUST_EVALUATION_STATES.UNAVAILABLE);
    assert.equal(record.score, null);
  }
});

test('the batch read chunks, and every chunk is one query', async () => {
  const vins = Array.from({ length: 7 }, (_, i) => `CH${i}`);
  const client = fakeClient({ vehicles: [] });
  await getCanonicalTrustBatch(vins, { client, chunkSize: 3 });
  assert.equal(client.calls.vehicleSelects.length, 3, '7 VINs at 3 per chunk is 3 queries');
});

// ---------------------------------------------------------------------------
// 7. The single writer
// ---------------------------------------------------------------------------

test('the cache patch stamps the version, the instant and the whole projection together', async () => {
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });
  const patch = buildCachePatch(canonicalFromDecision(evidencedDecision(), { facts }));

  assert.deepEqual(Object.keys(patch).sort(), [
    'trust_band', 'trust_calculation_version', 'trust_confidence', 'trust_evaluated_at',
    'trust_evidence_basis', 'trust_known_limitations', 'trust_score',
  ]);
  assert.equal(patch.trust_score, 84);
  assert.equal(patch.trust_calculation_version, CALCULATION_VERSION);
  assert.equal(patch.trust_evaluated_at, NOW);
  assert.equal(patch.trust_band, 'high');
  // Every patched column exists in the declared cache column set, minus the vin key.
  for (const column of Object.keys(patch)) assert.ok(TRUST_CACHE_COLUMNS.includes(column), column);
});

test('a non-canonical record cannot even be expressed as a cache patch', () => {
  assert.equal(buildCachePatch(canonicalFromCache(EVIDENCED_VIN, null)), null, 'absent');
  assert.equal(buildCachePatch(canonicalFromCache(EVIDENCED_VIN, { vin: EVIDENCED_VIN, trust_score: 84 })), null, 'unversioned');
  assert.equal(
    buildCachePatch(canonicalFromCache(EVIDENCED_VIN, freshCacheRow({ trust_calculation_version: 'old' }))),
    null,
    'stale',
  );
  assert.equal(buildCachePatch(canonicalFromDecision(null)), null, 'malformed');
  assert.equal(buildCachePatch({ ...canonicalFromDecision(evidencedDecision()), calculation_version: 'old' }), null, 'off-version');
  assert.equal(buildCachePatch(null), null);
});

test('refreshCanonicalTrust is the one writer and it writes once, stamped', async () => {
  const client = fakeClient({ vehicles: [{ vin: EVIDENCED_VIN, trust_score: 96.8 }] });
  const result = await refreshCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), read: readerFor(evidencedRows),
  });

  assert.equal(result.written, true);
  assert.equal(client.calls.updates.length, 1);
  const [write] = client.calls.updates;
  assert.equal(write.table, 'vehicles');
  assert.equal(write.column, 'vin');
  assert.equal(write.value, EVIDENCED_VIN);
  assert.equal(write.patch.trust_score, 84, 'the cache must take the canonical value, not the stored 96.8');
  assert.equal(write.patch.trust_calculation_version, CALCULATION_VERSION);
  assert.ok(write.patch.trust_evaluated_at);
});

test('a dry run produces the patch and writes nothing', async () => {
  const client = fakeClient({ vehicles: [] });
  const result = await refreshCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), read: EMPTY_READ, dryRun: true,
  });
  assert.equal(result.written, false);
  assert.equal(result.reason, 'dry_run');
  assert.ok(result.patch);
  assert.equal(client.calls.updates.length, 0);
});

test('a non-canonical decision is refused rather than cached', async () => {
  const client = fakeClient({ vehicles: [] });
  const result = await refreshCanonicalTrust(EVIDENCED_VIN, {
    client,
    decide: decideWith({ ...evidencedDecision(), calculation_version: 'trust-decision-0.9.0' }),
    read: EMPTY_READ,
  });
  assert.equal(result.written, false);
  assert.equal(result.patch, null);
  assert.match(result.reason, /^not_canonical:stale$/);
  assert.equal(client.calls.updates.length, 0);
});

test('a write failure is reported, never swallowed into a false success', async () => {
  const client = fakeClient({ vehicles: [], failUpdate: 'permission denied' });
  const result = await refreshCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), read: EMPTY_READ,
  });
  assert.equal(result.written, false);
  assert.match(result.reason, /^write_failed:permission denied$/);
});

test('reads never write, on any path', async () => {
  const client = fakeClient({ vehicles: [{ vin: EVIDENCED_VIN, trust_score: 84 }] });
  await getCanonicalTrust(EVIDENCED_VIN, { client, decide: decideWith(evidencedDecision()), read: EMPTY_READ });
  await getCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), read: EMPTY_READ, recompute: RECOMPUTE.ALWAYS,
  });
  await getCanonicalTrustBatch([EVIDENCED_VIN], { client });
  assert.equal(client.calls.updates.length, 0);
});

// ---------------------------------------------------------------------------
// 8. The fact resolver as provenance, not score
// ---------------------------------------------------------------------------

test('the fact resolver is wired in and its provenance reaches the public shape', async () => {
  const client = fakeClient({ vehicles: [{ vin: EVIDENCED_VIN, trust_score: 84 }], rows: evidencedRows });
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), recompute: RECOMPUTE.ALWAYS,
  }));

  assert.ok(client.calls.factSelects.length > 0, 'the default fact reader must actually query the authorities');
  assert.equal(shape.evidence_basis.governed_facts_substantiated, 7);
});

test('an unbacked legacy boolean is disclosed and cannot verify anything', async () => {
  // police_verified: true with no CID record. Phase 2 proved the one writer of that flag means
  // "was stolen, then recovered" while the marketplace renders it as a clearance. duty_paid and
  // zimra_verified are the two badges the marketplace ranks as independent corroboration while
  // both cache the same (here, non-existent) ZIMRA declaration.
  const vehicle = { ...evidencedVehicle, police_verified: true, duty_paid: true, zimra_verified: true };
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: EMPTY_READ, vehicle });
  const shape = toPublicTrust(canonicalFromDecision(evidencedDecision(), { facts }));

  assert.equal(shape.evidence_basis.unbacked_legacy_claims, 3, 'duty_paid, zimra_verified and police_verified');
  assert.ok(shape.known_limitations.some((line) => /'police_verified'/.test(line)));
  assert.ok(shape.known_limitations.some((line) => /'duty_paid'/.test(line)));
  assert.equal(shape.evidence_basis.governed_facts_substantiated, 0);
});

test('the facts change disclosure but never the score — assembleDecision stays the authority', async () => {
  const decision = evidencedDecision();
  const none = canonicalFromDecision(decision, { facts: null });
  const empty = canonicalFromDecision(decision, {
    facts: await resolveVehicleFacts(EVIDENCED_VIN, { read: EMPTY_READ, vehicle: evidencedVehicle }),
  });
  const full = canonicalFromDecision(decision, {
    facts: await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle }),
  });

  assert.equal(none.score, decision.overall_trust.value);
  assert.equal(empty.score, decision.overall_trust.value);
  assert.equal(full.score, decision.overall_trust.value);
  assert.equal(none.calculation_version, full.calculation_version);
  // What the facts DO change: the disclosure and the provenance counts.
  assert.equal(none.evidence_basis.governed_facts_total, null, 'unresolved must be null, never 0');
  assert.equal(empty.evidence_basis.governed_facts_substantiated, 0);
  assert.equal(full.evidence_basis.governed_facts_substantiated, 7);
  assert.ok(none.known_limitations.some((line) => /provenance was not resolved/.test(line)));
});

test('a registry outage yields unsubstantiated facts, never a fabricated score or claim', async () => {
  // Phase 2's loadFactInputs degrades ONE unreadable source to no rows, which resolves to
  // unknown — so an outage lands as "nothing is backed", not as a failure of the whole read and
  // not as a claim. The score is the decision engine's and is unaffected.
  const client = fakeClient({ vehicles: [] });
  const exploding = async () => { throw new Error('registry unreachable'); };
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), read: exploding,
  }));
  assert.equal(shape.score, 84);
  assert.equal(shape.evidence_basis.governed_facts_total, 7);
  assert.equal(shape.evidence_basis.governed_facts_substantiated, 0);
  assert.equal(shape.evidence_basis.connected_sources, 3);
  assert.ok(shape.known_limitations.some((line) => /no governed vehicle fact/i.test(line)));
});

test('skipping provenance entirely reports null counts, never zeroes', async () => {
  const client = fakeClient({ vehicles: [] });
  const shape = toPublicTrust(await getCanonicalTrust(EVIDENCED_VIN, {
    client, decide: decideWith(evidencedDecision()), read: null,
  }));
  assert.equal(client.calls.factSelects.length, 0, 'read:null must skip the authorities entirely');
  assert.equal(shape.score, 84);
  assert.equal(shape.evidence_basis.governed_facts_total, null, '"not asked" is not "asked and found none"');
  assert.equal(shape.evidence_basis.governed_facts_substantiated, null);
  assert.ok(shape.known_limitations.some((line) => /provenance was not resolved/.test(line)));
});

// ---------------------------------------------------------------------------
// 9. The guard itself must not be vacuous
// ---------------------------------------------------------------------------

test('ANTI-VACUITY: publicTrustViolations rejects doctored shapes', () => {
  const good = toPublicTrust(canonicalFromDecision(evidencedDecision()));
  assert.deepEqual(publicTrustViolations(good), []);

  const cases = [
    [{ ...good, trust_score: 84 }, 'unknown_field:trust_score'],
    [{ ...good, evaluation_state: TRUST_EVALUATION_STATES.NOT_EVALUATED }, 'score_published_without_evaluation'],
    [{ ...good, calculation_version: 'trust-decision-0.9.0' }, 'score_published_off_version'],
    [{ ...good, evaluated_at: null }, 'score_published_without_timestamp'],
    [{ ...good, band: null }, 'score_published_without_band'],
    [{ ...good, score: 140 }, 'score_out_of_range'],
    [{ ...good, score: null, band: 'high' }, 'band_without_score'],
    [{ ...good, band: 'excellent' }, 'band_outside_vocabulary'],
    [{ ...good, confidence: 'very_sure' }, 'confidence_outside_vocabulary'],
    [{ ...good, evaluation_state: 'probably_fine' }, 'evaluation_state_outside_vocabulary'],
    [{ ...good, source: 'guessed' }, 'source_outside_vocabulary'],
    [{ ...good, known_limitations: 'none' }, 'known_limitations_not_an_array'],
    [{ ...good, known_limitations: [42] }, 'known_limitations_not_strings'],
    [{ ...good, evidence_basis: { ...good.evidence_basis, vibes: 9 } }, 'evidence_basis_unknown_field:vibes'],
    [{ ...good, evidence_basis: { connected_sources: 3 } }, 'evidence_basis_missing_field:governed_facts_total'],
  ];
  for (const [shape, expected] of cases) {
    assert.ok(
      publicTrustViolations(shape).includes(expected),
      `expected ${expected} for ${JSON.stringify(shape).slice(0, 90)}`,
    );
  }

  const { score, ...missingScore } = good;
  assert.ok(publicTrustViolations(missingScore).includes('missing_field:score'));
  assert.deepEqual(publicTrustViolations(null), ['missing_shape']);
});

test('the fixtures are observably consumed', async () => {
  const facts = await resolveVehicleFacts(EVIDENCED_VIN, { read: readerFor(evidencedRows), vehicle: evidencedVehicle });
  assert.equal(Object.keys(facts).length, 7);
  assert.equal(facts.customs_duty.provenance[0].ref, 'z1', 'the fixture row must be the one that was read');
  assert.equal(facts.police_clearance.provenance[0].ref, 'c1');
  assert.equal(evidencedDecision().dimensions.source_coverage.connected, 3);
});

test('the public record is frozen, so a surface cannot mutate the contract in place', () => {
  const shape = toPublicTrust(canonicalFromDecision(evidencedDecision()));
  assert.throws(() => { shape.score = 100; }, TypeError);
  assert.throws(() => { shape.known_limitations.push('made up'); }, TypeError);
});

// ===========================================================================================
// 10. THE PARTNER API — BOTH trust endpoints, ONE position.
//
// backend/routes/partnerApiRoutes.js serves two endpoints that speak about trust:
//
//   GET /api/partner/v1/vehicles/:vin/trust-summary   scope vehicle:trust
//   GET /api/partner/v1/vehicles/:vin/decision        scope trust:read
//
// They share `partnerTrustPayload`, which returns `{trust, decision}`: `trust` is the canonical
// ten-field projection read CACHE-ONLY from this service, `decision` is the redacted explanation
// (`toPublicDecision`, which deliberately carries NO overall_trust).
//
// Only `/trust-summary` was guarded. `/decision` could be reverted to its pre-Phase-3 shape —
// `{decision: toPublicDecision(...)}`, no canonical position at all, the exact Blocker-2 defect —
// and the entire backend suite stayed green. These tests close that: a partner must never be handed
// a position that disagrees with the OTHER partner endpoint or with the marketplace list, and
// neither body may restate the score as a second answer.
//
// The assertions are made against the SHIPPED shared checker (`publicTrustViolations`) and against
// the imported PUBLIC_TRUST_FIELDS, not against a hand-copied field list — a contract restated by
// hand in a test is a second contract that can drift.
// ===========================================================================================

const express = (await import('express')).default;
const http = (await import('node:http')).default;
const partnerRouter = (await import('../routes/partnerApiRoutes.js')).default;
const partnerErrorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createPartnerClient } = await import('../services/partner/partnerAuthService.js');
const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { TrustEnforcementEngine } = await import('../services/trust-service/trustEnforcementEngine.js');

/**
 * An in-memory stand-in for the service-role client, for the two things in §10/§11 that read the
 * SINGLETON rather than an injected client: the partner routes and the three foreign writers.
 * Everything above this line injects `client` explicitly and never touches the singleton, so
 * installing this at module scope changes nothing for tests 1–35.
 *
 * It is a store, not a mock of the code under test: updates really mutate the row, so a write that
 * stopped nulling a column is observable as that column's value.
 */
let memoryDb = {};

function memoryRun(state) {
  const ok = (data) => ({ data, error: null });
  const rows = (memoryDb[state.table] = memoryDb[state.table] || []);
  const matches = (row) => Object.entries(state.filters)
    .every(([column, value]) => String(row[column]) === String(value));

  if (state.op === 'insert') {
    const list = Array.isArray(state.payload) ? state.payload : [state.payload];
    const inserted = list.map((row, i) => ({
      id: row.id || `${state.table}-${rows.length + i + 1}`,
      created_at: `2026-08-17T12:0${rows.length + i}:00.000Z`,
      ...row,
    }));
    rows.push(...inserted);
    return ok(state.single ? inserted[0] : inserted);
  }
  if (state.op === 'update') {
    let updated = null;
    for (const row of rows) if (matches(row)) { Object.assign(row, state.payload); updated = row; }
    return ok(state.single ? updated : (updated ? [updated] : []));
  }

  let out = rows.filter(matches);
  if (state.in) out = out.filter((row) => state.in.values.has(String(row[state.in.column])));
  if (state.order) {
    out = out.slice().sort((a, b) => (state.order.asc ? 1 : -1) * (a[state.order.col] > b[state.order.col] ? 1 : -1));
  }
  if (state.maybe) return ok(out[0] || null);
  if (state.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}

function memoryBuilder(table) {
  const state = { table, op: 'select', filters: {}, in: null, single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
    update(payload) { state.op = 'update'; state.payload = payload; return chain; },
    eq(column, value) { state.filters[column] = value; return chain; },
    in(column, values) { state.in = { column, values: new Set(values.map(String)) }; return chain; },
    order(col, opts) { state.order = { col, asc: opts?.ascending ?? false }; return chain; },
    single() { state.single = true; return chain; },
    maybeSingle() { state.maybe = true; return chain; },
    then(resolve, reject) {
      try { return Promise.resolve(memoryRun(state)).then(resolve, reject); }
      catch (err) { return reject ? reject(err) : Promise.reject(err); }
    },
  };
  return chain;
}

supabase.from = (table) => memoryBuilder(table);

function seedDb(tables) {
  memoryDb = { partner_clients: [], partner_api_requests: [], ...tables };
  return memoryDb;
}

const partnerApp = (() => {
  const app = express();
  app.use(express.json());
  app.use(partnerRouter);
  app.use(partnerErrorHandler);
  return app;
})();

function partnerGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const server = partnerApp.listen(0, () => {
      const { port } = server.address();
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'GET', headers: { 'x-api-key': apiKey } },
        (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
        },
      );
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
  });
}

const PARTNER_VIN = 'JTDBR32E870JJ00007';

/** The stamped cache row the partner endpoints are expected to publish verbatim. */
function partnerVehicleRow(overrides = {}) {
  return freshCacheRow({
    vin: PARTNER_VIN,
    make: 'Toyota',
    model: 'Hilux',
    year: 2018,
    chassis_number: 'CH-0007',
    engine_number: 'EN-0007',
    plate_number: 'ABC0007',
    tenant_id: 't1',
    ...overrides,
  });
}

/**
 * Read both trust endpoints for one VIN, each through a key carrying ONLY that endpoint's own
 * scope — so the two answers cannot be explained away as "the same caller got the same cache".
 */
async function bothPartnerTrustEndpoints(vehicleRow) {
  seedDb({ vehicles: [vehicleRow] });
  const trustKey = (await createPartnerClient({ name: 'Trust scope only', scopes: ['vehicle:trust'] })).apiKey;
  const decisionKey = (await createPartnerClient({ name: 'Decision scope only', scopes: ['trust:read'] })).apiKey;
  const summary = await partnerGet(`/api/partner/v1/vehicles/${PARTNER_VIN}/trust-summary`, trustKey);
  const decision = await partnerGet(`/api/partner/v1/vehicles/${PARTNER_VIN}/decision`, decisionKey);
  return { summary, decision };
}

test('BOTH partner trust endpoints publish the canonical ten-field position — /decision is not exempt', async () => {
  const { summary, decision } = await bothPartnerTrustEndpoints(partnerVehicleRow());

  for (const [endpoint, res] of [['trust-summary', summary], ['decision', decision]]) {
    assert.equal(res.status, 200, `${endpoint} did not answer`);
    // The shared checker, not a restatement of the rules: the same function every converging
    // surface uses, and the one test 33 proves is capable of rejecting.
    assert.deepEqual(publicTrustViolations(res.body.trust), [], `${endpoint} published an off-contract position`);
    // Exact key equality with the imported contract — not a subset, not a superset.
    assert.deepEqual(
      Object.keys(res.body.trust).sort(),
      [...PUBLIC_TRUST_FIELDS].sort(),
      `${endpoint} published a key set that is not the ten-field contract`,
    );
    assert.equal(res.body.trust.vin, PARTNER_VIN, `${endpoint} answered about the wrong vehicle`);
    // ANTI-VACUITY: this fixture has a stamped, current cache entry, so the honest answer is a REAL
    // evaluated position. A test that passed on "not evaluated everywhere" would prove nothing.
    assert.equal(res.body.trust.evaluation_state, TRUST_EVALUATION_STATES.EVALUATED, endpoint);
    assert.equal(res.body.trust.score, 84, endpoint);
    assert.equal(res.body.trust.band, 'high', endpoint);
    assert.equal(res.body.trust.calculation_version, CALCULATION_VERSION, endpoint);
    // The redacted explanation is still served alongside the position, finance still stripped.
    assert.ok(res.body.decision.dimensions, `${endpoint} dropped the explanation`);
    assert.equal(res.body.decision.dimensions.finance_eligibility, undefined, endpoint);
  }
});

test('the two partner trust endpoints publish the IDENTICAL position for one VIN, and it is the position the marketplace list publishes', async () => {
  const row = partnerVehicleRow();
  const { summary, decision } = await bothPartnerTrustEndpoints(row);

  // The invariant that matters: a partner cannot be handed a position that disagrees with the
  // other partner endpoint...
  assert.deepEqual(
    decision.body.trust,
    summary.body.trust,
    'the two partner trust endpoints disagreed about the same VIN at the same instant',
  );
  // ...or with what the 48-card marketplace list publishes for the same row (INV-TRUST-1).
  const marketplace = toPublicTrust(
    (await getCanonicalTrustBatch([PARTNER_VIN], { client: fakeClient({ vehicles: [row] }) })).get(PARTNER_VIN),
  );
  assert.deepEqual(summary.body.trust, marketplace, 'the partner position disagreed with the marketplace list');
});

test('neither partner trust endpoint restates the score as overall_trust, anywhere in the response body', async () => {
  const { summary, decision } = await bothPartnerTrustEndpoints(partnerVehicleRow());

  for (const [endpoint, res] of [['trust-summary', summary], ['decision', decision]]) {
    assert.equal(res.body.trust.overall_trust, undefined, `${endpoint} restated the position inside trust`);
    assert.equal(res.body.decision.overall_trust, undefined, `${endpoint} restated the position inside decision`);
    // Nowhere else either — a second stated score at any depth is a second public answer.
    assert.equal(
      /overall_trust/.test(JSON.stringify(res.body)),
      false,
      `${endpoint} carries overall_trust somewhere in its body`,
    );
  }
});

test('a legacy unversioned score is withheld from BOTH partner trust endpoints, exactly as it is from every other surface', async () => {
  // The state every production and staging vehicle is in today: a hand-set number, no version.
  const { summary, decision } = await bothPartnerTrustEndpoints({
    vin: PARTNER_VIN, make: 'Toyota', model: 'Hilux', year: 2018, trust_score: 96.8,
  });

  for (const [endpoint, res] of [['trust-summary', summary], ['decision', decision]]) {
    assert.equal(res.status, 200, endpoint);
    assert.deepEqual(publicTrustViolations(res.body.trust), [], endpoint);
    assert.equal(res.body.trust.score, null, `${endpoint} published the unversioned 96.8`);
    assert.equal(res.body.trust.band, null, endpoint);
    assert.equal(res.body.trust.evaluation_state, TRUST_EVALUATION_STATES.NOT_EVALUATED, endpoint);
  }
  assert.deepEqual(decision.body.trust, summary.body.trust);
});

// ===========================================================================================
// 11. THE FOREIGN WRITERS OF vehicles.trust_score MUST NOT INHERIT THE STAMP.
//
// `refreshCanonicalTrust` is the only writer permitted to STAMP a score. Two other functions
// still write `trust_score`:
//
//   trustEnforcementEngine.verifyDocumentDataMatch            (OCR mismatch penalty)
//   trustEnforcementEngine.propagateStakeholderRisk           (seller-reputation propagation)
//
// A third — documentIntelligenceService.approveDocumentVerification (+20 on OCR approval) —
// was RETIRED OUTRIGHT by O2-X1: stronger than unstamping, the writer no longer exists, and
// the retirement test below (with o2-x1-document-intelligence-authority.test.js) holds it.
//
// A write that touches ONLY the number does not produce a refusable row: after a legitimate
// refresh the six stamp columns are already populated, so the foreign score inherits that
// calculation_version and classifies `fresh` — published as `evaluated`, described by a band,
// confidence and evidence basis belonging to the score it REPLACED. The fix is that each
// remaining writer nulls all six stamp columns in the SAME update (its frozen
// UNSTAMPED_TRUST_CACHE).
//
// These are BEHAVIOURAL: the real, shipped service function runs against the in-memory store above,
// and the assertion is made on the row it actually left behind, then on what the canonical read
// path makes of that row. Each test also asserts the COUNTERFACTUAL — the row the same write would
// have left had it kept the stamp — so "the stamp is cleared" is never a vacuous claim about a
// column that was empty anyway.
// ===========================================================================================

/** The six stamp columns, DERIVED from the shipped cache-column list rather than retyped. */
const STAMP_COLUMNS = TRUST_CACHE_COLUMNS.filter((column) => column !== 'vin' && column !== 'trust_score');

test('the stamp is exactly the six columns a foreign writer must clear', () => {
  assert.deepEqual([...STAMP_COLUMNS].sort(), [
    'trust_band', 'trust_calculation_version', 'trust_confidence', 'trust_evaluated_at',
    'trust_evidence_basis', 'trust_known_limitations',
  ]);
});

/** The row a foreign write must leave behind: the new number, and nothing claiming to justify it. */
function assertForeignWriteIsUnstamped(row, expectedScore, label) {
  assert.equal(row.trust_score, expectedScore, `${label}: the foreign write did not land`);
  for (const column of STAMP_COLUMNS) {
    assert.equal(row[column], null, `${label}: ${column} survived the foreign write and would be inherited`);
  }
  assert.equal(classifyCache(row), TRUST_CACHE_STATUS.UNVERSIONED, `${label}: the row is still classifiable as a cache`);

  const shape = toPublicTrust(canonicalFromCache(row.vin, row));
  assert.notEqual(shape.evaluation_state, TRUST_EVALUATION_STATES.EVALUATED, `${label}: published as evaluated`);
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.NOT_EVALUATED, label);
  assert.equal(shape.score, null, `${label}: the foreign number reached a public surface`);
  assert.equal(shape.band, null, label);
  assert.deepEqual(publicTrustViolations(shape), [], label);
}

/**
 * ANTI-VACUITY control. The same write WITHOUT the nulling — the exact defect — and what the
 * canonical read path would then publish: the foreign number, `evaluated`, under the running
 * calculation version, banded by the score it replaced.
 */
function assertInheritedStampWouldPublish(stampedRowBefore, foreignScore, label) {
  const inherited = { ...stampedRowBefore, trust_score: foreignScore };
  assert.equal(classifyCache(inherited), TRUST_CACHE_STATUS.FRESH, `${label}: control row is not fresh`);
  const shape = toPublicTrust(canonicalFromCache(inherited.vin, inherited));
  assert.equal(shape.evaluation_state, TRUST_EVALUATION_STATES.EVALUATED, label);
  assert.equal(shape.score, foreignScore, label);
  assert.equal(shape.band, stampedRowBefore.trust_band, `${label}: banded by the score it replaced`);
  assert.equal(shape.calculation_version, CALCULATION_VERSION, label);
}

test('the OCR-approval trust writer is RETIRED (O2-X1) — the function is gone and document intelligence cannot touch vehicles at all', () => {
  // Stronger than unstamping: there is nothing left to call. An approval can no longer reach
  // vehicles.trust_score, vehicles.status or any registry table by ANY code path, stamped or not.
  assert.equal(typeof DocumentIntelligenceService.approveDocumentVerification, 'undefined');

  const source = readFileSync(new URL('../services/document-intelligence/documentIntelligenceService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\(['"]vehicles['"]\)/, 'document intelligence must not read or write vehicles');
  assert.doesNotMatch(source, /trust_score/, 'document intelligence must not touch trust');
  assert.doesNotMatch(source, /cvr_ownership_records|zimra_declarations|administrative_overrides/,
    'the registry/override writes of the retired approval must not return');
});

test('an OCR-mismatch penalty writes a trust score that CANNOT publish as canonical — the penalised number never inherits the previous stamp', async () => {
  const vin = 'JTDBR32E870JJ00012';
  const vehicle = freshCacheRow({
    vin, trust_score: 80, trust_band: 'high', trust_confidence: 'high',
    status: 'Available', owner_id: null, make: 'Toyota', model: 'Hilux', year: 2020,
  });
  const stampedBefore = { ...vehicle };
  seedDb({ vehicles: [vehicle] });

  // A registration book whose OCR'd VIN is not this vehicle's: -50, i.e. 80 -> 30.
  const outcome = await TrustEnforcementEngine.verifyDocumentDataMatch(vin, 'registration_book', {
    vin: 'JTDBR32E870JJ99999',
  });

  assert.equal(outcome.match, false);
  assert.equal(outcome.newScore, 30, 'the penalty must actually have been applied');
  assertForeignWriteIsUnstamped(memoryDb.vehicles[0], 30, 'verifyDocumentDataMatch');
  // Had the stamp survived, a vehicle just penalised to 30 would have been published as a `high`
  // band evaluated score — the band belonging to the 80 it replaced.
  assertInheritedStampWouldPublish(stampedBefore, 30, 'verifyDocumentDataMatch');
});

test('propagating a degraded seller reputation writes trust scores that CANNOT publish as canonical — every affected vehicle is left unstamped', async () => {
  const vins = ['JTDBR32E870JJ00013', 'JTDBR32E870JJ00014'];
  const vehicles = vins.map((vin) => freshCacheRow({
    vin, trust_score: 80, trust_band: 'high', trust_confidence: 'high',
    status: 'Available', owner_id: 'seller-risky', make: 'Toyota', model: 'Vitz', year: 2016,
  }));
  const stampedBefore = vehicles.map((row) => ({ ...row }));
  seedDb({
    vehicles,
    stakeholder_profiles: [{ user_id: 'seller-risky', trust_score: 30 }],
  });

  await TrustEnforcementEngine.propagateStakeholderRisk('seller-risky');

  // 30 reputation -> 0.2 multiplier -> 80 - 16 = 64 on every listing this seller owns.
  for (const [i, row] of memoryDb.vehicles.entries()) {
    assertForeignWriteIsUnstamped(row, 64, `propagateStakeholderRisk[${i}]`);
    assertInheritedStampWouldPublish(stampedBefore[i], 64, `propagateStakeholderRisk[${i}]`);
  }
  assert.equal(memoryDb.vehicles.length, 2, 'both of the seller\'s listings must have been rewritten');
});

test('a foreign writer cannot restore the stamp indirectly: a refresh after a foreign write is the ONLY way a score becomes publishable again', async () => {
  const vin = 'JTDBR32E870JJ00015';
  const vehicle = freshCacheRow({
    vin, trust_score: 80, trust_band: 'high', status: 'Available', owner_id: null,
  });
  seedDb({ vehicles: [vehicle] });

  await TrustEnforcementEngine.verifyDocumentDataMatch(vin, 'registration_book', { vin: 'JTDBR32E870JJ99999' });
  assert.equal(toPublicTrust(canonicalFromCache(vin, memoryDb.vehicles[0])).score, null);

  // The one writer runs, and only now is a score publishable again — with ITS OWN stamp, not the
  // one the foreign write happened to leave lying around.
  const refreshed = await refreshCanonicalTrust(vin, {
    client: fakeClient({ vehicles: [memoryDb.vehicles[0]] }),
    decide: decideWith(assembleDecision({
      vin,
      vehicle: { vin, chassis_number: 'CH-0015', engine_number: 'EN-0015', plate_number: 'ABC0015' },
      completeness: fullCompleteness,
      coverage: connectedCoverage,
      now: NOW,
    })),
    read: EMPTY_READ,
  });
  assert.equal(refreshed.written, true);
  assert.equal(refreshed.patch.trust_calculation_version, CALCULATION_VERSION);
  assert.equal(refreshed.patch.trust_score, 84);
});
