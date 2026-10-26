/**
 * T11-CAP-09 — Journey intelligence: what the recorded observations let us say, and no more.
 *
 * The sentences this unit has to be able to say, and the ones it must refuse:
 *
 *   1. a number is DERIVED from a recorded observation or it is absent — never from a plan, an estimate or a
 *      guess, and never zero standing in for "unknown";
 *   2. below a stated minimum, the honest answer is "not enough data" — and the answer does not leak how many
 *      journeys there were;
 *   3. a route statistic describes journeys that already happened. It is not a prediction for this one;
 *   4. a route statistic is built only from the SAME organiser's own completed sailings — never from another
 *      tenant's data — and counts SAILINGS, not shipments (co-loaders on one container are one sailing);
 *   5. nothing here writes anything, and it cannot move the journey's state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { getJourney, JOURNEY_STATES } = await import('../services/diaspora/journeyProjectionService.js');
const {
  MIN_SAILINGS, median, projectLaneStatistics, projectOwnMetrics,
} = await import('../services/diaspora/journeyIntelligence.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T00:00:00Z');
const BUYER = { id: 'u-buyer', platformRole: 'member' };

// ── Pure arithmetic ────────────────────────────────────────────────────────────────────────────────

test('CAP-09: the median is the middle value, or the mean of the two middle values', () => {
  assert.equal(median([3]), 3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([10, 10, 10, 10]), 10);
});

test('CAP-09: the median of nothing is nothing, never zero', () => {
  assert.equal(median([]), null);
  assert.equal(median(undefined), null);
});

test('CAP-09: the minimum is five sailings, and it is a number the page can state', () => {
  assert.equal(MIN_SAILINGS, 5);
});

// ── This journey's own observations ────────────────────────────────────────────────────────────────

const dates = (over = {}) => ({
  planned_departure: '2026-09-20T00:00:00Z', observed_departure: null, estimated_arrival: '2026-10-15T00:00:00Z', observed_arrival: null, ...over,
});

test('CAP-09: with no recorded departure there is no transit time — not zero, not a plan-based figure', () => {
  const m = projectOwnMetrics(dates(), NOW);
  assert.equal(m.days_in_transit.value, null);
  assert.match(m.days_in_transit.note, /no departure has been recorded/i);
});

test('CAP-09: a PLANNED departure is not an observation and produces nothing', () => {
  const m = projectOwnMetrics(dates({ planned_departure: '2026-01-01T00:00:00Z', observed_departure: null }), NOW);
  assert.equal(m.days_in_transit.value, null);
});

test('CAP-09: a recorded departure with no arrival is "so far" — whole days, never rounded up', () => {
  const m = projectOwnMetrics(dates({ observed_departure: new Date(NOW - (12.9 * DAY)).toISOString() }), NOW);
  assert.equal(m.days_in_transit.value, 12);
  assert.equal(m.days_in_transit.ongoing, true);
});

test('CAP-09: a recorded departure and arrival is the transit that took place', () => {
  const m = projectOwnMetrics(dates({ observed_departure: '2026-09-20T00:00:00Z', observed_arrival: '2026-10-14T12:00:00Z' }), NOW);
  assert.equal(m.days_in_transit.value, 25);
  assert.equal(m.days_in_transit.ongoing, false);
});

test('CAP-09: an arrival recorded BEFORE the departure is a disagreement, not a negative transit', () => {
  const m = projectOwnMetrics(dates({ observed_departure: '2026-10-10T00:00:00Z', observed_arrival: '2026-10-01T00:00:00Z' }), NOW);
  assert.equal(m.days_in_transit.value, null);
  assert.match(m.days_in_transit.note, /disagree/i);
});

test('CAP-09: arrival against the FIRST estimate is signed — later is positive, earlier negative, on the day is zero', () => {
  const at = (arrival) => projectOwnMetrics(dates({ observed_departure: '2026-09-20T00:00:00Z', observed_arrival: arrival }), NOW).arrival_vs_first_estimate_days.value;
  assert.equal(at('2026-10-18T00:00:00Z'), 3);
  assert.equal(at('2026-10-12T00:00:00Z'), -3);
  assert.equal(at('2026-10-15T00:00:00Z'), 0);
});

test('CAP-09: zero days is a real answer ("on the day"), distinct from no answer', () => {
  const m = projectOwnMetrics(dates({ observed_departure: '2026-09-20T00:00:00Z', observed_arrival: '2026-10-15T00:00:00Z' }), NOW);
  assert.equal(m.arrival_vs_first_estimate_days.value, 0);
  assert.notEqual(m.arrival_vs_first_estimate_days.value, null);
});

test('CAP-09: without an arrival there is no comparison with the estimate — an estimate is not an arrival', () => {
  const m = projectOwnMetrics(dates({ observed_departure: '2026-09-20T00:00:00Z' }), NOW);
  assert.equal(m.arrival_vs_first_estimate_days.value, null);
  assert.match(m.arrival_vs_first_estimate_days.note, /not arrived|no arrival/i);
});

test('CAP-09: without a first estimate there is nothing to compare an arrival with', () => {
  const m = projectOwnMetrics(dates({ estimated_arrival: null, observed_departure: '2026-09-20T00:00:00Z', observed_arrival: '2026-10-14T00:00:00Z' }), NOW);
  assert.equal(m.arrival_vs_first_estimate_days.value, null);
});

test('CAP-09: no field of the own metrics predicts anything', () => {
  const m = projectOwnMetrics(dates({ observed_departure: '2026-09-20T00:00:00Z' }), NOW);
  const text = JSON.stringify(m).toLowerCase();
  for (const word of ['predict', 'expected to', 'will arrive', 'likely', 'forecast', 'on track']) assert.ok(!text.includes(word), `own metrics speak of "${word}"`);
});

// ── Route statistics: the same organiser's completed sailings ──────────────────────────────────────

const SHIPMENT = () => ({ id: 'ship-own', tenant_id: 'tenant-1', container_id: 'cont-own', origin_port: 'Yokohama', destination_port: 'Dar es Salaam', import_order_id: 'ord-a' });
const done = (id, container, days, over = {}) => ({
  id, tenant_id: 'tenant-1', container_id: container, origin_port: 'Yokohama', destination_port: 'Dar es Salaam',
  departure_date: '2026-06-01T00:00:00Z', actual_arrival_date: new Date(Date.parse('2026-06-01T00:00:00Z') + days * DAY).toISOString(),
  estimated_arrival_date: new Date(Date.parse('2026-06-01T00:00:00Z') + (days - 2) * DAY).toISOString(), deleted_at: null, ...over,
});
const lane = (rows, shipment = SHIPMENT()) => projectLaneStatistics(createMockSupabase({ diaspora_shipments: rows }), shipment);
const sailings = (n, days = 30) => Array.from({ length: n }, (_, i) => done(`s${i}`, `c${i}`, days + i));

test('CAP-09: four sailings is not enough — the answer is "not enough data" and it does not say how many', async () => {
  const out = await lane(sailings(4));
  assert.equal(out.availability, 'insufficient_data');
  assert.equal(out.minimum_sailings, 5);
  assert.match(out.note, /not enough/i);
  for (const leak of ['sailings', 'sample', 'count', 'transit_days', 'median']) assert.ok(!(leak in out), `"${leak}" leaked from an insufficient sample`);
  assert.ok(!/\b4\b|four/i.test(JSON.stringify(out)), 'the insufficient answer revealed how many journeys exist');
});

test('CAP-09: five sailings is enough, and the statistics are exactly the median, shortest and longest', async () => {
  const out = await lane(sailings(5, 30)); // 30, 31, 32, 33, 34
  assert.equal(out.availability, 'sufficient');
  assert.equal(out.sailings, 5);
  assert.deepEqual(out.transit_days, { median: 32, min: 30, max: 34 });
});

test('CAP-09: the boundary is exactly the minimum — five qualifies, four does not', async () => {
  assert.equal((await lane(sailings(MIN_SAILINGS - 1))).availability, 'insufficient_data');
  assert.equal((await lane(sailings(MIN_SAILINGS))).availability, 'sufficient');
});

test('CAP-09: it counts SAILINGS, not shipments — nine co-loaders on one container are one sailing', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => done(`co${i}`, 'one-container', 30));
  assert.equal((await lane(rows)).availability, 'insufficient_data');
  const mixed = [...rows, ...sailings(3)]; // 1 + 3 = 4 sailings
  assert.equal((await lane(mixed)).availability, 'insufficient_data');
  assert.equal((await lane([...rows, ...sailings(4)])).availability, 'sufficient'); // 1 + 4 = 5
});

test('CAP-09: a sailing with several shipments contributes ONE value — their median — not a weight', async () => {
  const rows = [done('a1', 'big', 20), done('a2', 'big', 20), done('a3', 'big', 40), ...sailings(4, 100)];
  const out = await lane(rows);
  assert.equal(out.availability, 'sufficient');
  assert.equal(out.sailings, 5);
  assert.equal(out.transit_days.min, 20);
});

test('CAP-09: another organiser\'s sailings are never used — however many there are', async () => {
  const others = Array.from({ length: 20 }, (_, i) => done(`o${i}`, `oc${i}`, 5, { tenant_id: 'tenant-OTHER' }));
  assert.equal((await lane([...others, ...sailings(4)])).availability, 'insufficient_data');
  const out = await lane([...others, ...sailings(5, 30)]);
  assert.deepEqual(out.transit_days, { median: 32, min: 30, max: 34 }, 'another organiser\'s data changed the statistic');
});

test('CAP-09: a different route is a different statistic', async () => {
  const other = Array.from({ length: 10 }, (_, i) => done(`r${i}`, `rc${i}`, 5, { origin_port: 'Osaka' }));
  const other2 = Array.from({ length: 10 }, (_, i) => done(`q${i}`, `qc${i}`, 5, { destination_port: 'Beira' }));
  assert.equal((await lane([...other, ...other2, ...sailings(4)])).availability, 'insufficient_data');
});

test('CAP-09: this journey\'s own shipment is not part of its own statistic', async () => {
  const own = done('ship-own', 'cont-own', 30);
  assert.equal((await lane([own, ...sailings(4)])).availability, 'insufficient_data');
});

test('CAP-09: only OBSERVED journeys count — a missing departure or arrival excludes a shipment', async () => {
  const unfinished = [
    done('u1', 'uc1', 30, { departure_date: null }), done('u2', 'uc2', 30, { actual_arrival_date: null }),
    done('u3', 'uc3', 30, { departure_date: null, actual_arrival_date: null }),
  ];
  assert.equal((await lane([...unfinished, ...sailings(4)])).availability, 'insufficient_data');
});

test('CAP-09: an impossible duration (arrival before departure) is dropped, not counted as a sailing', async () => {
  const bad = done('bad', 'bc', -3);
  assert.equal((await lane([bad, ...sailings(4)])).availability, 'insufficient_data');
});

test('CAP-09: a deleted shipment is not a journey that happened', async () => {
  const gone = sailings(5).map((s) => ({ ...s, deleted_at: '2026-09-01T00:00:00Z' }));
  assert.equal((await lane(gone)).availability, 'insufficient_data');
});

test('CAP-09: a shipment with no organiser recorded has no organiser to compare against — fail closed', async () => {
  const out = await lane(sailings(10), { ...SHIPMENT(), tenant_id: null });
  assert.equal(out.availability, 'not_applicable');
  assert.match(out.note, /organiser/i);
});

test('CAP-09: a route needs both ports on the record, or there is no route', async () => {
  for (const missing of [{ origin_port: null }, { destination_port: null }, { origin_port: '  ' }]) {
    const out = await lane(sailings(10), { ...SHIPMENT(), ...missing });
    assert.equal(out.availability, 'not_applicable');
    assert.match(out.note, /both ports/i);
  }
});

test('CAP-09: the sufficient answer is aggregates only — no id, container, organiser, order or carrier', async () => {
  const rows = sailings(6).map((r) => ({ ...r, carrier_name: 'SECRET-CARRIER', import_order_id: 'SECRET-ORDER', metadata: { x: 'SECRET-META' }, tracking_number: 'SECRET-TRK' }));
  const out = await lane(rows);
  assert.equal(out.availability, 'sufficient');
  const text = JSON.stringify(out);
  for (const leak of ['SECRET', 'tenant-1', 'cont-own', 'ship-own', 'c0', 's0', 'Yokohama', 'Dar es Salaam']) assert.ok(!text.includes(leak), `${leak} leaked into the statistic`);
  assert.deepEqual(Object.keys(out).sort(), ['arrival_vs_estimate_days', 'availability', 'minimum_sailings', 'note', 'sailings', 'transit_days']);
  assert.deepEqual(Object.keys(out.transit_days).sort(), ['max', 'median', 'min']);
});

test('CAP-09: route statistics are whole days — real durations have hours in them, and false precision is a claim', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => done(`f${i}`, `fc${i}`, 30.4 + i)); // 30.4 … 34.4 days
  const out = await lane(rows);
  assert.deepEqual(out.transit_days, { median: 32, min: 30, max: 34 });
  for (const v of Object.values(out.transit_days)) assert.ok(Number.isInteger(v), `${v} is not a whole number of days`);
});

test('CAP-09: arrival against the estimate is also in whole days', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => {
    const r = done(`g${i}`, `gc${i}`, 30);
    return { ...r, estimated_arrival_date: new Date(Date.parse(r.actual_arrival_date) - 2.4 * DAY).toISOString() };
  });
  const out = await lane(rows);
  assert.equal(out.arrival_vs_estimate_days.median_days, 2);
  assert.ok(Number.isInteger(out.arrival_vs_estimate_days.median_days));
});

test('CAP-09: arrival against the estimate needs its own minimum — missing estimates cannot be filled in', async () => {
  const rows = sailings(5).map((r, i) => (i < 2 ? { ...r, estimated_arrival_date: null } : r));
  const out = await lane(rows);
  assert.equal(out.availability, 'sufficient');
  assert.equal(out.arrival_vs_estimate_days.availability, 'insufficient_data');
  assert.ok(!('median_days' in out.arrival_vs_estimate_days), 'a median was reported from fewer than the minimum');
});

test('CAP-09: when the estimates are all there, arrival against the estimate is the signed median', async () => {
  const out = await lane(sailings(5)); // every sailing arrived 2 days after its own estimate
  assert.equal(out.arrival_vs_estimate_days.availability, 'sufficient');
  assert.equal(out.arrival_vs_estimate_days.median_days, 2);
});

test('CAP-09: the route statistic says it describes journeys already completed and predicts nothing', async () => {
  const text = JSON.stringify(await lane(sailings(5))).toLowerCase();
  assert.match(text, /already completed|already been completed|have completed/);
  assert.match(text, /not a prediction/);
  for (const word of ['will arrive', 'expected to arrive', 'likely', 'forecast', 'on track', 'guarantee']) assert.ok(!text.includes(word), `speaks of "${word}"`);
});

test('CAP-09: the statistic writes nothing', async () => {
  const client = createMockSupabase({ diaspora_shipments: sailings(5) });
  const writes = [];
  const trapped = { ...client, from(table) {
    const chain = client.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  await projectLaneStatistics(trapped, SHIPMENT());
  assert.deepEqual(writes, []);
});

test('CAP-09: one read, however many completed sailings there are', async () => {
  const count = async (rows) => {
    const client = createMockSupabase({ diaspora_shipments: rows });
    let n = 0;
    await projectLaneStatistics({ ...client, from(t) { n += 1; return client.from(t); } }, SHIPMENT());
    return n;
  };
  assert.equal(await count(sailings(5)), await count(sailings(120)), 'reads grew with the number of sailings');
});

// ── Composed into the Journey ──────────────────────────────────────────────────────────────────────

function world(over = {}) {
  return createMockSupabase({
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', linked_vehicle_vin: null, status: 'SHIPPED', deleted_at: null }],
    diaspora_import_order_participants: [], vehicles: [],
    diaspora_container_shipments: [{ id: 'cont-own', tenant_id: 'tenant-1', coordinator_id: 'u-operator', status: 'SHIPPED', deleted_at: null }],
    diaspora_cargo_reservations: over.reservations || [{ id: 'res-a', tenant_id: 'tenant-1', container_id: 'cont-own', import_order_id: 'ord-a', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }],
    diaspora_container_loads: [{ id: 'load-1', container_id: 'cont-own', status: 'COMPLETED', confirmed_at: '2026-09-12T10:00:00Z', deleted_at: null }],
    diaspora_container_load_items: over.items || [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LOADED', deleted_at: null }],
    diaspora_shipments: [
      { id: 'ship-own', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-own', status: 'IN_TRANSIT', carrier_name: 'Carrier X', tracking_number: 'TRK-1',
        origin_port: 'Yokohama', destination_port: 'Dar es Salaam', departure_date: over.departure === undefined ? '2026-10-01T00:00:00Z' : over.departure,
        estimated_arrival_date: '2026-10-25T00:00:00Z', actual_arrival_date: over.arrival ?? null, metadata: { planned_departure_date: '2026-09-20T00:00:00Z' }, created_by: 'u-operator', deleted_at: null },
      ...(over.lane || []),
    ],
    diaspora_shipment_stage_events: [], diaspora_shipment_legs: [], diaspora_shipment_observations: [],
    trade_document_types: [], diaspora_trade_documents: [], diaspora_trade_document_readiness: [],
    diaspora_customs_cases: [], diaspora_customs_events: [], diaspora_customs_agent_appointments: [], diaspora_import_quotes: [],
  });
}
const journey = (w, extra = {}) => getJourney('import_order', 'ord-a', BUYER, { supabaseClient: w, now: NOW, ...extra });

test('CAP-09: the Journey carries an intelligence section for the shipment it resolved', async () => {
  const j = await journey(world());
  assert.equal(j.sections.intelligence.availability, 'composed');
  assert.equal(j.sections.intelligence.own.days_in_transit.value, 19);
  assert.equal(j.sections.intelligence.own.days_in_transit.ongoing, true);
  assert.equal(j.sections.intelligence.lane.availability, 'insufficient_data');
});

test('CAP-09: with enough of the organiser\'s own completed sailings the route statistic is composed', async () => {
  const j = await journey(world({ lane: sailings(5, 30) }));
  assert.equal(j.sections.intelligence.lane.availability, 'sufficient');
  assert.deepEqual(j.sections.intelligence.lane.transit_days, { median: 32, min: 30, max: 34 });
});

test('CAP-09: a journey with no shipment, or cargo that did not travel, has no statistics to give', async () => {
  const w = createMockSupabase({
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', status: 'SHIPPED', deleted_at: null }],
    diaspora_import_order_participants: [], vehicles: [], diaspora_container_shipments: [], diaspora_cargo_reservations: [], diaspora_container_loads: [],
    diaspora_container_load_items: [], diaspora_shipments: [], diaspora_shipment_stage_events: [], diaspora_shipment_legs: [], diaspora_shipment_observations: [],
    trade_document_types: [], diaspora_trade_documents: [], diaspora_trade_document_readiness: [], diaspora_customs_cases: [], diaspora_customs_events: [],
    diaspora_customs_agent_appointments: [], diaspora_import_quotes: [],
  });
  const j = await journey(w);
  assert.equal(j.state, JOURNEY_STATES.NO_SHIPMENT);
  assert.equal(j.sections.intelligence.availability, 'not_applicable');
  const left = await journey(world({ items: [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LEFT_BEHIND', deleted_at: null }] }));
  assert.equal(left.sections.intelligence.availability, 'not_applicable');
});

test('CAP-09: an ambiguous association has no statistics — the journey does not know which shipment it is', async () => {
  const w = world({ lane: [{ id: 'ship-2', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-own', status: 'IN_TRANSIT', origin_port: 'Yokohama', destination_port: 'Dar es Salaam', departure_date: null, estimated_arrival_date: null, actual_arrival_date: null, metadata: {}, deleted_at: null }] });
  const j = await journey(w);
  assert.equal(j.sections.intelligence.availability, 'not_applicable');
});

test('CAP-09: a shipment sailing on a DIFFERENT container than the booking has no statistics — the records disagree', async () => {
  const w2 = createMockSupabase({
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', status: 'SHIPPED', deleted_at: null }],
    diaspora_import_order_participants: [], vehicles: [],
    diaspora_container_shipments: [{ id: 'cont-own', tenant_id: 'tenant-1', coordinator_id: 'u-operator', status: 'SHIPPED', deleted_at: null }],
    diaspora_cargo_reservations: [{ id: 'res-a', tenant_id: 'tenant-1', container_id: 'cont-own', import_order_id: 'ord-a', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }],
    diaspora_container_loads: [{ id: 'load-1', container_id: 'cont-own', status: 'COMPLETED', confirmed_at: '2026-09-12T10:00:00Z', deleted_at: null }],
    diaspora_container_load_items: [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LOADED', deleted_at: null }],
    diaspora_shipments: [{ id: 'ship-x', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-OTHER', status: 'IN_TRANSIT', origin_port: 'Yokohama', destination_port: 'Dar es Salaam',
      departure_date: '2026-10-01T00:00:00Z', estimated_arrival_date: '2026-10-25T00:00:00Z', actual_arrival_date: null, metadata: {}, deleted_at: null }, ...sailings(6)],
    diaspora_shipment_stage_events: [], diaspora_shipment_legs: [], diaspora_shipment_observations: [], trade_document_types: [], diaspora_trade_documents: [],
    diaspora_trade_document_readiness: [], diaspora_customs_cases: [], diaspora_customs_events: [], diaspora_customs_agent_appointments: [], diaspora_import_quotes: [],
  });
  const j = await journey(w2);
  assert.equal(j.shipping.association, 'order_container_mismatch');
  assert.equal(j.sections.intelligence.availability, 'not_applicable');
});

test('CAP-09: intelligence cannot move the journey state', async () => {
  const bare = await journey(world());
  const rich = await journey(world({ lane: sailings(8) }));
  assert.equal(rich.state, bare.state);
  assert.equal(rich.sentence, bare.sentence);
});

test('CAP-09: the Journey\'s statistics carry no other journey\'s identity', async () => {
  const lane2 = sailings(6).map((r) => ({ ...r, carrier_name: 'SECRET-CARRIER', tracking_number: 'SECRET-TRK', import_order_id: 'SECRET-ORDER', metadata: { note: 'SECRET-META' } }));
  const text = JSON.stringify((await journey(world({ lane: lane2 }))).sections.intelligence);
  for (const leak of ['SECRET', 'c0', 's0', 'cont-own', 'ship-own', 'tenant-1']) assert.ok(!text.includes(leak), `${leak} leaked into the intelligence section`);
});

test('CAP-09: reads stay bounded however many completed sailings the organiser has', async () => {
  const count = async (lane2) => {
    const client = world({ lane: lane2 });
    let n = 0;
    await journey({ ...client, from(t) { n += 1; return client.from(t); } });
    return n;
  };
  assert.equal(await count(sailings(5)), await count(sailings(150)), 'the Journey\'s reads grew with the organiser\'s history');
});

test('CAP-09: composing statistics writes nothing', async () => {
  const client = world({ lane: sailings(6) });
  const writes = [];
  const trapped = { ...client, from(table) {
    const chain = client.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  await journey(trapped);
  assert.deepEqual(writes, []);
});

test('CAP-09: provenance says the statistics are derived from recorded dates, stored nowhere and predicting nothing', async () => {
  const j = await journey(world());
  assert.equal(j.provenance.intelligence.authority, 'derived');
  assert.match(j.provenance.intelligence.note, /recorded/i);
  assert.match(j.provenance.intelligence.note, /nothing is stored/i);
});

test('CAP-09: a viewer who is not the buyer sees the same aggregates and nothing more private', async () => {
  const w = world({ lane: sailings(5, 30) });
  const asBuyer = (await journey(w)).sections.intelligence;
  const asAdmin = (await getJourney('import_order', 'ord-a', { id: 'u-admin', platformRole: 'platform_admin' }, { supabaseClient: w, now: NOW })).sections.intelligence;
  assert.deepEqual(asAdmin, asBuyer);
});

test('CAP-09: an arrived journey is described by what happened, and compared with its first estimate', async () => {
  const j = await journey(world({ arrival: '2026-10-28T00:00:00Z' }));
  assert.equal(j.sections.intelligence.own.days_in_transit.value, 27);
  assert.equal(j.sections.intelligence.own.days_in_transit.ongoing, false);
  assert.equal(j.sections.intelligence.own.arrival_vs_first_estimate_days.value, 3);
});

test('CAP-09: a journey that has not left has no transit time yet', async () => {
  const j = await journey(world({ departure: null }));
  assert.equal(j.sections.intelligence.own.days_in_transit.value, null);
});
