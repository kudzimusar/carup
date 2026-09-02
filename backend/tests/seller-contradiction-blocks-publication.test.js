/**
 * Seller Journey 1.0 / S5 gate — a known material contradiction cannot silently reach publication.
 *
 * Before this, `evaluateCompleteness` never read `vehicle_document_extractions`. A listing whose
 * registration document said 2019 while the seller said 2020 — detected, stored, and sitting in the
 * reviewer queue — published exactly like a listing with no disagreement at all.
 *
 * The fix is deliberately an EXTRA REQUIREMENT INSIDE the canonical evaluator, not a second
 * blocker: `POST /api/vehicles/:vin/publish` already gates on `is_publishable` and already discloses
 * `blocking_gaps` / `pending_gaps`. Adding a parallel gate would give CarUp two answers to "may this
 * publish?", which is the failure mode the plan's own lane rules exist to prevent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCompleteness } from '../services/evidence/completenessEvaluator.js';

const VIN = '1HGCM82633A004352';

/** A vehicle that satisfies every pre-existing blocking requirement. */
const COMPLETE_VEHICLE = {
  vin: VIN,
  chassis_number: 'CHS123456',
  engine_number: 'ENG123456',
  plate_number: 'ABC1234',
  temp_plate_id: null,
  trust_score: null,
  publication_status: 'draft',
  make: 'Toyota',
  model: 'Hilux',
  year: 2020,
  // ZR registration readiness (69925e21) made an unrecorded stage blocking; a
  // "complete" fixture therefore records a truthful sourced stage.
  registration_status: 'locally_registered',
  registration_status_source: 'seller_stated',
};

const VERIFIED_OWNERSHIP = [
  { id: 'ev-1', evidence_type: 'registration_document', verification_status: 'verified' },
];

const mismatch = (over = {}) => ({
  id: 'ext-1',
  vin: VIN,
  evidence_id: 'ev-1',
  document_type: 'registration_document',
  field_name: 'year',
  raw_value: '2019',
  normalized_value: '2019',
  expected_value: '2020',
  compared_vehicle_field: 'year',
  match_status: 'mismatch',
  review_status: 'pending',
  created_at: '2026-02-01T00:00:00Z',
  ...over,
});

/**
 * A minimal injected client. `evaluateCompleteness` already accepts `opts.client`, so this needs no
 * production change to be testable.
 */
function clientWith({ vehicle = COMPLETE_VEHICLE, evidence = VERIFIED_OWNERSHIP, extractions = [] } = {}) {
  return {
    from(table) {
      const builder = {
        _table: table,
        select() { return builder },
        eq() { return builder },
        in() { return builder },
        order() { return builder },
        single: async () => (table === 'vehicles'
          ? { data: vehicle, error: vehicle ? null : { message: 'not found' } }
          : { data: null, error: null }),
        then(resolve) {
          if (table === 'vehicle_evidence') return resolve({ data: evidence, error: null });
          if (table === 'vehicle_document_extractions') return resolve({ data: extractions, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

const requirement = (result, key) => result.requirements.find(r => r.key === key);

test('a clean listing is publishable and carries the reconciliation requirement as met', async () => {
  const result = await evaluateCompleteness(VIN, { client: clientWith() });

  assert.equal(result.is_publishable, true);
  const reconciliation = requirement(result, 'fact_reconciliation');
  assert.ok(reconciliation, 'the reconciliation requirement must always be present, met or not');
  assert.equal(reconciliation.blocking, true);
  assert.equal(reconciliation.status, 'present');
});

test('an unresolved material contradiction blocks publication', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({ extractions: [mismatch()] }),
  });

  assert.equal(result.is_publishable, false, 'a known 2020-vs-2019 disagreement must not publish');
  assert.equal(requirement(result, 'fact_reconciliation').status, 'pending_review');
  // It must be DISCLOSED, not merely counted — the publish route republishes these to the caller.
  const disclosed = [...result.blocking_gaps, ...result.pending_gaps].map(gap => gap.key);
  assert.ok(disclosed.includes('fact_reconciliation'), 'the seller must be told which gate stopped them');
});

test('the block names the fact in disagreement rather than saying only "a contradiction"', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({ extractions: [mismatch()] }),
  });
  const reconciliation = requirement(result, 'fact_reconciliation');
  assert.ok(
    String(reconciliation.label).toLowerCase().includes('year')
    || (reconciliation.fields ?? []).includes('year'),
    'a refusal that names nothing is the defect the publish route already fixed once',
  );
});

test('a resolved contradiction stops blocking', async () => {
  for (const review_status of ['confirmed', 'rejected', 'amended', 'waived']) {
    const result = await evaluateCompleteness(VIN, {
      client: clientWith({ extractions: [mismatch({ review_status })] }),
    });
    assert.equal(result.is_publishable, true, `${review_status} must unblock publication`);
    assert.equal(requirement(result, 'fact_reconciliation').status, 'present');
  }
});

test('agreement does not block', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      extractions: [mismatch({ normalized_value: '2020', match_status: 'match' })],
    }),
  });
  assert.equal(result.is_publishable, true);
});

test('a comparison that could not be made never blocks', async () => {
  for (const match_status of ['missing_reference', 'inconclusive']) {
    const result = await evaluateCompleteness(VIN, {
      client: clientWith({ extractions: [mismatch({ match_status })] }),
    });
    assert.equal(result.is_publishable, true, `${match_status} compared nothing and must not block`);
  }
});

test('a non-material contradiction is not a publication blocker', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      extractions: [mismatch({ field_name: 'colour', compared_vehicle_field: 'colour', normalized_value: 'Silver' })],
    }),
  });
  assert.equal(result.is_publishable, true);
});

test('no extractions at all does not manufacture a blocker', async () => {
  // Missing stays missing: a vehicle whose documents were never OCR-read has no contradiction, and
  // inventing one would be a fabricated failure.
  const result = await evaluateCompleteness(VIN, { client: clientWith({ extractions: [] }) });
  assert.equal(result.is_publishable, true);
  assert.equal(requirement(result, 'fact_reconciliation').status, 'present');
});

test('an unreadable extractions query fails closed rather than publishing', async () => {
  const client = clientWith();
  const inner = client.from('vehicle_document_extractions');
  const failing = {
    from(table) {
      if (table !== 'vehicle_document_extractions') return client.from(table);
      return { ...inner, select: () => failing.from(table), eq: () => failing.from(table), order: () => failing.from(table), then: resolve => resolve({ data: null, error: { message: 'boom' } }) };
    },
  };
  await assert.rejects(
    () => evaluateCompleteness(VIN, { client: failing }),
    /extraction/i,
    'a gate that cannot read its own input must refuse, not assume the listing is clean',
  );
});

test('the reconciliation requirement still leaves the pre-existing gates intact', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      vehicle: { ...COMPLETE_VEHICLE, chassis_number: null },
      extractions: [],
    }),
  });
  assert.equal(result.is_publishable, false);
  assert.ok(result.blocking_gaps.some(gap => gap.key === 'chassis_number'));
});
