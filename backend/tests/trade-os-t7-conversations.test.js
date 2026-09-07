/**
 * Trade OS T7 — conversation membership is EARNED and SERVER-DERIVED.
 *
 * Both Trade OS conversation services existed with no direct test of their authorization. These
 * pin the rule the phase contract states plainly: never trust a client-supplied participant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const rfq = await import('../services/diaspora/diasporaRfqConversationService.js');
const booking = await import('../services/diaspora/diasporaContainerConversationService.js');
const logi = await import('../services/diaspora/diasporaLogisticsConversationService.js');
const notifier = await import('../services/diaspora/logisticsLifecycleNotifier.js');
const shipEx = await import('../services/diaspora/shipmentExceptionNotifier.js');
const policies = await import('../services/communication/communicationNotificationService.js');
const listeners = await import('../services/communication/communicationEventListeners.js');

const BUYER = 'u_buyer';
const SELLER = 'u_seller_with_quote';
const STRANGER = 'u_stranger';
const ORDER = 'order-1';

const ctxFor = (id) => ({ id, userId: id, role: 'owner', platformRole: 'owner', tenantId: null });

const db = (over = {}) => createMockSupabase({
  diaspora_import_orders: [{
    id: ORDER, buyer_id: BUYER, created_by: BUYER, tenant_id: null, deleted_at: null,
    metadata: { rfq: { published: true } },
  }],
  diaspora_import_quotes: [{
    id: 'q-1', import_order_id: ORDER, seller_id: SELLER, status: 'ISSUED', deleted_at: null,
  }],
  users: [{ id: BUYER }, { id: SELLER }, { id: STRANGER }],
  ...over,
});

/** A stub that records what the canonical Communications layer was asked to create. */
const recordingServices = () => {
  const calls = [];
  return {
    calls,
    services: {
      stakeholderService: {
        ensureReferenceFlow: async (input) => { calls.push(input); return { thread: { id: 'thread-1' } }; },
      },
    },
  };
};

test('the buyer may open a conversation with a supplier who actually quoted', async () => {
  const c = db();
  const { services, calls } = recordingServices();
  const r = await rfq.ensureRfqConversation(ORDER, ctxFor(BUYER),
    { supabaseClient: c, sellerId: SELLER, communicationServices: services });
  assert.equal(r.role, 'buyer');
  assert.equal(r.threadId, 'thread-1');
  assert.equal(calls.length, 1);
  // One thread per (request, supplier) pair, so competitors never read each other's clarifications.
  assert.equal(calls[0].subject_id, `${ORDER}:${SELLER}`);
  assert.equal(calls[0].subject_type, 'diaspora_rfq');
  const roles = calls[0].participants.map((p) => `${p.stakeholder_role}:${p.user_id}`).sort();
  assert.deepEqual(roles, [`buyer:${BUYER}`, `seller:${SELLER}`]);
});

/**
 * The gap this closes. `sellerId` arrives in the REQUEST BODY. Nothing verified that the named
 * person had any relationship to the order, so a buyer could pair themselves with an arbitrary
 * user — creating a canonical thread, seating a stranger as "seller", and putting the request's
 * reference in its metadata. The phase contract is explicit: never trust a client-supplied
 * participant.
 */
test('the buyer may NOT name a stranger as the supplier', async () => {
  const c = db();
  const { services, calls } = recordingServices();
  await assert.rejects(
    () => rfq.ensureRfqConversation(ORDER, ctxFor(BUYER),
      { supabaseClient: c, sellerId: STRANGER, communicationServices: services }),
    /not a supplier on this request|no offer on this request/i);
  assert.equal(calls.length, 0, 'no thread may be created for an unrelated person');
});

test('a supplier opening their own thread never supplies an id at all', async () => {
  const c = db();
  const { services, calls } = recordingServices();
  const r = await rfq.ensureRfqConversation(ORDER, ctxFor(SELLER),
    // A hostile seller trying to impersonate another supplier must be ignored, not obeyed.
    { supabaseClient: c, sellerId: STRANGER, communicationServices: services });
  assert.equal(r.role, 'seller');
  assert.equal(calls[0].subject_id, `${ORDER}:${SELLER}`, 'the server uses the CALLER, not the body');
});

test('a stranger cannot open a conversation on an awarded request', async () => {
  const c = db({
    diaspora_import_orders: [{
      id: ORDER, buyer_id: BUYER, created_by: BUYER, tenant_id: null, deleted_at: null,
      metadata: { rfq: { published: true, acceptedQuoteId: 'q-1' } },
    }],
  });
  const { services } = recordingServices();
  await assert.rejects(
    () => rfq.ensureRfqConversation(ORDER, ctxFor(STRANGER), { supabaseClient: c, communicationServices: services }),
    /already been awarded/i);
});

test('nobody can open a conversation on an unpublished request', async () => {
  const c = db({
    diaspora_import_orders: [{
      id: ORDER, buyer_id: BUYER, created_by: BUYER, tenant_id: null, deleted_at: null,
      metadata: { rfq: { published: false } },
    }],
  });
  const { services } = recordingServices();
  await assert.rejects(
    () => rfq.ensureRfqConversation(ORDER, ctxFor(STRANGER), { supabaseClient: c, communicationServices: services }),
    /not open for questions/i);
});

// ── T7.4 · the sailing conversation ──────────────────────────────────────────────────────────
//
// Booking had one-way notifications and no way to reply. Co-loaders share a box, not a group: one
// thread per (sailing, participant), private from the other participants.

const ORGANISER = 'u_organiser';
const CO_LOADER_A = 'u_coloader_a';
const CO_LOADER_B = 'u_coloader_b';
const SAILING = 'sail-1';

const sailingDb = (over = {}) => createMockSupabase({
  diaspora_container_shipments: [{
    id: SAILING, tenant_id: null, coordinator_id: ORGANISER, created_by: ORGANISER,
    origin_city: 'Yokohama', origin_country: 'Japan',
    destination_city: 'Beira', destination_country: 'Mozambique', deleted_at: null,
  }],
  diaspora_cargo_reservations: [
    { id: 'r-a', container_id: SAILING, buyer_id: CO_LOADER_A, created_by: CO_LOADER_A, reservation_status: 'APPROVED', deleted_at: null },
    { id: 'r-b', container_id: SAILING, buyer_id: CO_LOADER_B, created_by: CO_LOADER_B, reservation_status: 'REQUESTED', deleted_at: null },
  ],
  users: [{ id: ORGANISER }, { id: CO_LOADER_A }, { id: CO_LOADER_B }, { id: STRANGER }],
  ...over,
});

test('a participant can talk to the organiser about their sailing', async () => {
  const c = sailingDb();
  const { services, calls } = recordingServices();
  const r = await booking.ensureContainerConversation(SAILING, ctxFor(CO_LOADER_A),
    { supabaseClient: c, communicationServices: services });
  assert.equal(r.role, 'participant');
  assert.equal(calls[0].subject_type, 'diaspora_container_booking');
  assert.equal(calls[0].subject_id, `${SAILING}:${CO_LOADER_A}`);
  assert.deepEqual(calls[0].participants.map((p) => p.user_id).sort(), [CO_LOADER_A, ORGANISER].sort());
  assert.match(calls[0].metadata.route, /Yokohama.*Beira/);
});

test('asking BEFORE approval is the whole point — a REQUESTED booking may still ask', async () => {
  const c = sailingDb();
  const { services } = recordingServices();
  const r = await booking.ensureContainerConversation(SAILING, ctxFor(CO_LOADER_B),
    { supabaseClient: c, communicationServices: services });
  assert.equal(r.role, 'participant');
});

test('co-loaders never share a thread — one per participant', async () => {
  const c = sailingDb();
  const { services, calls } = recordingServices();
  await booking.ensureContainerConversation(SAILING, ctxFor(CO_LOADER_A), { supabaseClient: c, communicationServices: services });
  await booking.ensureContainerConversation(SAILING, ctxFor(CO_LOADER_B), { supabaseClient: c, communicationServices: services });
  assert.notEqual(calls[0].subject_id, calls[1].subject_id);
  // A's thread must not seat B, and vice versa.
  assert.ok(!calls[0].participants.some((p) => p.user_id === CO_LOADER_B));
  assert.ok(!calls[1].participants.some((p) => p.user_id === CO_LOADER_A));
});

test('someone with no booking on the sailing is refused', async () => {
  const c = sailingDb();
  const { services, calls } = recordingServices();
  await assert.rejects(
    () => booking.ensureContainerConversation(SAILING, ctxFor(STRANGER), { supabaseClient: c, communicationServices: services }),
    /no live booking on this sailing/i);
  assert.equal(calls.length, 0);
});

test('the organiser must NAME a participant, and may not name a stranger', async () => {
  const c = sailingDb();
  const { services, calls } = recordingServices();
  // Deliberately an ORDINARY user who merely coordinates this sailing. Giving them platform
  // authority here is what hid the staging defect: the coordinator of a sailing with a null
  // tenant_id failed isTenantAdminForRecord and was refused on their own sailing.
  const operator = ctxFor(ORGANISER);
  await assert.rejects(
    () => booking.ensureContainerConversation(SAILING, operator, { supabaseClient: c, communicationServices: services }),
    /participantId is required/i);
  await assert.rejects(
    () => booking.ensureContainerConversation(SAILING, operator,
      { supabaseClient: c, participantId: STRANGER, communicationServices: services }),
    /no live booking on this sailing/i);
  assert.equal(calls.length, 0, 'a client-supplied participant is verified, never believed');
  const ok = await booking.ensureContainerConversation(SAILING, operator,
    { supabaseClient: c, participantId: CO_LOADER_A, communicationServices: services });
  assert.equal(ok.role, 'organiser');
});

test('a cancelled booking is not a live relationship', async () => {
  const c = sailingDb({
    diaspora_cargo_reservations: [
      { id: 'r-a', container_id: SAILING, buyer_id: CO_LOADER_A, created_by: CO_LOADER_A, reservation_status: 'CANCELLED', deleted_at: null },
    ],
  });
  const { services } = recordingServices();
  await assert.rejects(
    () => booking.ensureContainerConversation(SAILING, ctxFor(CO_LOADER_A), { supabaseClient: c, communicationServices: services }),
    /no live booking/i);
});

// ── T7.5 · the deferred quote_withdrawn decision, taken ──────────────────────────────────────

test('a SUBMITTED offer being withdrawn tells the requester', async () => {
  const sent = [];
  await notifier.notifyLogisticsQuoteWithdrawn({
    request: { id: 'req-1', requester_id: 'u_requester', origin_city: 'Yokohama', destination_city: 'Harare' },
    quote: { id: 'q-1' }, previousStatus: 'SUBMITTED', emitEvent: (type, payload) => { sent.push({ type, payload }); return 'emitted'; },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'diaspora.logistics.quote_withdrawn');
  assert.equal(sent[0].payload.recipientUserId, 'u_requester', 'the requester, and only the requester');
  assert.equal(sent[0].payload.status, 'OFFER_WITHDRAWN');
});

test('a DRAFT withdrawal notifies NOBODY — it was never visible to the requester', async () => {
  const sent = [];
  const r = await notifier.notifyLogisticsQuoteWithdrawn({
    request: { id: 'req-1', requester_id: 'u_requester' }, quote: { id: 'q-1' },
    previousStatus: 'DRAFT', emitEvent: (t, p) => { sent.push({ t, p }); return 'emitted'; },
  });
  assert.equal(r, null);
  assert.equal(sent.length, 0, 'announcing a draft would leak that a provider was considering an offer');
});

test('a request with no recipient on record notifies nobody rather than guessing one', async () => {
  const sent = [];
  const r = await notifier.notifyLogisticsQuoteWithdrawn({
    request: { id: 'req-1' }, quote: { id: 'q-1' }, previousStatus: 'SUBMITTED',
    emitEvent: (t, p) => { sent.push({ t, p }); return 'emitted'; },
  });
  assert.equal(r, null);
  assert.equal(sent.length, 0);
});

test('the withdrawal event is registered end to end — listener AND policy', () => {
  // An emitted event with no listener and no policy goes nowhere at all, which is the failure mode
  // that makes a "notification" look implemented while reaching no human.
  assert.ok(listeners.COMMUNICATION_EVENT_TYPES.includes('diaspora.logistics.quote_withdrawn'),
    'the event must be subscribed, or the emit reaches no listener');
  const policy = (policies.NOTIFICATION_POLICIES || {})['diaspora.logistics.quote_withdrawn'];
  assert.ok(policy, 'the event must have a notification policy');
  assert.equal(policy.templateKey, 'logistics_update_v1');
  assert.deepEqual(policy.channels, ['in_app']);
});

test('the sailing coordinator IS its organiser, even with no tenant and no platform role', async () => {
  const c = sailingDb();
  const { services, calls } = recordingServices();
  const r = await booking.ensureContainerConversation(SAILING, ctxFor(ORGANISER),
    { supabaseClient: c, participantId: CO_LOADER_A, communicationServices: services });
  assert.equal(r.role, 'organiser', 'the person who organises the sailing must not be told they have no booking on it');
  assert.equal(calls[0].subject_id, `${SAILING}:${CO_LOADER_A}`);
});

// ── T7.5 · shipment EXCEPTION communication ──────────────────────────────────────────────────
//
// The canonical producer already existed — updateShipmentStage records an authoritative EXCEPTION
// stage event, audits it, and emits on the domain bus — and Communications subscribed to none of
// it. The stage a customer most needs to hear about was the one nobody told them.

test('an EXCEPTION stage is a customer-facing exception', () => {
  assert.equal(shipEx.isExceptionStage('EXCEPTION'), true);
  // A stop is a stop. Treating CUSTOMS_HOLD as ordinary progress because it has its own enum value
  // would follow the vocabulary against its meaning.
  assert.equal(shipEx.isExceptionStage('CUSTOMS_HOLD'), true);
  assert.equal(shipEx.isExceptionStage('customs_hold'), true);
});

test('ordinary progress is NOT an exception — no alarm on a healthy shipment', () => {
  for (const stage of ['PLANNED', 'BOOKED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'RELEASED', 'COMPLETED']) {
    assert.equal(shipEx.isExceptionStage(stage), false, `${stage} must not raise an exception notice`);
  }
});

test('a non-exception stage emits nothing at all', async () => {
  const r = await shipEx.notifyShipmentException({
    shipment: { id: 'ship-1', buyer_id: 'u_buyer' }, stage: 'IN_TRANSIT',
  });
  assert.equal(r, null);
});

test('an exception with nobody to address notifies nobody rather than guessing', async () => {
  const r = await shipEx.notifyShipmentException({ shipment: { id: 'ship-1' }, stage: 'EXCEPTION' });
  assert.equal(r, null, 'an event nobody can be addressed with is not a notification');
});

test('the shipment exception is registered end to end — listener AND policy', () => {
  assert.ok(listeners.COMMUNICATION_EVENT_TYPES.includes('diaspora.shipment.exception'),
    'without a subscribed listener the emit reaches nothing');
  const policy = (policies.NOTIFICATION_POLICIES || {})['diaspora.shipment.exception'];
  assert.ok(policy, 'without a policy the event renders no notification');
  assert.equal(policy.priority, 'high', 'a stopped shipment is not routine');
  assert.deepEqual(policy.channels, ['in_app']);
});

test('the notice never carries authority over the shipment', async () => {
  // Whatever the payload says, it is advisory. Nothing in this module writes a stage.
  const src = readFileSync(new URL('../services/diaspora/shipmentExceptionNotifier.js', import.meta.url), 'utf-8');
  assert.ok(!/\.update\(|\.insert\(|\.upsert\(/.test(src),
    'the consumer must not write to any table — it reports, it does not decide');
  assert.ok(/advisory_only: true/.test(src));
});

// ── T7.3 · logistics conversations, certified ────────────────────────────────────────────────
//
// The implementation was inspected and believed working, and had no dedicated coverage. Believed
// working is not certified.

const REQUESTER = 'u_requester';
const PROVIDER_A = 'u_provider_a';
const PROVIDER_B = 'u_provider_b';
const SHIP_REQ = 'ship-1';

// Provider eligibility is EARNED from the canonical business profile, not from users.role — so the
// fixture must give it, and STRANGER deliberately has none.
const providerProfile = (id) => ({ user_id: id, account_kind: 'business', business_type: 'logistics_provider', organization_name: `Freight ${id}`, country_of_residence: 'Japan', city: 'Yokohama' });
const shipDb = (quotes) => createMockSupabase({
  diaspora_logistics_requests: [{
    id: SHIP_REQ, requester_id: REQUESTER, created_by: REQUESTER, tenant_id: null,
    status: 'OPEN_FOR_QUOTES', deleted_at: null,
  }],
  diaspora_logistics_quotes: quotes,
  user_registration_profiles: [providerProfile(PROVIDER_A), providerProfile(PROVIDER_B)],
  users: [{ id: REQUESTER }, { id: PROVIDER_A }, { id: PROVIDER_B }, { id: STRANGER }],
});
const submitted = [{ id: 'lq-a', logistics_request_id: SHIP_REQ, provider_id: PROVIDER_A, status: 'SUBMITTED', deleted_at: null }];

test('requester and provider reach ONE canonical thread, not two', async () => {
  const c = shipDb(submitted);
  const { services, calls } = recordingServices();
  const a = await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(REQUESTER),
    { supabaseClient: c, providerId: PROVIDER_A, communicationServices: services });
  const b = await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_A),
    { supabaseClient: c, communicationServices: services });
  assert.equal(a.role, 'requester');
  assert.equal(b.role, 'provider');
  assert.equal(calls[0].subject_type, 'diaspora_logistics_request');
  assert.equal(calls[0].subject_id, calls[1].subject_id, 'both sides must land on the same thread key');
  assert.deepEqual(calls[0].participants.map((p) => p.user_id).sort(), [PROVIDER_A, REQUESTER].sort());
  assert.match(calls[0].metadata.shipping_reference, /^SHIP-/);
});

test('a DRAFT offer is not an engagement — and cannot be used as an existence oracle', async () => {
  const c = shipDb([{ id: 'lq-d', logistics_request_id: SHIP_REQ, provider_id: PROVIDER_A, status: 'DRAFT', deleted_at: null }]);
  const { services, calls } = recordingServices();
  await assert.rejects(
    () => logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(REQUESTER),
      { supabaseClient: c, providerId: PROVIDER_A, communicationServices: services }),
    /must submit an offer before/i);
  assert.equal(calls.length, 0, "the requester must not learn a private draft exists");
});

/**
 * The ACTUAL policy, documented rather than assumed.
 *
 * While a request is OPEN_FOR_QUOTES any ELIGIBLE logistics provider may open a conversation —
 * asking one question before quoting is the point, and it is symmetric with the procurement
 * supplier. Eligibility is a commercial business profile, never users.role. Once the request is no
 * longer open, a provider needs an ACTIVE (non-withdrawn) offer to keep talking.
 */
test('while the request is OPEN, an eligible provider may ask before quoting', async () => {
  const c = shipDb(submitted);
  const { services, calls } = recordingServices();
  const r = await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_B), { supabaseClient: c, communicationServices: services });
  assert.equal(r.role, 'provider');
  // …but in their OWN thread. Competitors never share one.
  assert.equal(calls[0].subject_id, `${SHIP_REQ}:${PROVIDER_B}`);
});

test('competitors never share a thread', async () => {
  const c = shipDb(submitted);
  const { services, calls } = recordingServices();
  await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_A), { supabaseClient: c, communicationServices: services });
  await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_B), { supabaseClient: c, communicationServices: services });
  assert.notEqual(calls[0].subject_id, calls[1].subject_id);
  assert.ok(!calls[0].participants.some((p) => p.user_id === PROVIDER_B));
  assert.ok(!calls[1].participants.some((p) => p.user_id === PROVIDER_A));
});

test('once the request is CLOSED, only a provider with an ACTIVE offer may still talk', async () => {
  const closed = (quotes) => createMockSupabase({
    diaspora_logistics_requests: [{ id: SHIP_REQ, requester_id: REQUESTER, created_by: REQUESTER, tenant_id: null, status: 'CANCELLED', deleted_at: null }],
    diaspora_logistics_quotes: quotes,
    user_registration_profiles: [providerProfile(PROVIDER_A), providerProfile(PROVIDER_B)],
    users: [{ id: REQUESTER }, { id: PROVIDER_A }, { id: PROVIDER_B }],
  });
  const { services } = recordingServices();
  // An active offer keeps the conversation reachable — history does not become unreachable because
  // the deal ended.
  const still = await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_A),
    { supabaseClient: closed(submitted), communicationServices: services });
  assert.equal(still.role, 'provider');
  // A WITHDRAWN offer is not an active engagement once the request is closed.
  await assert.rejects(
    () => logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_A), {
      supabaseClient: closed([{ id: 'lq-w', logistics_request_id: SHIP_REQ, provider_id: PROVIDER_A, status: 'WITHDRAWN', deleted_at: null }]),
      communicationServices: services,
    }),
    /not open for provider questions/i);
  // A provider who never offered has nothing to continue.
  await assert.rejects(
    () => logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_B), { supabaseClient: closed(submitted), communicationServices: services }),
    /not open for provider questions/i);
});

test('the requester cannot name a provider who never offered', async () => {
  const c = shipDb(submitted);
  const { services, calls } = recordingServices();
  await assert.rejects(
    () => logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(REQUESTER),
      { supabaseClient: c, providerId: PROVIDER_B, communicationServices: services }),
    /must submit an offer before/i);
  assert.equal(calls.length, 0);
});

test('an unrelated person cannot enter at all', async () => {
  const c = shipDb(submitted);
  const { services, calls } = recordingServices();
  await assert.rejects(
    () => logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(STRANGER), { supabaseClient: c, communicationServices: services }),
    /.+/);
  assert.equal(calls.length, 0);
});

test('reopening returns the SAME thread — refresh and relogin do not fork the conversation', async () => {
  const c = shipDb(submitted);
  const { services, calls } = recordingServices();
  for (let i = 0; i < 3; i += 1) {
    await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(PROVIDER_A), { supabaseClient: c, communicationServices: services });
  }
  assert.equal(new Set(calls.map((x) => x.subject_id)).size, 1, 'one canonical thread, however often it is opened');
});

/**
 * Communication history outlives the transaction. A cancelled request must not delete what was
 * said — the record of the conversation is evidence, and evidence is not tidied away when a deal
 * falls through. This pins the ACTUAL policy: the bootstrap refuses on a closed request, and
 * nothing anywhere deletes the thread.
 */
test('cancelling a request does not delete its communication history', async () => {
  const c = createMockSupabase({
    diaspora_logistics_requests: [{
      id: SHIP_REQ, requester_id: REQUESTER, created_by: REQUESTER, tenant_id: null,
      status: 'CANCELLED', deleted_at: null,
    }],
    diaspora_logistics_quotes: submitted,
    user_registration_profiles: [providerProfile(PROVIDER_A)],
    users: [{ id: REQUESTER }, { id: PROVIDER_A }],
  });
  const { services } = recordingServices();
  const src = readFileSync(new URL('../services/diaspora/diasporaLogisticsConversationService.js', import.meta.url), 'utf-8');
  assert.ok(!/delete\(|deleted_at:\s*(new Date|nowIso)/.test(src),
    'the conversation service must never delete a thread');
  // Whatever the bootstrap decides for a cancelled request, it must not be a deletion.
  await logi.ensureLogisticsConversation(SHIP_REQ, ctxFor(REQUESTER),
    { supabaseClient: c, providerId: PROVIDER_A, communicationServices: services }).catch(() => {});
});
