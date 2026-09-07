/**
 * Trade OS T7 — conversation membership is EARNED and SERVER-DERIVED.
 *
 * Both Trade OS conversation services existed with no direct test of their authorization. These
 * pin the rule the phase contract states plainly: never trust a client-supplied participant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const rfq = await import('../services/diaspora/diasporaRfqConversationService.js');
const booking = await import('../services/diaspora/diasporaContainerConversationService.js');

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
  const operator = { id: ORGANISER, userId: ORGANISER, role: 'admin', platformRole: 'admin', tenantId: null };
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
