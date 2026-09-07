/**
 * Trade OS T11.1 — hardening the shipment authority that already existed.
 *
 * T11 is neither T9 (nothing existed) nor T10 (the word existed, the fact did not). The shipment
 * record, its timeline, its audit and its T7 exception consumer are all real and largely sound. The
 * job is to close the specific ways it could be made to assert things nobody observed:
 *
 *   1. a shipment for a container that was never loaded;
 *   2. a planned departure date stored as though it were an observed one;
 *   3. a timeline written out of order;
 *   4. a retry appending a second journey.
 *
 * And to hold the line T11 must not cross: it records movement, and does not manufacture customs
 * clearance, release, settlement or a delivery nobody saw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertShipmentTransition } from '../services/diaspora/diasporaShipmentService.js';

// ── 3. The timeline cannot be written BACKWARDS ────────────────────────────
//
// The rule is forward-or-lateral, never backward — and the first version of it was stricter and
// wrong. It demanded the ordinary sequence, refusing PLANNED → IN_TRANSIT, which would have forced
// an operator who learns a ship sailed to invent BOOKED and LOADING first. A stage nobody recorded
// is a stage nobody OBSERVED, not one that did not happen. The existing authorization suite caught
// it, and these tests now assert the smaller, truer claim.

test('T11: a stage may be SKIPPED — an unrecorded stage is one nobody observed', () => {
  // The case that caught the over-strict version: a shipment logged as PLANNED, then reported at
  // sea. Refusing this would make the operator manufacture two facts to record the one they had.
  assert.deepEqual(assertShipmentTransition('PLANNED', 'IN_TRANSIT'), { unchanged: false });
  assert.deepEqual(assertShipmentTransition('PLANNED', 'ARRIVED'), { unchanged: false });
  assert.deepEqual(assertShipmentTransition('BOOKED', 'ARRIVED'), { unchanged: false });
});

test('T11: history cannot be rewound — ARRIVED does not go back to IN_TRANSIT', () => {
  assert.throws(() => assertShipmentTransition('ARRIVED', 'IN_TRANSIT'), /cannot go backwards/);
  assert.throws(() => assertShipmentTransition('IN_TRANSIT', 'BOOKED'), /cannot go backwards/);
  assert.throws(() => assertShipmentTransition('RELEASED', 'ARRIVED'), /cannot go backwards/);
});

test('T11: the refusal says WHY, in terms of what it would assert', () => {
  try {
    assertShipmentTransition('ARRIVED', 'IN_TRANSIT');
    assert.fail('accepted');
  } catch (err) {
    assert.match(err.message, /that would say the goods moved back/i);
  }
});

test('T11: a customs hold being LIFTED is the one legitimate backward step', () => {
  // The goods did not move. A hold was placed and released, and they are still arrived.
  assert.deepEqual(assertShipmentTransition('CUSTOMS_HOLD', 'ARRIVED'), { unchanged: false });
  // …and it is the ONLY one.
  assert.throws(() => assertShipmentTransition('CUSTOMS_HOLD', 'IN_TRANSIT'), /cannot go backwards/);
});

test('T11: a COMPLETED shipment is final — nothing follows it', () => {
  for (const next of ['IN_TRANSIT', 'ARRIVED', 'RELEASED', 'EXCEPTION', 'PLANNED']) {
    assert.throws(() => assertShipmentTransition('COMPLETED', next), /completed shipment is finished/);
  }
});

test('T11: POSITIVE CONTROL — the ordinary journey is allowed at every step', () => {
  // A gate that refuses everybody is not a gate.
  const journey = [['PLANNED', 'BOOKED'], ['BOOKED', 'LOADING'], ['LOADING', 'IN_TRANSIT'], ['IN_TRANSIT', 'ARRIVED'], ['ARRIVED', 'RELEASED'], ['RELEASED', 'COMPLETED']];
  for (const [from, to] of journey) {
    assert.deepEqual(assertShipmentTransition(from, to), { unchanged: false }, `${from} → ${to} was refused`);
  }
});

test('T11: an EXCEPTION is reachable from anywhere still moving, and returns to where the goods are', () => {
  // An exception happens TO a shipment; it is not a place in its journey, so it has no rank.
  for (const from of ['PLANNED', 'BOOKED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_HOLD', 'RELEASED']) {
    assert.deepEqual(assertShipmentTransition(from, 'EXCEPTION'), { unchanged: false }, `${from} → EXCEPTION was refused`);
  }
  // Leaving it returns to wherever the operator says the goods are — including backwards, because
  // this map does not know and they do.
  assert.deepEqual(assertShipmentTransition('EXCEPTION', 'IN_TRANSIT'), { unchanged: false });
  assert.deepEqual(assertShipmentTransition('EXCEPTION', 'ARRIVED'), { unchanged: false });
  // …but not out of the vocabulary.
  assert.throws(() => assertShipmentTransition('EXCEPTION', 'TELEPORTED'), /not a stage a shipment can be at/);
});

// ── 4. A retry is not a second journey ─────────────────────────────────────

test('T11: re-reporting the CURRENT stage is not an error and not a second event', () => {
  for (const stage of ['PLANNED', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED']) {
    assert.deepEqual(assertShipmentTransition(stage, stage), { unchanged: true },
      `re-reporting ${stage} should be reported as unchanged, not refused and not appended`);
  }
});

test('T11: the refusal carries an actionable code and both stages', () => {
  try {
    assertShipmentTransition('ARRIVED', 'IN_TRANSIT');
    assert.fail('accepted');
  } catch (err) {
    assert.equal(err.details?.code || err.code, 'ILLEGAL_SHIPMENT_TRANSITION');
    assert.equal(err.details.currentStage, 'ARRIVED');
    assert.equal(err.details.nextStage, 'IN_TRANSIT');
  }
});

// ── The T12 firewall ───────────────────────────────────────────────────────

test('T11: the transition map contains no customs CLEARANCE, delivery or settlement stage', () => {
  // T11 may record that customs are HOLDING goods — that is an observation of where the cargo is.
  // It may not record that customs cleared them, which is a decision T12 owns.
  // Every stage the map knows about, probed rather than read off the source.
  for (const stage of ['CLEARED', 'DELIVERED', 'SETTLED', 'PAID', 'DUTY_ASSESSED']) {
    assert.throws(() => assertShipmentTransition('ARRIVED', stage), /not a stage a shipment can be at/,
      `${stage} is reachable — T11 may record that customs are HOLDING goods, never that they cleared them`);
  }
});

test('T11: an unknown stage is refused rather than silently allowed', () => {
  assert.throws(() => assertShipmentTransition('PLANNED', 'TELEPORTED'), /not a stage a shipment can be at/);
  assert.throws(() => assertShipmentTransition('WHATEVER', 'IN_TRANSIT'), /not a stage a shipment can be at/);
});

// ── The service's structure ────────────────────────────────────────────────

test('T11: createShipment requires a completed T10 load for a co-loaded container', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  assert.match(source, /assertContainerWasLoaded/, 'the gate is not called');
  assert.match(source, /SHIPMENT_WITHOUT_COMPLETED_LOAD/, 'the refusal has no actionable code');
  // A COMPLETED load may legitimately carry LEFT_BEHIND lines, so "all cargo loaded" would make
  // T10's left-behind path unable to ever produce a shipment. Derived from T10, not invented.
  assert.match(source, /left-behind path unable to ever produce a shipment/);
});

test('T11: a departure date supplied at CREATION is kept as a PLAN, not an observation', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  assert.match(source, /planned_departure_date/, 'a stated departure date is not distinguished from an observed one');
  assert.match(source, /departure_date: null,/, 'the observed column is still populated at creation');
});

test('T11: departure and arrival are stamped when the movement is REPORTED', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  assert.match(source, /nextStage === SHIPMENT_STATUSES\.IN_TRANSIT \? \{ departure_date: observedTime/);
  assert.match(source, /nextStage === SHIPMENT_STATUSES\.ARRIVED \? \{ actual_arrival_date: observedTime/);
  assert.match(source, /cannot be recorded as moving at a time in the future/);
});

test('T11: T10 remains the loading authority — T11 reads it and never writes it', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  for (const table of ['diaspora_container_loads', 'diaspora_container_load_items', 'diaspora_container_load_plans']) {
    assert.ok(!new RegExp(`from\\('${table}'\\)[\\s\\S]{0,120}\\.(insert|update|delete)`).test(code),
      `the shipment service writes ${table}`);
  }
  assert.match(code, /from\('diaspora_container_loads'\)\s*\.select/, 'the gate does not read the load authority at all');
});
