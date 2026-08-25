/**
 * Issue #164 — Canonical Vehicle Truth Closure, Phase 2 permanent guard.
 *
 * Phase 0 built the canonical projection, Phase 1 converged the public reads onto it and made
 * "unknown" expressible. Phase 2 adds the derived-fact resolver: the one place that answers
 * what CarUp actually knows about a governed fact, and on what provenance. This suite holds
 * the promises that make it worth wiring up in Phase 3.
 *
 * The guarantees, and the regression each test is watching for:
 *
 *   1. AN EMPTY AUTHORITY MEANS UNKNOWN. Every authoritative table is empty on staging, and
 *      the entire point of the resolver is that this yields `unknown`/`not_recorded` and never
 *      a claim. Principle 9: absence is not proof.
 *   2. A REAL RECORD MEANS VERIFIED, WITH ITS REFERENCE. The mirror of (1): if the resolver
 *      could not say yes when the record exists, every assertion in (1) would be vacuous.
 *   3. A LEGACY BOOLEAN NEVER VERIFIES ANYTHING. The six denormalized columns are surfaced
 *      only as annotations marked `unbacked_claim`, and cannot move status, state or value.
 *      This is the mechanism that lets Phase 3 stop trusting them without deleting them.
 *   4. ONE STATE VOCABULARY. Every result's `state` is a FIELD_STATES member produced by the
 *      canonical module — no parallel vocabulary, no hand-set literals.
 *   5. DETERMINISM. Same inputs — in any row order, any number of times — same result. No
 *      clock, no randomness, so a claim can be replayed from recorded inputs (INV-FACT-6).
 *   6. PROVENANCE BEFORE CLAIMS. An affirmative status must name a substantiating record;
 *      sandbox data, OCR-fabricated registry rows and an approval with no audit trail all
 *      fail CLOSED to unknown rather than publishing.
 *
 * TESTING APPROACH. The resolver is pure over pre-fetched rows and takes injected data
 * access, so this suite runs hermetically: backend/db/supabase.js throws at import without
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, which is why the Phase 0/1 suites use injection and
 * source-text scans. Behaviour is proved against the shipped module; the two source-text
 * assertions say so in their names and exist to catch a defect behaviour cannot see — an
 * accidental db import, or a legacy column creeping back into the logic.
 *
 * ANTI-VACUITY. Three controls, because a resolver that always answered "unknown" would pass
 * most of this file: the verified fixture must produce `verified_clear` for all seven facts
 * (test 2), the fixtures must be observably consumed (`considered`/`provenance.ref`), and the
 * invariant guard itself must reject a doctored result (test 18).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIELD_STATES,
  FIELD_STATE_VALUES,
  isFieldState,
} from '../utils/publicVehicleProjection.js';

import {
  CALCULATION_VERSION,
  FACT_STATUS,
  FACT_STATUS_VALUES,
  FACT_REASONS,
  FACT_DEFINITIONS,
  FACT_INPUT_TABLES,
  VEHICLE_FACTS,
  VEHICLE_FACT_KEYS,
  UNOWNED_LEGACY_COLUMNS,
  NON_SUBSTANTIATING_MODES,
  resolveFact,
  resolveFacts,
  loadFactInputs,
  resolveVehicleFacts,
  isPublishableFact,
  unbackedLegacyClaims,
  factInvariantViolations,
} from '../services/evidence/vehicleFactResolver.js';

const BACKEND = fileURLToPath(new URL('..', import.meta.url));
const RESOLVER_SRC = readFileSync(
  path.join(BACKEND, 'services', 'evidence', 'vehicleFactResolver.js'),
  'utf8',
);

/**
 * The module's CODE, with doc comments removed — the doc comments quote the very patterns
 * these scans forbid (`supabase.js`, `!!vehicle.duty_paid`) because they name the defect
 * being removed, and a scan that could not tell prose from code would forbid explaining it.
 */
const RESOLVER_CODE = RESOLVER_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const VIN = '1HGCM82633A004352';
const OTHER_VIN = 'JH4KA7561PC008269';

/** The six public verification booleans on `vehicles` (FACT_MODEL.md §0). */
const LEGACY_BOOLEANS = [
  'duty_paid', 'police_verified', 'zimra_verified',
  'passport_verified', 'inspection_ready', 'safe_pay_ready',
];

/** A vehicle whose every legacy boolean asserts the claim. Backed by nothing. */
const VEHICLE_ALL_TRUE = Object.freeze({
  vin: VIN,
  import_source: 'japan',
  ...Object.fromEntries(LEGACY_BOOLEANS.map((column) => [column, true])),
});

const EMPTY_ROWS = Object.freeze(Object.fromEntries(FACT_INPUT_TABLES.map((table) => [table, []])));

/** One valid, substantiating record per fact — the mirror image of the empty staging state. */
const VERIFIED_ROWS = Object.freeze({
  zimra_declarations: [{
    id: 'zim-1', vin: VIN, customs_ref_number: 'CR-2026-0001',
    duty_calculated_zig: 1000, duty_paid_zig: 1000,
    customs_stamp_date: '2026-02-01', verified_at: '2026-02-02T10:00:00Z',
  }],
  cid_clearance_records: [{
    id: 'cid-1', vin: VIN, clearance_ref_number: 'CID-2026-77',
    stolen_check_status: 'Cleared', cleared_at: '2026-03-01T09:00:00Z',
  }],
  cvr_ownership_records: [{
    id: 'cvr-1', vin: VIN, registration_number: 'AEZ1234',
    logbook_serial_number: 'ZW-LOG-4412', status: 'Current', issue_date: '2025-11-04',
  }],
  vid_inspections: [{
    id: 'vid-1', vin: VIN, inspection_status: 'Passed',
    certificate_serial_number: 'VID-9', inspected_at: '2026-01-15T08:00:00Z',
  }],
  insurance_records: [{
    id: 'ins-1', vin: VIN, policy_number: 'POL-1',
    active: true, start_date: '2026-01-01', end_date: '2027-01-01',
  }],
  zinara_licensing_records: [{
    id: 'zin-1', vin: VIN, status: 'Current', receipt_number: 'ZR-1',
    licensing_term_start: '2026-01-01', licensing_term_end: '2026-12-31',
  }],
  trust_fact_requests: [{
    id: 'tfr-1', vin: VIN, trust_fact: 'passport_verified', status: 'approved',
    evidence_ids: ['ev-1'], created_at: '2026-03-28T12:00:00Z', reviewed_at: '2026-04-01T12:00:00Z',
  }],
  trust_audit_events: [{
    id: 'tae-1', vin: VIN, trust_fact: 'passport_verified',
    event_type: 'PASSPORT_VERIFICATION_APPROVED', created_at: '2026-04-01T11:59:59Z',
  }],
  source_verification_results: [],
});

/** The row id each fact must cite when it verifies from VERIFIED_ROWS. */
const VERIFIED_REFS = {
  [VEHICLE_FACTS.CUSTOMS_DUTY]: 'zim-1',
  [VEHICLE_FACTS.POLICE_CLEARANCE]: 'cid-1',
  [VEHICLE_FACTS.REGISTRATION_RECORD]: 'cvr-1',
  [VEHICLE_FACTS.ROADWORTHINESS]: 'vid-1',
  [VEHICLE_FACTS.INSURANCE_COVER]: 'ins-1',
  [VEHICLE_FACTS.ROAD_LICENSING]: 'zin-1',
  [VEHICLE_FACTS.PASSPORT_REVIEW]: 'tfr-1',
};

function withRows(overrides) {
  return { ...EMPTY_ROWS, ...overrides };
}

function verification(overrides) {
  return {
    id: 'svr-1', vin: VIN, provider: 'cid', mode: 'live', result: 'no_record',
    retrieved_at: '2026-05-01T00:00:00Z', ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. An empty authority means unknown — the whole point of the resolver
// ---------------------------------------------------------------------------

test('every fact resolves to unknown when its authoritative table is empty', () => {
  // This is staging today: all five registry tables, trust_fact_requests and
  // insurance_records hold zero rows for every vehicle.
  const results = resolveFacts({ vin: VIN, vehicle: null, rows: EMPTY_ROWS });

  assert.deepEqual(Object.keys(results), [...VEHICLE_FACT_KEYS], 'all governed facts must be resolved');
  for (const [factKey, result] of Object.entries(results)) {
    assert.equal(result.status, FACT_STATUS.UNKNOWN, `${factKey} must be unknown with no record`);
    assert.equal(result.state, FIELD_STATES.NOT_RECORDED, `${factKey} must not be recorded`);
    assert.equal(result.value, null, `${factKey} must carry no value`);
    assert.equal(result.publishable, false, `${factKey} must not be publishable`);
    assert.deepEqual(result.provenance, [], `${factKey} must cite nothing`);
    assert.equal(result.reason, FACT_REASONS.NO_AUTHORITATIVE_RECORD);
  }
});

test('a table that was never fetched reads as unknown, not as an answer', () => {
  // A caller that forgets a table must get "we do not know", never a default.
  const results = resolveFacts({ vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: {} });
  for (const result of Object.values(results)) {
    assert.equal(result.status, FACT_STATUS.UNKNOWN);
    assert.equal(result.value, null);
  }
});

// ---------------------------------------------------------------------------
// 2. A real record means verified, with its reference — the anti-vacuity control
// ---------------------------------------------------------------------------

test('ANTI-VACUITY: a present, valid record verifies the fact and cites the backing row', () => {
  // If this test fails, every "unknown" assertion above is vacuous: a resolver that can
  // never say yes trivially satisfies principle 9 and is useless.
  const results = resolveFacts({ vin: VIN, vehicle: null, rows: VERIFIED_ROWS });

  for (const [factKey, result] of Object.entries(results)) {
    assert.equal(result.status, FACT_STATUS.VERIFIED_CLEAR, `${factKey} must verify from its record`);
    assert.equal(result.state, FIELD_STATES.RECORDED, `${factKey} must be recorded`);
    assert.equal(result.value, true);
    assert.equal(isPublishableFact(result), true, `${factKey} must be publishable when backed`);
    assert.ok(result.provenance.length > 0, `${factKey} must cite its backing record`);
    assert.equal(
      result.provenance[0].table,
      FACT_DEFINITIONS[factKey].authority,
      `${factKey} must cite the authoritative table, not a convenience column`,
    );
    assert.equal(
      result.provenance[0].ref,
      VERIFIED_REFS[factKey],
      `${factKey} must cite the exact fixture row — proving the row was read, not assumed`,
    );
    assert.ok(result.evaluated_at, `${factKey} must date the claim from its record`);
    assert.equal(result.calculation_version, CALCULATION_VERSION);
  }
});

test('an adverse record is a recorded finding, not a gap', () => {
  const adverse = [
    [VEHICLE_FACTS.CUSTOMS_DUTY, 'zimra_declarations', {
      id: 'zim-2', vin: VIN, customs_ref_number: 'CR-2', duty_calculated_zig: 1000,
      duty_paid_zig: 250, customs_stamp_date: '2026-02-01', verified_at: '2026-02-02T10:00:00Z',
    }],
    [VEHICLE_FACTS.POLICE_CLEARANCE, 'cid_clearance_records', {
      id: 'cid-2', vin: VIN, stolen_check_status: 'Flagged_Stolen', cleared_at: '2026-03-01T09:00:00Z',
    }],
    [VEHICLE_FACTS.ROADWORTHINESS, 'vid_inspections', {
      id: 'vid-2', vin: VIN, inspection_status: 'Failed_Unroadworthy', inspected_at: '2026-01-15T08:00:00Z',
    }],
  ];

  for (const [factKey, table, row] of adverse) {
    const result = resolveFact(factKey, { vin: VIN, rows: withRows({ [table]: [row] }) });
    assert.equal(result.status, FACT_STATUS.VERIFIED_ADVERSE, `${factKey} must report the adverse finding`);
    assert.equal(result.state, FIELD_STATES.RECORDED, 'an adverse finding is data, not absence');
    assert.equal(result.value, false);
    assert.equal(result.provenance[0].ref, row.id);
  }
});

// ---------------------------------------------------------------------------
// 3. A legacy boolean never verifies anything
// ---------------------------------------------------------------------------

test('a legacy boolean alone never yields verified — for any fact', () => {
  // The staging fixtures set duty_paid/police_verified/zimra_verified/inspection_ready/
  // safe_pay_ready to true on vehicles with no record at all. This is that case.
  const results = resolveFacts({ vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: EMPTY_ROWS });

  for (const [factKey, result] of Object.entries(results)) {
    assert.equal(result.status, FACT_STATUS.UNKNOWN, `${factKey}: a column must not verify a fact`);
    assert.notEqual(result.state, FIELD_STATES.RECORDED);
    assert.equal(result.value, null, `${factKey}: the column value must not become the fact value`);
    assert.equal(isPublishableFact(result), false);
  }
});

test('a legacy true with nothing behind it is surfaced as an unbacked claim, never as truth', () => {
  const results = resolveFacts({ vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: EMPTY_ROWS });

  const claims = unbackedLegacyClaims(results);
  assert.deepEqual(
    claims.map((c) => c.column).sort(),
    ['duty_paid', 'passport_verified', 'police_verified', 'zimra_verified'],
    'every cache column asserting true over an empty authority must be reported unbacked',
  );
  for (const entry of results[VEHICLE_FACTS.CUSTOMS_DUTY].legacy) {
    assert.equal(entry.backed, false);
    assert.equal(entry.publishable, false, 'a legacy column is never publishable on its own');
    assert.equal(entry.divergence, 'unbacked_claim');
  }
});

test('a legacy false is reported as a schema default, not as a denial', () => {
  // Four of the six columns are NOT NULL DEFAULT false: their `false` answers a question
  // nobody asked, so it must not read as an evaluated negative.
  const vehicle = { vin: VIN, ...Object.fromEntries(LEGACY_BOOLEANS.map((c) => [c, false])) };
  const result = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, { vin: VIN, vehicle, rows: EMPTY_ROWS });

  assert.equal(result.status, FACT_STATUS.UNKNOWN, 'a false column is not an adverse finding');
  assert.equal(result.legacy[0].divergence, 'schema_default');
  assert.equal(result.legacy[0].backed, false);
  assert.deepEqual(unbackedLegacyClaims({ x: result }), []);
});

test('a legacy true that the record does agree with is marked agreeing, and still not the source', () => {
  const result = resolveFact(VEHICLE_FACTS.CUSTOMS_DUTY, {
    vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: VERIFIED_ROWS,
  });
  assert.equal(result.status, FACT_STATUS.VERIFIED_CLEAR);
  assert.deepEqual(result.legacy.map((entry) => entry.divergence), ['agrees', 'agrees']);
  assert.deepEqual(result.provenance.map((entry) => entry.table), ['zimra_declarations'],
    'the claim must still be cited to the record, never to the column');
});

test('the six public booleans are all accounted for: cached, conflated, or explicitly unowned', () => {
  const claimed = new Set();
  for (const definition of Object.values(FACT_DEFINITIONS)) {
    for (const column of definition.legacyColumns) claimed.add(column);
    for (const column of definition.conflatedColumns) claimed.add(column);
  }
  const unaccounted = LEGACY_BOOLEANS.filter(
    (column) => !claimed.has(column) && !(column in UNOWNED_LEGACY_COLUMNS),
  );
  assert.deepEqual(unaccounted, [], `a public verification boolean no fact owns: ${unaccounted.join(', ')}`);

  assert.deepEqual(
    FACT_DEFINITIONS[VEHICLE_FACTS.ROADWORTHINESS].conflatedColumns,
    ['inspection_ready'],
    'inspection_ready states the inspection AFFORDANCE, not VID roadworthiness — publishing one '
    + 'as the other is a category error, so it must stay flagged as conflated',
  );
  const roadworthiness = resolveFact(VEHICLE_FACTS.ROADWORTHINESS, {
    vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: VERIFIED_ROWS,
  });
  assert.equal(roadworthiness.legacy[0].divergence, 'conflated_column');
  assert.equal(roadworthiness.legacy[0].backed, false, 'a conflated column is never backed by this fact');
});

test('SOURCE TEXT: the resolver reads no legacy boolean outside its declarations', () => {
  // Behaviour cannot see a NEW `|| !!vehicle.duty_paid` fallback added for a fact this suite
  // does not yet exercise. The rule that stops it: the six column names appear in the fact
  // declarations and nowhere else in the logic.
  const declarations = /export const FACT_DEFINITIONS[\s\S]*?export const UNOWNED_LEGACY_COLUMNS[\s\S]*?\}\);/;
  assert.match(RESOLVER_CODE, declarations, 'the declaration block must be findable, or this scan is vacuous');
  const logic = RESOLVER_CODE.replace(declarations, '');

  for (const column of LEGACY_BOOLEANS) {
    assert.ok(
      !new RegExp(`\\b${column}\\b`).test(logic),
      `${column} is read in resolver logic; legacy columns may only appear in FACT_DEFINITIONS`,
    );
  }
  assert.ok(!/!!\s*vehicle\s*\./.test(RESOLVER_CODE), 'no `!!vehicle.<flag>` coercion may exist');
});

// ---------------------------------------------------------------------------
// 4. One state vocabulary
// ---------------------------------------------------------------------------

/** Scenarios spanning every branch, reused by the vocabulary, invariant and purity tests. */
function allScenarios() {
  return [
    ['empty', { vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: EMPTY_ROWS }],
    ['verified', { vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: VERIFIED_ROWS }],
    ['no vehicle row', { vin: VIN, vehicle: null, rows: VERIFIED_ROWS }],
    ['adverse source', { vin: VIN, rows: withRows({ source_verification_results: [verification({ result: 'high_risk' })] }) }],
    ['source no_record', { vin: VIN, rows: withRows({ source_verification_results: [verification()] }) }],
    ['source unavailable', { vin: VIN, rows: withRows({ source_verification_results: [verification({ mode: 'unavailable', result: 'unavailable' })] }) }],
    ['sandbox source', { vin: VIN, rows: withRows({ source_verification_results: [verification({ mode: 'sandbox', result: 'match' })] }) }],
    ['local vehicle', { vin: VIN, vehicle: { vin: VIN, import_source: 'local' }, rows: EMPTY_ROWS }],
    ['licensing exempt', { vin: VIN, rows: withRows({ zinara_licensing_records: [{ id: 'zin-x', vin: VIN, status: 'Exempted', licensing_term_start: '2026-01-01' }] }) }],
    ['conditional inspection', { vin: VIN, rows: withRows({ vid_inspections: [{ id: 'vid-c', vin: VIN, inspection_status: 'Roadworthy_Conditional', inspected_at: '2026-01-15T08:00:00Z' }] }) }],
    ['pending review', { vin: VIN, rows: withRows({ trust_fact_requests: [{ id: 'tfr-p', vin: VIN, trust_fact: 'passport_verified', status: 'pending', created_at: '2026-03-01T00:00:00Z' }] }) }],
    ['withheld', { vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: VERIFIED_ROWS, withheld: VEHICLE_FACT_KEYS }],
  ];
}

test('every state a resolver returns is a FIELD_STATES member from the canonical module', () => {
  const seen = new Set();
  for (const [label, inputs] of allScenarios()) {
    for (const [factKey, result] of Object.entries(resolveFacts(inputs))) {
      assert.ok(
        isFieldState(result.state),
        `${label}/${factKey} returned "${result.state}", which is not a canonical field state`,
      );
      assert.ok(
        result.status === null || FACT_STATUS_VALUES.includes(result.status),
        `${label}/${factKey} returned status "${result.status}" outside the closed vocabulary`,
      );
      seen.add(result.state);
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    [...FIELD_STATE_VALUES].sort(),
    'the scenarios must exercise all four states, or the vocabulary check is only partly proved',
  );
});

test('withheld tells an uncleared audience nothing — including whether anything exists', () => {
  // Principle 9's other half: if a withheld field looked different when populated, the
  // response would leak exactly the fact being withheld.
  const rich = resolveFacts({ vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: VERIFIED_ROWS, withheld: VEHICLE_FACT_KEYS });
  const bare = resolveFacts({ vin: OTHER_VIN, vehicle: null, rows: EMPTY_ROWS, withheld: VEHICLE_FACT_KEYS });

  assert.deepEqual(rich, bare, 'a withheld fact must look identical whatever the vehicle holds');
  for (const result of Object.values(rich)) {
    assert.equal(result.state, FIELD_STATES.WITHHELD);
    assert.equal(result.status, null, 'even "unknown" is a claim this audience is not owed');
    assert.equal(result.value, null);
    assert.equal(result.considered, null);
    assert.equal(result.legacy, null);
    assert.deepEqual(result.provenance, []);
  }
});

test('not_applicable requires a recorded reason — an absent import_source stays unknown', () => {
  const local = resolveFact(VEHICLE_FACTS.CUSTOMS_DUTY, {
    vin: VIN, vehicle: { vin: VIN, import_source: 'local' }, rows: EMPTY_ROWS,
  });
  assert.equal(local.status, FACT_STATUS.NOT_APPLICABLE);
  assert.equal(local.state, FIELD_STATES.NOT_APPLICABLE);
  assert.equal(local.reason, FACT_REASONS.NOT_APPLICABLE_LOCAL_VEHICLE);

  for (const importSource of [null, undefined, '', '   ']) {
    const unknown = resolveFact(VEHICLE_FACTS.CUSTOMS_DUTY, {
      vin: VIN, vehicle: { vin: VIN, import_source: importSource }, rows: EMPTY_ROWS,
    });
    assert.equal(
      unknown.status,
      FACT_STATUS.UNKNOWN,
      'an unrecorded import_source means we do not know whether duty applies (principle 4)',
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------

test('the resolver is deterministic for the same inputs, in any row order', () => {
  const noisy = {
    ...VERIFIED_ROWS,
    vid_inspections: [
      { id: 'vid-old', vin: VIN, inspection_status: 'Failed_Unroadworthy', inspected_at: '2024-01-01T00:00:00Z' },
      ...VERIFIED_ROWS.vid_inspections,
      { id: 'vid-older', vin: VIN, inspection_status: 'Roadworthy_Conditional', inspected_at: '2023-01-01T00:00:00Z' },
    ],
    source_verification_results: [verification({ id: 'svr-a' }), verification({ id: 'svr-b', provider: 'zimra' })],
  };
  const inputs = { vin: VIN, vehicle: VEHICLE_ALL_TRUE, rows: noisy };
  const reversed = {
    ...inputs,
    rows: Object.fromEntries(Object.entries(noisy).map(([table, rows]) => [table, [...rows].reverse()])),
  };

  const first = resolveFacts(inputs);
  assert.deepEqual(resolveFacts(inputs), first, 'repeating a resolve must reproduce it exactly');
  assert.deepEqual(resolveFacts(reversed), first, 'fetch order must not change a fact');
  assert.equal(first[VEHICLE_FACTS.ROADWORTHINESS].provenance[0].ref, 'vid-1',
    'the most recent inspection must decide, whatever order the rows arrive in');
});

test('resolving does not mutate its inputs', () => {
  const rows = structuredClone(VERIFIED_ROWS);
  const vehicle = { ...VEHICLE_ALL_TRUE };
  const snapshot = structuredClone(rows);
  resolveFacts({ vin: VIN, vehicle, rows });
  assert.deepEqual(rows, snapshot, 'the resolver must not write back into the rows it was given');
  assert.deepEqual(vehicle, { ...VEHICLE_ALL_TRUE });
});

test('a record belonging to another VIN can never resolve this vehicle', () => {
  const rows = withRows({
    cid_clearance_records: [{
      id: 'cid-other', vin: OTHER_VIN, stolen_check_status: 'Cleared', cleared_at: '2026-03-01T09:00:00Z',
    }],
  });
  const result = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, { vin: VIN, rows });
  assert.equal(result.status, FACT_STATUS.UNKNOWN, 'a mis-scoped fetch must not verify the wrong vehicle');
  assert.equal(result.considered, 0);
});

// ---------------------------------------------------------------------------
// 6. Provenance before claims
// ---------------------------------------------------------------------------

test('a source that was queried and found nothing is not a clearance', () => {
  const result = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, {
    vin: VIN, rows: withRows({ source_verification_results: [verification({ result: 'no_record' })] }),
  });
  assert.equal(result.status, FACT_STATUS.NO_RECORD);
  assert.equal(result.value, false, '"checked, nothing on file" is a recorded fact');
  assert.equal(isPublishableFact(result), false, 'it must never render as the affirmative claim');
  assert.equal(result.provenance[0].table, 'source_verification_results');
});

test('an unreachable source is not a clearance either, and stays distinct from no_record', () => {
  const unavailable = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, {
    vin: VIN, rows: withRows({ source_verification_results: [verification({ mode: 'unavailable', result: 'unavailable' })] }),
  });
  assert.equal(unavailable.status, FACT_STATUS.SOURCE_UNAVAILABLE);
  assert.equal(unavailable.value, null);
  assert.notEqual(unavailable.status, FACT_STATUS.NO_RECORD, 'collapsing these two is absence-as-proof');
});

test('a source match without the record it implies does not verify the record', () => {
  // A ZIMRA "match" is source COVERAGE — it says the VIN is known, not that duty was settled.
  // The marketplace publishes both as independent badges today; they are not independent.
  const result = resolveFact(VEHICLE_FACTS.CUSTOMS_DUTY, {
    vin: VIN, rows: withRows({ source_verification_results: [verification({ provider: 'zimra', result: 'match' })] }),
  });
  assert.equal(result.status, FACT_STATUS.UNKNOWN);
  assert.equal(result.reason, FACT_REASONS.SOURCE_MATCH_WITHOUT_RECORD);
  assert.deepEqual(result.provenance, [], 'unknown cites nothing');
  assert.equal(result.considered, 1, 'but the row was read — the answer is derived, not skipped');
});

test('sandbox data can never substantiate a claim', () => {
  for (const mode of NON_SUBSTANTIATING_MODES) {
    const result = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, {
      vin: VIN,
      rows: withRows({ source_verification_results: [verification({ mode, result: 'no_record' })] }),
    });
    assert.equal(isPublishableFact(result), false, `mode ${mode} must not produce a public claim`);
    assert.notEqual(result.status, FACT_STATUS.VERIFIED_CLEAR);
  }
  const sandbox = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, {
    vin: VIN, rows: withRows({ source_verification_results: [verification({ mode: 'sandbox', result: 'no_record' })] }),
  });
  assert.equal(sandbox.status, FACT_STATUS.UNKNOWN, 'a synthetic result must fail closed');
  assert.equal(sandbox.reason, FACT_REASONS.UNSUBSTANTIATED_MODE);
});

test('an OCR-fabricated registry row is a manual-review input, not an authority', () => {
  // documentIntelligenceService writes CUS_/REG_/LB_ identifiers alongside a fabricated
  // duty_paid_zig of 50000 — which would otherwise satisfy paid >= calculated and verify.
  const result = resolveFact(VEHICLE_FACTS.CUSTOMS_DUTY, {
    vin: VIN,
    rows: withRows({
      zimra_declarations: [{
        id: 'zim-ocr', vin: VIN, customs_ref_number: 'CUS_9F2A11B0',
        duty_calculated_zig: 50000, duty_paid_zig: 50000,
        customs_stamp_date: '2026-02-01', verified_at: '2026-02-02T10:00:00Z',
      }],
    }),
  });
  assert.equal(result.status, FACT_STATUS.PENDING_REVIEW);
  assert.equal(result.reason, FACT_REASONS.RECORD_REQUIRES_MANUAL_REVIEW);
  assert.equal(isPublishableFact(result), false);
  assert.equal(result.provenance[0].mode, 'document_intelligence', 'the row is cited, and marked');
});

test('a governed approval with no audit trail fails closed', () => {
  // trustFactWorkflowService writes two audit events and asserts them BEFORE patching the
  // vehicle, so an approval with no ledger entry is an anomaly — not a claim.
  const rows = withRows({ trust_fact_requests: VERIFIED_ROWS.trust_fact_requests, trust_audit_events: [] });
  const result = resolveFact(VEHICLE_FACTS.PASSPORT_REVIEW, { vin: VIN, rows });

  assert.equal(result.status, FACT_STATUS.UNKNOWN);
  assert.equal(result.reason, FACT_REASONS.PROVENANCE_MISSING);
  assert.equal(result.considered, 1, 'the request was read — it just cannot be published');

  const audited = resolveFact(VEHICLE_FACTS.PASSPORT_REVIEW, { vin: VIN, rows: VERIFIED_ROWS });
  assert.equal(audited.status, FACT_STATUS.VERIFIED_CLEAR, 'with the ledger entry, it verifies');
  assert.deepEqual(audited.provenance.map((entry) => entry.table), ['trust_fact_requests', 'trust_audit_events']);
});

test('a revoked or rejected review returns to unknown, never to a proven negative', () => {
  for (const [status, reason] of [
    ['revoked', FACT_REASONS.REVIEW_REVOKED],
    ['rejected', FACT_REASONS.REVIEW_REJECTED],
    ['superseded', FACT_REASONS.REVIEW_SUPERSEDED],
  ]) {
    const result = resolveFact(VEHICLE_FACTS.PASSPORT_REVIEW, {
      vin: VIN,
      rows: withRows({
        trust_fact_requests: [{
          id: `tfr-${status}`, vin: VIN, trust_fact: 'passport_verified', status,
          created_at: '2026-03-28T12:00:00Z', reviewed_at: '2026-04-02T12:00:00Z',
          revoked_at: status === 'revoked' ? '2026-04-03T12:00:00Z' : null,
        }],
        trust_audit_events: VERIFIED_ROWS.trust_audit_events,
      }),
    });
    assert.equal(result.status, FACT_STATUS.UNKNOWN, `${status} must not publish`);
    assert.equal(result.value, null, `${status} must not assert a negative about the vehicle`);
    assert.equal(result.reason, reason);
  }
});

test('the latest decision wins: a revocation after an approval un-publishes the fact', () => {
  const result = resolveFact(VEHICLE_FACTS.PASSPORT_REVIEW, {
    vin: VIN,
    rows: withRows({
      trust_fact_requests: [
        ...VERIFIED_ROWS.trust_fact_requests,
        {
          id: 'tfr-2', vin: VIN, trust_fact: 'passport_verified', status: 'revoked',
          created_at: '2026-04-05T12:00:00Z', revoked_at: '2026-04-06T12:00:00Z',
        },
      ],
      trust_audit_events: VERIFIED_ROWS.trust_audit_events,
    }),
  });
  assert.equal(result.status, FACT_STATUS.UNKNOWN);
  assert.equal(result.reason, FACT_REASONS.REVIEW_REVOKED);
});

// ---------------------------------------------------------------------------
// 7. The guard itself
// ---------------------------------------------------------------------------

test('every resolved fact satisfies the invariants, across every scenario', () => {
  for (const [label, inputs] of allScenarios()) {
    for (const [factKey, result] of Object.entries(resolveFacts(inputs))) {
      assert.deepEqual(
        factInvariantViolations(result),
        [],
        `${label}/${factKey} violates a fact invariant`,
      );
    }
  }
});

test('ANTI-VACUITY: the invariant guard rejects a doctored result', () => {
  // A guard that passed everything would make the test above meaningless.
  const good = resolveFact(VEHICLE_FACTS.POLICE_CLEARANCE, { vin: VIN, rows: VERIFIED_ROWS });
  assert.deepEqual(factInvariantViolations(good), []);

  const doctored = [
    [{ ...good, provenance: [] }, 'affirmative_without_provenance'],
    [{ ...good, provenance: [{ ...good.provenance[0], mode: 'sandbox' }] }, 'affirmative_from_unsubstantiating_mode'],
    [{ ...good, state: 'verified' }, 'state_outside_vocabulary'],
    [{ ...good, status: 'definitely_true' }, 'status_outside_vocabulary'],
    [{ ...good, state: FIELD_STATES.NOT_RECORDED }, 'value_without_recorded_state'],
    [{ ...good, status: FACT_STATUS.UNKNOWN, publishable: true }, 'publishable_without_publishable_status'],
    [{ ...good, legacy: [{ column: 'police_verified', publishable: true }] }, 'legacy_column_marked_publishable'],
  ];
  for (const [result, expected] of doctored) {
    assert.ok(
      factInvariantViolations(result).includes(expected),
      `the guard must catch ${expected}`,
    );
  }
  assert.deepEqual(factInvariantViolations(null), ['missing_result']);
});

test('an unknown fact key is refused rather than answered', () => {
  assert.throws(() => resolveFact('trust_me', { vin: VIN, rows: EMPTY_ROWS }), /unknown vehicle fact/);
});

// ---------------------------------------------------------------------------
// 8. Injection — the resolver runs without a database client
// ---------------------------------------------------------------------------

test('SOURCE TEXT: the resolver imports no database client', () => {
  // backend/db/supabase.js throws at import without env vars. A resolver that imported it
  // could not be unit tested at all, and this whole suite would have to boot the app.
  assert.ok(!/^import[\s\S]*?from\s+'[^']*db\/supabase\.js'/m.test(RESOLVER_CODE), 'must not import the supabase client');
  assert.ok(!/\bsupabase\b/.test(RESOLVER_CODE), 'must not reference a supabase client');
  assert.ok(!/new Date\(|Date\.now\(/.test(RESOLVER_CODE), 'must not read the clock — results must be replayable');
});

test('resolveVehicleFacts runs entirely through injected data access', async () => {
  const asked = [];
  const read = async (table, vin) => {
    asked.push(`${table}:${vin}`);
    return VERIFIED_ROWS[table] || [];
  };

  const results = await resolveVehicleFacts(VIN, { read, vehicle: VEHICLE_ALL_TRUE });
  assert.deepEqual(asked.sort(), FACT_INPUT_TABLES.map((table) => `${table}:${VIN}`).sort(),
    'the loader must ask for exactly the declared input tables');
  for (const result of Object.values(results)) {
    assert.equal(result.status, FACT_STATUS.VERIFIED_CLEAR);
  }
});

test('injected access that returns nothing yields unknown, and a missing injection is refused', async () => {
  const results = await resolveVehicleFacts(VIN, { read: async () => [], vehicle: VEHICLE_ALL_TRUE });
  for (const result of Object.values(results)) assert.equal(result.status, FACT_STATUS.UNKNOWN);

  const rows = await loadFactInputs(VIN, { read: async () => null });
  assert.deepEqual(Object.keys(rows).sort(), [...FACT_INPUT_TABLES].sort());
  for (const table of FACT_INPUT_TABLES) assert.deepEqual(rows[table], []);

  await assert.rejects(() => loadFactInputs(VIN, {}), /injected read/);
});

// ---------------------------------------------------------------------------
// Review findings closed — these three are the regressions to watch
// ---------------------------------------------------------------------------

test('a source mismatch without an authoritative record goes to review, not to an adverse claim', () => {
  // A source verification reports COVERAGE, not the content of the declaration the fact asserts.
  // `match` correctly yields unknown for that reason; inferring an ADVERSE fact from `mismatch`
  // would make the same conflation in the negative direction and publish a fabricated "NO".
  for (const result of ['mismatch', 'high_risk']) {
    const results = resolveFacts({
      vin: VIN,
      vehicle: null,
      rows: {
        ...EMPTY_ROWS,
        source_verification_results: [{ vin: VIN, provider: 'zimra', result, mode: 'source_connected' }],
      },
    });
    const duty = results.customs_duty;
    assert.notEqual(duty.status, FACT_STATUS.VERIFIED_ADVERSE, `${result} must not publish an adverse fact`);
    assert.equal(duty.status, FACT_STATUS.PENDING_REVIEW);
    assert.equal(duty.publishable, false, 'nothing goes public off a coverage signal alone');
  }
});

test('rows are scoped to the vehicle, and an unscoped call resolves nothing', () => {
  const foreignRow = { vin: 'JF1GPAL60J9UAT303', duty_paid_status: 'Paid' };

  const scoped = resolveFacts({
    vin: VIN,
    vehicle: null,
    rows: { ...EMPTY_ROWS, zimra_declarations: [foreignRow] },
  });
  assert.equal(scoped.customs_duty.publishable, false, "another vehicle's record must never back this fact");
  assert.deepEqual(scoped.customs_duty.provenance, []);

  // No vin to scope against => nothing can be shown to belong to this vehicle => fail closed.
  const unscoped = resolveFacts({
    vin: null,
    vehicle: null,
    rows: { ...EMPTY_ROWS, zimra_declarations: [{ duty_paid_status: 'Paid' }] },
  });
  assert.equal(unscoped.customs_duty.status, FACT_STATUS.UNKNOWN);
  assert.equal(unscoped.customs_duty.publishable, false);
});

test('one unreadable source degrades to unknown instead of failing the whole resolution', async () => {
  // An absent table or an RLS denial must not decide the other facts, and must not tempt a caller
  // into a blanket fallback by rejecting.
  const rows = await loadFactInputs(VIN, {
    read: async (table) => {
      if (table === 'zimra_declarations') throw new Error('relation does not exist');
      return [];
    },
  });

  assert.deepEqual(rows.zimra_declarations, [], 'the unreadable table yields no rows');
  const results = resolveFacts({ vin: VIN, vehicle: null, rows });
  assert.equal(results.customs_duty.status, FACT_STATUS.UNKNOWN);
  assert.equal(Object.values(results).every((fact) => fact.publishable === false), true);
});
