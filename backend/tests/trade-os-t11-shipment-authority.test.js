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
import { assertShipmentTransition, resolveObservedTime, STAGES_HANDED_TO_T12 } from '../services/diaspora/diasporaShipmentService.js';

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

// ── The T11/T12 coupling, closed ───────────────────────────────────────────
//
// The T11.0 audit flagged SHIPMENT_TO_IMPORT_STATUS as a boundary leak and left it. Reading the
// import order's OWN ladder makes it worse than "shaped like customs":
//
//     ARRIVED_AT_BORDER → CUSTOMS_IN_PROGRESS → DUTY_PENDING → DUTY_PAID → RELEASED
//
// `RELEASED` sits AFTER `DUTY_PAID`. A shipment stage transition was therefore writing a purchase
// status meaning duty had been paid and an authority had released the goods — from a movement
// action, with no assessment, no payment evidence and no authority anywhere in the picture.

test('T11: a movement action can no longer write a CUSTOMS-shaped purchase status', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  const map = source.slice(source.indexOf('const SHIPMENT_TO_IMPORT_STATUS'), source.indexOf('export const STAGES_HANDED_TO_T12'));
  for (const gone of ['CUSTOMS_HOLD', 'RELEASED', 'COMPLETED']) {
    assert.ok(!new RegExp(`^\\s*${gone}:`, 'm').test(map), `${gone} still projects onto the purchase status`);
  }
});

test('T11: only movement facts remain in the projection', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  const map = source.slice(source.indexOf('const SHIPMENT_TO_IMPORT_STATUS'), source.indexOf('export const STAGES_HANDED_TO_T12'));
  // being loaded · departed · reached the border. Each is something movement can honestly establish.
  for (const kept of ['LOADING', 'IN_TRANSIT', 'ARRIVED']) {
    assert.ok(new RegExp(`^\\s*${kept}:`, 'm').test(map), `${kept} should still project — it is a movement fact`);
  }
});

test('T11: what was handed to T12 is named, not merely deleted', () => {
  // A removal with no record is indistinguishable from an oversight. Each entry says WHY.
  assert.deepEqual(Object.keys(STAGES_HANDED_TO_T12).sort(), ['COMPLETED', 'CUSTOMS_HOLD', 'RELEASED']);
  for (const [stage, why] of Object.entries(STAGES_HANDED_TO_T12)) {
    assert.match(why, /^T12 — /, `${stage} does not name its new owner`);
    assert.ok(why.length > 40, `${stage} does not say why`);
  }
  assert.match(STAGES_HANDED_TO_T12.RELEASED, /after DUTY_PAID/, 'the RELEASED entry does not record the actual hazard');
});

test('T11: a CUSTOMS_HOLD is still recordable as movement context', () => {
  // T11 may say "your shipment is held" — an observation of where the cargo is. What it may no
  // longer do is project that onto the purchase as "a declaration is being processed".
  assert.deepEqual(assertShipmentTransition('IN_TRANSIT', 'CUSTOMS_HOLD'), { unchanged: false });
  assert.deepEqual(assertShipmentTransition('ARRIVED', 'CUSTOMS_HOLD'), { unchanged: false });
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

// ── 5. ONE observed time, validated once ──────────────────────────────────
//
// The defect these replace: the observed time was read in two unrelated places. The shipment column
// took `payload.event_time`; the timeline event took `payload.metadata.event_time`. So a caller
// stating the real departure moved the column and left the timeline stamped `now` — a shipment
// disagreeing with its own history about when it sailed — and any stage that writes no column (a
// customs hold, an exception) reached the timeline through the unvalidated path, where a movement
// could still be dated into the future.

const NOW = '2026-09-20T12:00:00.000Z';

test('T11: an unstated observation is NOW, not null and not zero', () => {
  assert.equal(resolveObservedTime({}, NOW), NOW);
  assert.equal(resolveObservedTime({ stage: 'ARRIVED' }, NOW), NOW);
});

test('T11: every stated form of the time resolves to the SAME observed time', () => {
  const t = '2026-09-19T06:30:00.000Z';
  // A caller may say it four ways. All four are the same claim about when it happened, so all four
  // must produce one answer — and be validated identically.
  assert.equal(resolveObservedTime({ event_time: t }, NOW), t);
  assert.equal(resolveObservedTime({ metadata: { event_time: t } }, NOW), t);
  assert.equal(resolveObservedTime({ departure_date: t }, NOW), t);
  assert.equal(resolveObservedTime({ actual_arrival_date: t }, NOW), t);
});

test('T11: a FUTURE observation is refused however it was stated', () => {
  const future = '2026-09-27T00:00:00.000Z';
  for (const payload of [
    { event_time: future },
    // The path that used to be unguarded. A customs hold or an exception writes no column, so it
    // only ever reached the timeline — where nothing checked it.
    { metadata: { event_time: future } },
    { departure_date: future },
    { actual_arrival_date: future },
  ]) {
    assert.throws(() => resolveObservedTime(payload, NOW), /cannot be recorded as moving at a time in the future/,
      `a future time was accepted as ${JSON.stringify(payload)}`);
  }
});

test('T11: a nonsense time is refused rather than silently becoming now', () => {
  assert.throws(() => resolveObservedTime({ event_time: 'last tuesday' }, NOW), /not a valid date and time/);
});

test('T11: the column and the timeline are given the SAME value, from one call', async () => {
  const source = await import('node:fs').then((fs) => fs.promises.readFile('backend/services/diaspora/diasporaShipmentService.js', 'utf8'));
  const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  // Exactly one resolution per stage change…
  const calls = code.match(/resolveObservedTime\(/g) || [];
  assert.equal(calls.length, 2, `resolveObservedTime is defined once and called once; found ${calls.length} occurrences`);
  // …and that one value reaches BOTH the observed columns and the timeline event. Point any of
  // these three at `now` (or at a second resolution) and this goes red.
  assert.match(code, /departure_date: observedAt/, 'the observed departure column does not use the resolved time');
  assert.match(code, /actual_arrival_date: observedAt/, 'the observed arrival column does not use the resolved time');
  assert.match(code, /writeShipmentStageEvent\(.*event_time: observedAt/, 'the timeline event does not use the resolved time');
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
