/**
 * T11-CAP-08 — Journey alerts, through T7.
 *
 * The sentences this unit has to be able to say, and the ones it must refuse:
 *
 *   1. the people told a shipment moved are EXACTLY the people whose Journey shows that shipment —
 *      a co-loader whose cargo was left behind is not told it sailed;
 *   2. an alert says what the shipment authority recorded and no more: departed is not arrived,
 *      arrived is not delivered or cleared, a hold is not a customs decision, an estimate is not an arrival;
 *   3. one observation is one alert — a redelivered event, a retried handler and a replayed request
 *      never tell anyone twice, and a burst of estimate edits does not become a storm;
 *   4. an alert is addressed with the recipient's OWN order and nothing about anyone else's;
 *   5. a notification never creates shipment state, and nothing here goes anywhere but in-app.
 *
 * Wiring is tested through the real event worker and the real services, not only through injected
 * collaborators: an alert path that is correct and never reached is the failure this phase is most
 * likely to hide.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { getJourney, shipmentReference } = await import('../services/diaspora/journeyProjectionService.js');
const { deterministicEventIdentity } = await import('../services/eventBus/eventBusService.js');
const { eventWorker } = await import('../services/eventBus/eventWorker.js');
const { COMMUNICATION_EVENT_TYPES } = await import('../services/communication/communicationEventListeners.js');
const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');
const { CommunicationTemplateService } = await import('../services/communication/communicationTemplateService.js');
const { recordEtaRevision } = await import('../services/diaspora/diasporaShipmentObservationService.js');
const { MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
const {
  ETA_ALERT_WINDOW_MINUTES, JOURNEY_ALERT_EVENTS, JOURNEY_ALERT_KINDS, JourneyAlertDeliveryError, STAGE_ALERTS,
  alertKeyFor, handleShipmentStageEvent, journeyAlertText, notifyJourneyAlert, registerJourneyAlertListeners, resolveAlertRecipients,
} = await import('../services/diaspora/journeyAlertNotifier.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const OPERATOR = { id: 'u-operator', platformRole: 'member' };

function world(over = {}) {
  const shipment = (id, extra = {}) => ({
    id, tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'IN_TRANSIT',
    carrier_name: 'Carrier X', tracking_number: 'TRK-1', origin_port: 'Origin Port', destination_port: 'Dest Port',
    departure_date: null, estimated_arrival_date: '2026-10-01T00:00:00Z', actual_arrival_date: null,
    metadata: { planned_departure_date: '2026-09-20T00:00:00Z', planned_departure_source: 'stated_at_creation' },
    created_by: 'u-operator', deleted_at: null, ...extra,
  });
  const order = (id, buyer, extra = {}) => ({
    id, tenant_id: 'tenant-1', buyer_id: buyer, created_by: buyer, linked_vehicle_vin: null, status: 'SHIPPED', deleted_at: null, ...extra,
  });
  const res = (id, orderId, buyer, extra = {}) => ({
    id, tenant_id: 'tenant-1', container_id: 'cont-1', import_order_id: orderId, buyer_id: buyer, created_by: buyer, deleted_at: null, ...extra,
  });
  const item = (id, resId, outcome) => ({ id, load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: resId, outcome, deleted_at: null });
  return createMockSupabase({
    diaspora_import_orders: over.orders || [
      order('ord-a', 'u-buyer', { created_by: 'u-creator-a' }),
      order('ord-b', 'u-coloader'),
      order('ord-c', 'u-left'),
      order('ord-d', 'u-notloaded'),
      order('ord-other', 'u-stranger'),
    ],
    diaspora_import_order_participants: [],
    vehicles: [],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', status: 'SHIPPED', deleted_at: null }],
    diaspora_cargo_reservations: over.reservations || [
      res('res-a', 'ord-a', 'u-buyer'), res('res-b', 'ord-b', 'u-coloader'), res('res-c', 'ord-c', 'u-left'), res('res-d', 'ord-d', 'u-notloaded'),
    ],
    diaspora_container_loads: over.loads || [{ id: 'load-1', container_id: 'cont-1', status: 'COMPLETED', confirmed_at: '2026-09-12T10:00:00Z', deleted_at: null }],
    diaspora_container_load_items: over.items || [item('li-a', 'res-a', 'LOADED'), item('li-b', 'res-b', 'LOADED'), item('li-c', 'res-c', 'LEFT_BEHIND')],
    diaspora_shipments: over.shipments === undefined ? [shipment('ship-1')] : over.shipments.map((s) => shipment(s.id, s)),
    diaspora_shipment_stage_events: [],
    diaspora_shipment_legs: [],
    diaspora_shipment_observations: over.observations || [],
    trade_document_types: [],
    diaspora_trade_documents: [],
    diaspora_trade_document_readiness: [],
    diaspora_customs_cases: [],
    diaspora_customs_events: [],
    diaspora_customs_agent_appointments: [],
    diaspora_import_quotes: [],
  });
}

const SHIPMENT = () => ({ id: 'ship-1', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1' });

/** An outbox that enforces the SAME identity the database trigger derives, using the real JS registry. */
function bus({ failFor = null } = {}) {
  const events = [];
  const ctl = { failFor };
  const emit = async (_pg, type, payload, tenantId = null) => {
    if (ctl.failFor && payload.recipientUserId === ctl.failFor) throw new Error('outbox unavailable');
    const identity = deterministicEventIdentity(type, payload);
    if (identity) {
      const existing = events.find((e) => e.dedupe_key === identity.dedupeKey);
      if (existing) return existing;
    }
    const row = { id: `evt-${events.length + 1}`, event_type: type, payload, tenant_id: tenantId, dedupe_key: identity?.dedupeKey ?? null };
    events.push(row);
    return row;
  };
  return { events, emit, ctl };
}

const stageEvent = (stage, id = 'outbox-1') => ({
  payload: { shipmentId: 'ship-1', importOrderId: 'ord-a', stage },
  outbox: { id, event_type: `DIASPORA_SHIPMENT_${stage}`, attempts: 0, tenant_id: 'tenant-1' },
});
const run = (w, b, stage, id) => {
  const e = stageEvent(stage, id);
  return handleShipmentStageEvent(e.payload, e.outbox, { client: w, emitEvent: b.emit });
};
const recipientsOf = (b) => b.events.map((e) => e.payload.recipientUserId).sort();

// ── Policy, registry and the governed template ────────────────────────────────────────────────────

test('CAP-08: both alert events are subscribed, have a policy, and route in-app only by policy', () => {
  for (const type of Object.values(JOURNEY_ALERT_EVENTS)) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(type), `${type} is not subscribed`);
    const p = NOTIFICATION_POLICIES[type];
    assert.ok(p, `${type} has no policy`);
    assert.deepEqual(p.channels, ['in_app'], `${type} must not route externally`);
    assert.deepEqual(p.fallbackChannels, [], `${type} must not fall back to another channel`);
    assert.equal(p.policyChannelsOnly, true);
    assert.equal(p.transactional, true);
    assert.equal(p.classification, 'transactional');
    assert.equal(p.templateKey, 'journey_update_v1');
  }
});

test('CAP-08: an exception is high priority; the other alerts are ordinary', () => {
  assert.equal(NOTIFICATION_POLICIES[JOURNEY_ALERT_EVENTS.EXCEPTION].priority, 'high');
  assert.equal(NOTIFICATION_POLICIES[JOURNEY_ALERT_EVENTS.ALERT].priority, 'normal');
});

test('CAP-08: both alert events have a deterministic identity, in the format the database derives', () => {
  for (const type of Object.values(JOURNEY_ALERT_EVENTS)) {
    const identity = deterministicEventIdentity(type, { alertKey: 'DEPARTED:ord-a:u-buyer:evt-1' });
    assert.deepEqual(identity, { eventType: type, field: 'alertKey', value: 'DEPARTED:ord-a:u-buyer:evt-1', dedupeKey: `${type}:DEPARTED:ord-a:u-buyer:evt-1` });
    assert.equal(deterministicEventIdentity(type, {}), null, 'no key must mean no identity, never a shared one');
    assert.equal(deterministicEventIdentity(type, { alertKey: '  ' }), null);
  }
});

test('CAP-08: the migration derives the same key as the JS registry, for exactly these two events', () => {
  const file = fs.readdirSync(path.join(ROOT, 'database', 'migrations')).find((f) => /trade_os_cap08_journey_alerts\.sql$/.test(f));
  assert.ok(file, 'the CAP-08 migration is missing');
  const sql = fs.readFileSync(path.join(ROOT, 'database', 'migrations', file), 'utf8');
  const up = sql.split(/^-- \+migrate Down/m)[0];
  for (const type of Object.values(JOURNEY_ALERT_EVENTS)) assert.ok(up.includes(`'${type}'`), `${type} is not in the dedupe function`);
  assert.match(up, /NEW\.payload\s*->>\s*'alertKey'/);
  assert.match(up, /NEW\.event_type\s*\|\|\s*':'\s*\|\|\s*v_alert_key/);
});

test('CAP-08: the governed template renders the sentence under the shipment reference — nothing else', () => {
  const t = new CommunicationTemplateService();
  const text = journeyAlertText(JOURNEY_ALERT_KINDS.DEPARTED);
  const out = t.render('journey_update_v1', { reference: 'SHPM-ABCD1234', status: text });
  assert.equal(out.subject, 'Your shipment SHPM-ABCD1234');
  assert.equal(out.body, text);
  assert.equal(out.transactional, true);
});

// ── What an alert is allowed to say ────────────────────────────────────────────────────────────────

test('CAP-08: every alert points at the journey, and none claims more than was recorded', () => {
  const all = [
    journeyAlertText('DEPARTED'), journeyAlertText('ARRIVED'), journeyAlertText('EXCEPTION'),
    journeyAlertText('EXCEPTION', { stage: 'CUSTOMS_HOLD' }), journeyAlertText('ETA_CHANGED'),
  ];
  for (const text of all) {
    assert.match(text, /open your journey/i);
    assert.ok(!/\b(cleared|released|duty paid|approved|guaranteed|delivered to you|on time|will arrive)\b/i.test(text.replace(/not (delivery|customs clearance|a customs decision)[^.]*/gi, '')), `over-claims: ${text}`);
  }
});

test('CAP-08: departed is recorded-as-departed — never arrived, never "on its way to you"', () => {
  const t = journeyAlertText('DEPARTED');
  assert.match(t, /recorded your shipment as departed/i);
  assert.ok(!/arriv/i.test(t));
});

test('CAP-08: arrived is the shipment\'s arrival — and says it is not delivery or customs clearance', () => {
  const t = journeyAlertText('ARRIVED');
  assert.match(t, /recorded your shipment as arrived/i);
  assert.match(t, /not delivery/i);
  assert.match(t, /not customs clearance/i);
});

test('CAP-08: an exception and a hold are where the goods are — never a customs decision', () => {
  assert.match(journeyAlertText('EXCEPTION'), /not a customs decision/i);
  const hold = journeyAlertText('EXCEPTION', { stage: 'CUSTOMS_HOLD' });
  assert.match(hold, /hold/i);
  assert.match(hold, /not a customs decision/i);
  assert.notEqual(hold, journeyAlertText('EXCEPTION'));
});

test('CAP-08: a changed estimate is an estimate — it is not an arrival and carries no date that could go stale', () => {
  const t = journeyAlertText('ETA_CHANGED');
  assert.match(t, /estimate is not an arrival/i);
  assert.ok(!/\d{4}-\d{2}-\d{2}|\b20\d{2}\b/.test(t), 'a date in the text would be stale by the time a later revision lands');
});

test('CAP-08: an unknown kind has no words — it is refused, never given a generic sentence', () => {
  assert.throws(() => journeyAlertText('SOMETHING_ELSE'), /unknown/i);
});

// ── Who is told ────────────────────────────────────────────────────────────────────────────────────

test('CAP-08: the order\'s buyer and creator are told once each; a co-loader whose cargo is loaded is told for their own order', async () => {
  const got = await resolveAlertRecipients(SHIPMENT(), { client: world() });
  assert.deepEqual(got.map((r) => `${r.userId}@${r.orderId}`).sort(), ['u-buyer@ord-a', 'u-coloader@ord-b', 'u-creator-a@ord-a']);
});

test('CAP-08: left-behind, not-loaded, unrelated and operator users are told nothing', async () => {
  const users = (await resolveAlertRecipients(SHIPMENT(), { client: world() })).map((r) => r.userId);
  for (const nobody of ['u-left', 'u-notloaded', 'u-stranger', 'u-operator']) assert.ok(!users.includes(nobody), `${nobody} was told`);
});

test('CAP-08: a buyer who is also the creator is told once, not twice', async () => {
  const users = (await resolveAlertRecipients(SHIPMENT(), { client: world() })).filter((r) => r.orderId === 'ord-b');
  assert.equal(users.length, 1);
});

test('CAP-08: an ambiguous shipment tells nobody — the Journey shows no movement either', async () => {
  // ord-b has two candidate shipments on its container (ship-1 for ord-a, ship-2 for ord-x): which one is
  // its own cannot be said, so it is not told that ship-1 moved. ord-a has exactly one of its own.
  const w = world({ shipments: [{ id: 'ship-1', import_order_id: 'ord-a' }, { id: 'ship-2', import_order_id: 'ord-x' }] });
  const told = await resolveAlertRecipients({ id: 'ship-1', import_order_id: 'ord-a', container_id: 'cont-1' }, { client: w });
  assert.deepEqual(told.map((r) => `${r.userId}@${r.orderId}`).sort(), ['u-buyer@ord-a', 'u-creator-a@ord-a']);
  const j = await getJourney('import_order', 'ord-b', { id: 'u-coloader', platformRole: 'member' }, { supabaseClient: w });
  assert.equal(j.state, 'SHIPMENT_AMBIGUOUS', 'the Journey and the alert disagree about whether this is ambiguous');
});

test('CAP-08: a shipment attached to the order but sailing on a DIFFERENT container is not alerted — the records disagree', async () => {
  const w = world({ shipments: [{ id: 'ship-1', import_order_id: 'ord-a', container_id: 'cont-OTHER' }] });
  const told = await resolveAlertRecipients({ id: 'ship-1', import_order_id: 'ord-a', container_id: 'cont-OTHER' }, { client: w });
  assert.ok(!told.some((r) => r.orderId === 'ord-a'), 'an inconsistent association was announced as a movement');
});

test('CAP-08: a co-loader with their OWN shipment on the same container is not told that someone else\'s moved — and the reverse', async () => {
  const w = world({ shipments: [{ id: 'ship-1', import_order_id: 'ord-a' }, { id: 'ship-b', import_order_id: 'ord-b' }] });
  const forA = await resolveAlertRecipients({ id: 'ship-1', import_order_id: 'ord-a', container_id: 'cont-1' }, { client: w });
  assert.deepEqual(forA.map((r) => r.userId).sort(), ['u-buyer', 'u-creator-a']);
  const forB = await resolveAlertRecipients({ id: 'ship-b', import_order_id: 'ord-b', container_id: 'cont-1' }, { client: w });
  assert.deepEqual(forB.map((r) => r.userId), ['u-coloader']);
  const j = await getJourney('import_order', 'ord-b', { id: 'u-coloader', platformRole: 'member' }, { supabaseClient: w });
  assert.equal(j.shipping.reference, shipmentReference('ship-b'), 'the Journey and the alert disagree about which shipment is theirs');
});

test('CAP-08: PARITY — the people told are exactly the people whose Journey shows that very shipment', async () => {
  const w = world();
  const told = new Set((await resolveAlertRecipients(SHIPMENT(), { client: w })).map((r) => `${r.userId}@${r.orderId}`));
  const candidates = [['u-buyer', 'ord-a'], ['u-creator-a', 'ord-a'], ['u-coloader', 'ord-b'], ['u-left', 'ord-c'], ['u-notloaded', 'ord-d']];
  for (const [userId, orderId] of candidates) {
    const j = await getJourney('import_order', orderId, { id: userId, platformRole: 'member' }, { supabaseClient: w });
    const shows = ['order', 'container'].includes(j.shipping?.association) && j.shipping?.reference === shipmentReference('ship-1');
    assert.equal(told.has(`${userId}@${orderId}`), shows, `${userId}: alert recipient and Journey disagree (journey shows it: ${shows})`);
  }
});

test('CAP-08: the alert prints the SAME shipment reference the Journey does', async () => {
  const b = bus();
  await run(world(), b, 'IN_TRANSIT');
  const j = await getJourney('import_order', 'ord-a', { id: 'u-buyer', platformRole: 'member' }, { supabaseClient: world() });
  for (const e of b.events) assert.equal(e.payload.reference, j.shipping.reference);
});

// ── Delivering alerts ──────────────────────────────────────────────────────────────────────────────

test('CAP-08: the four recorded stages that matter each produce their own alert, and nothing else does', async () => {
  const cases = [
    ['IN_TRANSIT', JOURNEY_ALERT_EVENTS.ALERT, 'DEPARTED'], ['ARRIVED', JOURNEY_ALERT_EVENTS.ALERT, 'ARRIVED'],
    ['EXCEPTION', JOURNEY_ALERT_EVENTS.EXCEPTION, 'EXCEPTION'], ['CUSTOMS_HOLD', JOURNEY_ALERT_EVENTS.EXCEPTION, 'EXCEPTION'],
  ];
  for (const [stage, type, kind] of cases) {
    const b = bus();
    await run(world(), b, stage);
    assert.equal(b.events.length, 3, `${stage}: wrong number of alerts`);
    for (const e of b.events) { assert.equal(e.event_type, type); assert.equal(e.payload.kind, kind); }
  }
  for (const quiet of ['PLANNED', 'BOOKED', 'LOADING', 'RELEASED', 'COMPLETED', 'NOT_A_STAGE']) {
    const b = bus();
    const out = await run(world(), b, quiet);
    assert.equal(b.events.length, 0, `${quiet} produced an alert`);
    assert.equal(out.skipped, 'not_an_alert_stage');
  }
  assert.deepEqual(Object.keys(STAGE_ALERTS).sort(), ['ARRIVED', 'CUSTOMS_HOLD', 'EXCEPTION', 'IN_TRANSIT']);
});

test('CAP-08: a hold and an exception are worded as what they are', async () => {
  const a = bus(); await run(world(), a, 'EXCEPTION');
  const h = bus(); await run(world(), h, 'CUSTOMS_HOLD');
  assert.equal(a.events[0].payload.status, journeyAlertText('EXCEPTION'));
  assert.equal(h.events[0].payload.status, journeyAlertText('EXCEPTION', { stage: 'CUSTOMS_HOLD' }));
});

test('CAP-08: each alert is addressed to its recipient\'s OWN order, with a path to that journey', async () => {
  const b = bus();
  await run(world(), b, 'IN_TRANSIT');
  for (const e of b.events) {
    const orderId = e.payload.subjectId;
    assert.equal(e.payload.subjectType, 'import_order');
    assert.equal(e.payload.journeyPath, `/diaspora/journey/import_order/${orderId}`);
  }
  const byUser = Object.fromEntries(b.events.map((e) => [e.payload.recipientUserId, e.payload.subjectId]));
  assert.equal(byUser['u-buyer'], 'ord-a');
  assert.equal(byUser['u-coloader'], 'ord-b');
});

test('CAP-08: an alert carries nothing about anyone else, the operator, the container or the tenant', async () => {
  const b = bus();
  await run(world(), b, 'IN_TRANSIT');
  for (const e of b.events) {
    const text = JSON.stringify(e.payload);
    const mine = e.payload.recipientUserId;
    for (const leak of ['u-operator', 'ship-1', 'cont-1', 'tenant-1', 'u-left', 'u-notloaded', 'u-stranger', 'ord-c', 'ord-d', 'ord-other', 'email', 'phone']) {
      assert.ok(!text.includes(leak), `${leak} leaked into an alert for ${mine}`);
    }
    for (const other of ['u-buyer', 'u-creator-a', 'u-coloader'].filter((u) => u !== mine)) {
      assert.ok(!text.includes(other), `another recipient (${other}) leaked into the alert for ${mine}`);
    }
    for (const otherOrder of ['ord-a', 'ord-b'].filter((o) => o !== e.payload.subjectId)) {
      assert.ok(!text.includes(otherOrder), `another order (${otherOrder}) leaked into the alert for ${mine}`);
    }
  }
});

test('CAP-08: an alert is advisory — it says so, and creates no state', async () => {
  const b = bus();
  await run(world(), b, 'IN_TRANSIT');
  for (const e of b.events) assert.equal(e.payload.advisory_only, true);
});

test('CAP-08: the tenant on the event is the shipment\'s, so the outbox is scoped like every other T7 event', async () => {
  const b = bus();
  await run(world(), b, 'IN_TRANSIT');
  for (const e of b.events) assert.equal(e.tenant_id, 'tenant-1');
});

// ── One observation, one alert ─────────────────────────────────────────────────────────────────────

test('CAP-08: the same outbox event handled twice alerts each person once', async () => {
  const w = world(); const b = bus();
  await run(w, b, 'IN_TRANSIT', 'outbox-7');
  await run(w, b, 'IN_TRANSIT', 'outbox-7');
  assert.equal(b.events.length, 3);
  assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-coloader', 'u-creator-a']);
});

test('CAP-08: a different observation of the same stage is a different alert', async () => {
  const w = world(); const b = bus();
  await run(w, b, 'EXCEPTION', 'outbox-1');
  await run(w, b, 'EXCEPTION', 'outbox-2');
  assert.equal(b.events.length, 6);
});

test('CAP-08: the alert key names the kind, the order, the person and the observation', () => {
  const key = alertKeyFor({ kind: 'DEPARTED', orderId: 'ord-a', recipientUserId: 'u-buyer', observationKey: 'evt-1' });
  assert.equal(key, 'DEPARTED:ord-a:u-buyer:evt-1');
  const others = [
    alertKeyFor({ kind: 'ARRIVED', orderId: 'ord-a', recipientUserId: 'u-buyer', observationKey: 'evt-1' }),
    alertKeyFor({ kind: 'DEPARTED', orderId: 'ord-b', recipientUserId: 'u-buyer', observationKey: 'evt-1' }),
    alertKeyFor({ kind: 'DEPARTED', orderId: 'ord-a', recipientUserId: 'u-other', observationKey: 'evt-1' }),
    alertKeyFor({ kind: 'DEPARTED', orderId: 'ord-a', recipientUserId: 'u-buyer', observationKey: 'evt-2' }),
  ];
  for (const k of others) assert.notEqual(k, key);
});

test('CAP-08: a handler that fails for one person still tells the others, then fails so the worker retries', async () => {
  const w = world(); const b = bus({ failFor: 'u-coloader' });
  await assert.rejects(() => run(w, b, 'IN_TRANSIT', 'outbox-9'), (err) => {
    assert.ok(err instanceof JourneyAlertDeliveryError);
    assert.match(err.message, /1 of 3/);
    assert.ok(!err.message.includes('u-coloader'), 'the failure message named a recipient');
    return true;
  });
  assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-creator-a'], 'one failure stopped the others');
});

test('CAP-08: a failure for the FIRST person does not stop the rest — whoever fails, the others are told', async () => {
  for (const failing of ['u-buyer', 'u-creator-a', 'u-coloader']) {
    const w = world(); const b = bus({ failFor: failing });
    await assert.rejects(() => run(w, b, 'IN_TRANSIT', 'outbox-f'), JourneyAlertDeliveryError);
    assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-coloader', 'u-creator-a'].filter((u) => u !== failing), `${failing} failing stopped someone else being told`);
  }
});

test('CAP-08: the retry delivers the missing alert and never repeats the delivered ones', async () => {
  const w = world(); const b = bus({ failFor: 'u-coloader' });
  await assert.rejects(() => run(w, b, 'IN_TRANSIT', 'outbox-9'));
  b.ctl.failFor = null;
  await run(w, b, 'IN_TRANSIT', 'outbox-9');
  assert.equal(b.events.length, 3, 'a retry duplicated an alert, or lost one');
  assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-coloader', 'u-creator-a']);
});

test('CAP-08: an unknown, deleted or unaddressed shipment is skipped quietly — nothing to retry', async () => {
  const b = bus();
  const missing = await handleShipmentStageEvent({ shipmentId: 'nope', stage: 'IN_TRANSIT' }, { id: 'o1' }, { client: world(), emitEvent: b.emit });
  assert.equal(missing.skipped, 'shipment_not_found');
  const none = await handleShipmentStageEvent({ stage: 'IN_TRANSIT' }, { id: 'o2' }, { client: world(), emitEvent: b.emit });
  assert.equal(none.skipped, 'shipment_not_found');
  const w = world({ shipments: [{ id: 'ship-1', import_order_id: 'ord-a', deleted_at: '2026-09-30T00:00:00Z' }] });
  const gone = await handleShipmentStageEvent({ shipmentId: 'ship-1', stage: 'IN_TRANSIT' }, { id: 'o3' }, { client: w, emitEvent: b.emit });
  assert.equal(gone.skipped, 'shipment_not_found');
  assert.equal(b.events.length, 0);
});

test('CAP-08: with no event identity at all, the key still comes from the shipment\'s own record — never a random one', async () => {
  const w = world(); const b = bus();
  const payload = { shipmentId: 'ship-1', stage: 'IN_TRANSIT' };
  await handleShipmentStageEvent(payload, {}, { client: w, emitEvent: b.emit });
  await handleShipmentStageEvent(payload, {}, { client: w, emitEvent: b.emit });
  assert.equal(b.events.length, 3, 'two deliveries of an unidentified event doubled the alerts');
});

test('CAP-08: the notifier writes nothing to any table', async () => {
  const client = world();
  const writes = [];
  const trapped = { ...client, from(table) {
    const chain = client.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  const b = bus();
  await run(trapped, b, 'IN_TRANSIT');
  await notifyJourneyAlert({ kind: 'ETA_CHANGED', shipment: SHIPMENT(), observationId: 'obs-1', recordedAt: '2026-10-01T10:00:00Z' }, { client: trapped, emitEvent: b.emit });
  assert.deepEqual(writes, []);
});

test('CAP-08: reads stay bounded however many people share the container', async () => {
  const count = async (extra) => {
    const orders = [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', status: 'SHIPPED', deleted_at: null }];
    const reservations = [{ id: 'res-a', tenant_id: 'tenant-1', container_id: 'cont-1', import_order_id: 'ord-a', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }];
    const items = [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LOADED', deleted_at: null }];
    for (let i = 0; i < extra; i += 1) {
      orders.push({ id: `ord-x${i}`, tenant_id: 'tenant-1', buyer_id: `u-x${i}`, created_by: `u-x${i}`, status: 'SHIPPED', deleted_at: null });
      reservations.push({ id: `res-x${i}`, tenant_id: 'tenant-1', container_id: 'cont-1', import_order_id: `ord-x${i}`, buyer_id: `u-x${i}`, created_by: `u-x${i}`, deleted_at: null });
      items.push({ id: `li-x${i}`, load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: `res-x${i}`, outcome: 'LOADED', deleted_at: null });
    }
    const client = world({ orders, reservations, items });
    let n = 0;
    const counting = { ...client, from(t) { n += 1; return client.from(t); } };
    const got = await resolveAlertRecipients(SHIPMENT(), { client: counting });
    return { n, people: got.length };
  };
  const one = await count(0); const many = await count(5);
  assert.equal(one.people, 1); assert.equal(many.people, 6);
  // Each extra order costs a fixed handful of reads (its own selection) — never a read per person or per event.
  assert.ok(many.n - one.n <= 5 * 6, `reads grew faster than a fixed cost per order: ${one.n} -> ${many.n}`);
});

// ── Estimate changes: one alert per window, not a storm ────────────────────────────────────────────

const eta = (b, w, observationId, recordedAt) => notifyJourneyAlert({ kind: 'ETA_CHANGED', shipment: SHIPMENT(), observationId, recordedAt }, { client: w, emitEvent: b.emit });

test('CAP-08: an estimate change alerts each person once, with the estimate wording', async () => {
  const w = world(); const b = bus();
  await eta(b, w, 'obs-1', '2026-10-01T10:00:00Z');
  assert.equal(b.events.length, 3);
  for (const e of b.events) { assert.equal(e.payload.kind, 'ETA_CHANGED'); assert.equal(e.payload.status, journeyAlertText('ETA_CHANGED')); assert.equal(e.event_type, JOURNEY_ALERT_EVENTS.ALERT); }
});

test('CAP-08: a burst of estimate edits inside one window is one alert per person, not a storm', async () => {
  const w = world(); const b = bus();
  for (let i = 0; i < 12; i += 1) await eta(b, w, `obs-${i}`, `2026-10-01T10:${String(i).padStart(2, '0')}:00Z`);
  assert.equal(b.events.length, 3, `${b.events.length} alerts for one burst`);
});

test('CAP-08: an estimate change in a later window is a new alert', async () => {
  const w = world(); const b = bus();
  await eta(b, w, 'obs-1', '2026-10-01T10:05:00Z');
  await eta(b, w, 'obs-2', '2026-10-01T10:40:00Z');
  assert.equal(b.events.length, 6);
  assert.equal(ETA_ALERT_WINDOW_MINUTES, 30);
});

test('CAP-08: the same revision replayed is the same alert, even long after the window it was made in', async () => {
  const w = world(); const b = bus();
  await eta(b, w, 'obs-1', '2026-10-01T10:05:00Z');
  await eta(b, w, 'obs-1', '2026-10-01T10:05:00Z');
  assert.equal(b.events.length, 3);
});

test('CAP-08: an estimate change with no recorded time cannot be windowed — it is refused, not given a random key', async () => {
  const w = world(); const b = bus();
  await assert.rejects(() => notifyJourneyAlert({ kind: 'ETA_CHANGED', shipment: SHIPMENT(), observationId: 'obs-1' }, { client: w, emitEvent: b.emit }), /recorded time/i);
  assert.equal(b.events.length, 0);
});

test('CAP-08: an unknown kind is refused before anything is read or sent', async () => {
  const b = bus();
  await assert.rejects(() => notifyJourneyAlert({ kind: 'SOMETHING_ELSE', shipment: SHIPMENT(), observationId: 'x' }, { client: world(), emitEvent: b.emit }), /unknown/i);
  assert.equal(b.events.length, 0);
});

// ── Wiring: through the real event worker, the real service, and the real files ───────────────────

function fakePg() {
  const log = [];
  return {
    log,
    query: async (sql, params = []) => { log.push({ sql: String(sql).trim(), params }); return { rows: [], rowCount: 1 }; },
  };
}
const outboxRow = (stage, over = {}) => ({
  id: 'outbox-w1', event_type: `DIASPORA_SHIPMENT_${stage}`, attempts: 0, status: 'pending', tenant_id: 'tenant-1',
  payload: { shipmentId: 'ship-1', importOrderId: 'ord-a', stage }, ...over,
});

test('CAP-08: registration subscribes exactly the four alert stages on the real worker, once', () => {
  eventWorker.handlers = new Map();
  const deps = { client: world(), emitEvent: bus().emit };
  registerJourneyAlertListeners(eventWorker, deps);
  registerJourneyAlertListeners(eventWorker, deps);
  const subscribed = [...eventWorker.handlers.keys()].filter((k) => k.startsWith('DIASPORA_SHIPMENT_')).sort();
  assert.deepEqual(subscribed, ['DIASPORA_SHIPMENT_ARRIVED', 'DIASPORA_SHIPMENT_CUSTOMS_HOLD', 'DIASPORA_SHIPMENT_EXCEPTION', 'DIASPORA_SHIPMENT_IN_TRANSIT']);
  for (const key of subscribed) assert.equal(eventWorker.handlers.get(key).length, 1, `${key} was subscribed twice`);
});

test('CAP-08: a stage event processed by the REAL worker alerts the right people and settles as processed', async () => {
  eventWorker.handlers = new Map();
  const b = bus(); const pg = fakePg();
  registerJourneyAlertListeners(eventWorker, { client: world(), emitEvent: b.emit });
  await eventWorker.processEvent(pg, outboxRow('IN_TRANSIT'));
  assert.equal(b.events.length, 3);
  assert.ok(pg.log.some((q) => /SET status = 'processed'/.test(q.sql)), 'the event was not settled as processed');
  assert.deepEqual(new Set(b.events.map((e) => e.payload.alertKey.split(':')[3])), new Set(['evt-outbox-w1']), 'the key did not come from the outbox event id');
});

test('CAP-08: a stage event the worker redelivers never tells anyone twice', async () => {
  eventWorker.handlers = new Map();
  const b = bus(); const pg = fakePg();
  registerJourneyAlertListeners(eventWorker, { client: world(), emitEvent: b.emit });
  await eventWorker.processEvent(pg, outboxRow('ARRIVED'));
  await eventWorker.processEvent(pg, outboxRow('ARRIVED', { attempts: 1 }));
  assert.equal(b.events.length, 3);
});

test('CAP-08: a delivery failure leaves the event pending for the worker to retry — and the retry completes it', async () => {
  eventWorker.handlers = new Map();
  const b = bus({ failFor: 'u-coloader' }); const pg = fakePg();
  registerJourneyAlertListeners(eventWorker, { client: world(), emitEvent: b.emit });
  await eventWorker.processEvent(pg, outboxRow('IN_TRANSIT'));
  const failed = pg.log.find((q) => /SET status = \$1/.test(q.sql));
  assert.ok(failed, 'a failed delivery was not recorded as a failure');
  assert.equal(failed.params[0], 'pending');
  assert.equal(failed.params[1], 1);
  b.ctl.failFor = null;
  await eventWorker.processEvent(pg, outboxRow('IN_TRANSIT', { attempts: 1 }));
  assert.equal(b.events.length, 3);
  assert.ok(pg.log.some((q) => /SET status = 'processed'/.test(q.sql)));
});

test('CAP-08: a stage that is not an alert is processed and tells nobody — RELEASED is not subscribed at all', async () => {
  eventWorker.handlers = new Map();
  const b = bus(); const pg = fakePg();
  registerJourneyAlertListeners(eventWorker, { client: world(), emitEvent: b.emit });
  assert.ok(!eventWorker.handlers.has('DIASPORA_SHIPMENT_RELEASED'));
  assert.ok(!eventWorker.handlers.has('DIASPORA_SHIPMENT_COMPLETED'));
  await eventWorker.processEvent(pg, outboxRow('RELEASED'));
  assert.equal(b.events.length, 0);
});

test('CAP-08: the server registers the alert listeners beside the communication listeners', () => {
  const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  assert.match(server, /import\s*\{[^}]*registerJourneyAlertListeners[^}]*\}\s*from\s*'\.\/services\/diaspora\/journeyAlertNotifier\.js'/);
  assert.match(server, /registerCommunicationListeners\(eventWorker\);\s*\n\s*registerJourneyAlertListeners\(eventWorker\);/);
});

test('CAP-08: the alert events have a real emitter literal at a call site the coverage scan can see', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend', 'services', 'diaspora', 'journeyAlertNotifier.js'), 'utf8');
  for (const type of Object.values(JOURNEY_ALERT_EVENTS)) {
    assert.match(source, new RegExp(String.raw`emitEvent\(\s*null,\s*'${type.replace(/\./g, '\\.')}'`), `${type} has no literal emitter`);
  }
});

// ── The estimate path, through the real revision service ───────────────────────────────────────────

const REVISION = (over = {}) => ({ estimated_arrival: '2026-10-08T00:00:00Z', reason: 'Port congestion', provider_event_id: 'rev-1', ...over });
const record = (w, b, payload = REVISION()) => recordEtaRevision('ship-1', payload, OPERATOR, { supabaseClient: w, emitEvent: b.emit });

test('CAP-08: a recorded estimate revision, through the real service, alerts the people on that shipment', async () => {
  const w = world(); const b = bus();
  await record(w, b);
  assert.equal(b.events.length, 3);
  assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-coloader', 'u-creator-a']);
  for (const e of b.events) assert.equal(e.payload.kind, 'ETA_CHANGED');
});

test('CAP-08: replaying the same revision request re-attempts the alert and never repeats it', async () => {
  const w = world(); const b = bus();
  await record(w, b);
  await record(w, b);
  assert.equal(b.events.length, 3);
});

test('CAP-08: a replay delivers an alert the first attempt could not queue', async () => {
  const w = world(); const b = bus({ failFor: 'u-coloader' });
  await record(w, b);
  assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-creator-a']);
  b.ctl.failFor = null;
  await record(w, b);
  assert.deepEqual(recipientsOf(b), ['u-buyer', 'u-coloader', 'u-creator-a']);
});

test('CAP-08: a notification failure never fails the revision that was already recorded', async () => {
  const w = world(); const b = bus({ failFor: 'u-buyer' });
  const out = await record(w, b);
  assert.equal(out.status, 'ACCEPTED');
  assert.equal(out.estimated_arrival, '2026-10-08T00:00:00.000Z');
});

test('CAP-08: a late-entered, older revision is superseded on arrival and announces nothing', async () => {
  const w = world(); const b = bus();
  await record(w, b, REVISION({ provider_event_id: 'rev-new', observed_at: '2026-10-01T10:00:00Z' }));
  const before = b.events.length;
  await record(w, b, REVISION({ provider_event_id: 'rev-old', estimated_arrival: '2026-10-05T00:00:00Z', observed_at: '2026-09-25T10:00:00Z' }));
  assert.equal(b.events.length, before, 'a revision that can never be current was announced');
});

test('CAP-08: a superseded revision announces nothing even when it lands in a LATER window — the window key must not be what hides it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T10:00:00Z') });
  const w = world(); const b = bus();
  await record(w, b, REVISION({ provider_event_id: 'rev-new', observed_at: '2026-10-01T10:00:00Z' }));
  assert.equal(b.events.length, 3);
  t.mock.timers.setTime(Date.parse('2026-10-01T13:00:00Z'));
  await record(w, b, REVISION({ provider_event_id: 'rev-old', estimated_arrival: '2026-10-05T00:00:00Z', observed_at: '2026-09-25T10:00:00Z' }));
  assert.equal(b.events.length, 3, 'a revision that can never be current was announced in a later window');
});

test('CAP-08: the alert window comes from when the revision was RECORDED, not from the time it says it was observed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T10:05:00Z') });
  const w = world(); const b = bus();
  await record(w, b, REVISION({ provider_event_id: 'rev-late', observed_at: '2026-09-28T00:00:00Z' }));
  const recorded = Math.floor(Date.parse('2026-10-01T10:05:00Z') / (30 * 60 * 1000));
  for (const e of b.events) assert.equal(e.payload.alertKey.split(':')[3], `win-${recorded}`, 'the window was taken from the observed time');
});

test('CAP-08: losing the insert race to an identical request still re-attempts the alert', async () => {
  const winner = { id: 'obs-winner', shipment_id: 'ship-1', provider_id: 'OPERATOR_DECLARED', provider_event_id: 'rev-race', kind: 'ETA_REVISION',
    observed_at: '2026-10-01T10:00:00Z', created_at: '2026-10-01T10:00:00Z', status: 'ACCEPTED',
    payload: { estimated_arrival: '2026-10-08T00:00:00.000Z', reason: 'Port congestion' }, created_by: 'u-operator', deleted_at: null };
  const base = world({ observations: [winner] });
  // The first lookup by event id misses (the other request had not committed), so the insert collides.
  let missed = false;
  // The mock's chain methods return the raw chain, so the wrapper must re-wrap what they return.
  const wrap = (chain) => new Proxy(chain, { get(target, prop) {
    if (prop === 'maybeSingle' && !missed) { missed = true; return () => Promise.resolve({ data: null, error: null }); }
    const v = target[prop];
    if (typeof v !== 'function') return v;
    return (...args) => { const r = v.apply(target, args); return r === target ? wrap(target) : r; };
  } });
  const racing = { ...base, from(table) {
    const chain = base.from(table);
    return table === 'diaspora_shipment_observations' ? wrap(chain) : chain;
  } };
  const b = bus();
  const out = await recordEtaRevision('ship-1', REVISION({ provider_event_id: 'rev-race', observed_at: '2026-10-01T10:00:00Z' }), OPERATOR, { supabaseClient: racing, emitEvent: b.emit });
  assert.ok(missed, 'the race was not actually exercised');
  assert.equal(out.id, 'obs-winner');
  assert.equal(b.events.length, 3, 'the request that lost the race did not re-attempt the alert');
});

test('CAP-08: a refused revision announces nothing', async () => {
  const w = world(); const b = bus();
  await assert.rejects(() => recordEtaRevision('ship-1', REVISION(), { id: 'u-buyer', platformRole: 'member' }, { supabaseClient: w, emitEvent: b.emit }));
  assert.equal(b.events.length, 0);
});

test('CAP-08: the revision service really calls the notifier — it is not only reachable through an injected seam', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend', 'services', 'diaspora', 'diasporaShipmentObservationService.js'), 'utf8');
  assert.match(source, /from\s*'\.\/journeyAlertNotifier\.js'/);
  assert.match(source, /notifyJourneyAlert\(/);
});

// ── Through the REAL communications pipeline, from the notifier's own payloads ─────────────────────
//
// The payloads below are not written by hand: they are what the notifier actually emits. The governed
// registry is not written by hand either: it is parsed out of the migration, so the fixture cannot drift from
// what the migration really registers (an invented fixture is how a notification path ends up proven against
// a shape that never occurs in production).

function registryFromMigration() {
  const file = fs.readdirSync(path.join(ROOT, 'database', 'migrations')).find((f) => /trade_os_cap08_journey_alerts\.sql$/.test(f));
  const up = fs.readFileSync(path.join(ROOT, 'database', 'migrations', file), 'utf8').split(/^-- \+migrate Down/m)[0];
  const tpl = up.match(/\(\s*'journey_update_v1',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/);
  const ver = up.match(/SELECT id, 1, 'in_app', 'en', '([^']*)',\s*'([^']*)',\s*'(\[[^\]]*\])'::jsonb, '(\[[^\]]*\])'::jsonb, '([^']*)'/);
  assert.ok(tpl && ver, 'could not read the governed template out of the migration');
  return {
    communication_templates: [{ id: 'tpl-j', template_key: 'journey_update_v1', business_workflow: tpl[1], stakeholder_audience: tpl[2], classification: tpl[3], owner_team: tpl[4], status: tpl[5] }],
    communication_template_versions: [{ id: 'tpl-j-v1', template_id: 'tpl-j', version: 1, channel: 'in_app', language: 'en', subject_template: ver[1], body_template: ver[2], required_variables: JSON.parse(ver[3]), optional_variables: JSON.parse(ver[4]), approval_status: ver[5], provider_template_reference: null }],
  };
}
const pipeline = (registry = registryFromMigration()) => {
  const repository = new MemoryCommunicationRepository(registry);
  return { repository, services: createCommunicationServices({ repository }) };
};
const deliver = (services, event, id) => services.orchestrator.handleDomainEvent({ id, event_type: event.event_type, payload: event.payload, tenant_id: event.tenant_id }, null, event.tenant_id);

test('CAP-08: the notifier\'s real alerts become exactly one in-app notice each, in the governed words', async () => {
  const b = bus(); await run(world(), b, 'IN_TRANSIT', 'outbox-p1');
  const { repository, services } = pipeline();
  for (const [i, e] of b.events.entries()) await deliver(services, e, `evt-${i}`);
  const queue = repository.rows('notification_queue');
  assert.equal(queue.length, 3);
  assert.deepEqual(queue.map((q) => q.recipient_user_id).sort(), ['u-buyer', 'u-coloader', 'u-creator-a']);
  for (const q of queue) {
    assert.equal(q.channel, 'in_app', 'an alert routed outside the app');
    assert.equal(q.template_key, 'journey_update_v1');
    assert.equal(q.title, `Your shipment ${shipmentReference('ship-1')}`);
    assert.equal(q.message, journeyAlertText('DEPARTED'));
  }
});

test('CAP-08: no other channel is ever queued — by policy, whatever the person\'s preferences', async () => {
  const b = bus(); await run(world(), b, 'ARRIVED', 'outbox-p2');
  const { repository, services } = pipeline();
  for (const [i, e] of b.events.entries()) await deliver(services, e, `evt-${i}`);
  assert.deepEqual([...new Set(repository.rows('notification_queue').map((q) => q.channel))], ['in_app']);
});

test('CAP-08: an exception is a high-priority notice; a departure is not', async () => {
  const ex = bus(); await run(world(), ex, 'EXCEPTION', 'outbox-p3');
  const dep = bus(); await run(world(), dep, 'IN_TRANSIT', 'outbox-p4');
  const a = pipeline(); await deliver(a.services, ex.events[0], 'evt-ex');
  const d = pipeline(); await deliver(d.services, dep.events[0], 'evt-dep');
  assert.equal(a.repository.rows('message_threads')[0].priority, 'high');
  assert.equal(d.repository.rows('message_threads')[0].priority, 'normal');
  assert.equal(a.repository.rows('notification_queue')[0].message, journeyAlertText('EXCEPTION'));
});

test('CAP-08: each person\'s notice names nothing about anyone else', async () => {
  const b = bus(); await run(world(), b, 'IN_TRANSIT', 'outbox-p5');
  const { repository, services } = pipeline();
  for (const [i, e] of b.events.entries()) await deliver(services, e, `evt-${i}`);
  for (const q of repository.rows('notification_queue')) {
    const text = JSON.stringify(q);
    for (const other of ['u-buyer', 'u-creator-a', 'u-coloader'].filter((u) => u !== q.recipient_user_id)) assert.ok(!text.includes(other), `${other} appears in the notice for ${q.recipient_user_id}`);
    for (const leak of ['u-operator', 'ship-1', 'cont-1', 'u-left', 'u-notloaded']) assert.ok(!text.includes(leak), `${leak} appears in a notice`);
  }
});

test('CAP-08: the pipeline\'s own redelivery of one event does not queue a second notice', async () => {
  const b = bus(); await run(world(), b, 'IN_TRANSIT', 'outbox-p6');
  const { repository, services } = pipeline();
  await deliver(services, b.events[0], 'evt-same');
  await deliver(services, b.events[0], 'evt-same');
  assert.equal(repository.rows('notification_queue').length, 1);
});

test('CAP-08: WITHOUT the migration the governed registry fails closed — the migration is what makes alerts deliverable', async () => {
  const registry = registryFromMigration();
  // The registry exists and knows other templates, but not this one: exactly an environment where the
  // migration has not been applied.
  registry.communication_templates = [{ id: 'tpl-x', template_key: 'logistics_update_v1', business_workflow: 'container_logistics', stakeholder_audience: 'customer', classification: 'transactional', status: 'active' }];
  registry.communication_template_versions = [];
  const b = bus(); await run(world(), b, 'IN_TRANSIT', 'outbox-p7');
  const { services } = pipeline(registry);
  await assert.rejects(() => deliver(services, b.events[0], 'evt-x'), (err) => err?.code === 'template_not_registered');
});

test('CAP-08: the registered template requires exactly the variables the alert supplies', async () => {
  const reg = registryFromMigration();
  assert.deepEqual(reg.communication_template_versions[0].required_variables, ['reference', 'status']);
  assert.equal(reg.communication_template_versions[0].approval_status, 'approved');
  assert.equal(reg.communication_templates[0].classification, 'transactional');
  const b = bus(); await run(world(), b, 'IN_TRANSIT', 'outbox-p8');
  assert.ok(b.events[0].payload.reference && b.events[0].payload.status, 'the alert does not supply what the template requires');
});

// ── T11 itself is untouched ────────────────────────────────────────────────────────────────────────

test('CAP-08: the frozen shipment service is not edited — alerts consume its events, they do not hook into it', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend', 'services', 'diaspora', 'diasporaShipmentService.js'), 'utf8');
  assert.ok(!/journeyAlertNotifier|notifyJourneyAlert/.test(source), 'T11 was edited to call the Journey notifier');
});
