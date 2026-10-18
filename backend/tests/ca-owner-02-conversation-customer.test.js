/**
 * CA-OWNER-02 (H3) — ONE primary identity per conversation: its CUSTOMER.
 *
 * Measured on staging: a Marketplace conversation showed three competing headings ("UAT seller" / "Marketplace Inquiry" /
 * "Provider Smoke Test"). The inbox projection named a thread after its primary_user_id, and on a Marketplace inquiry that
 * is the SELLER (canonicalizeMarketplaceInquiry writes it as a compatibility projection). The customer is the asker.
 *
 *   · Marketplace inquiry → the buyer account's name, else the inquiry's guest_name;
 *   · any other conversation → its primary account's name;
 *   · else the external channel identity's display name (a customer-side participant's identity);
 *   · else "Unidentified customer" — never the seller, never an address, never a thread type.
 *   · a provider smoke test (recognised ONLY by the server-written audit event) reads as "Provider smoke test".
 *
 * Adding the identity must not move a single classification or SLA verdict.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createProvenanceIndex } = await import('../services/provenance/provenanceContext.js');
const {
  conversationParties, customerAccountId, isCustomerParticipant, UNIDENTIFIED_CUSTOMER, PROVIDER_SMOKE_TEST_LABEL,
} = await import('../services/communication/conversationCustomer.js');
const {
  conversationTruth, summarizeConversationTruth, classifyConversation, slaTruth,
} = await import('../services/communication/conversationTruth.js');
const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { loadConversationTruth } = await import('../services/communication/conversationTruthLoader.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const SELLER = { id: 'u_aaaaaaaaaaaaaaaa', email: 'real.seller@gmail.com', name: 'Tendai Moyo' };
const BUYER = { id: 'u_bbbbbbbbbbbbbbbb', email: 'real.buyer@gmail.com', name: 'Rudo Banda' };
const NAMELESS = { id: 'u_dddddddddddddddd', email: 'nameless@gmail.com', name: '' };
const index = createProvenanceIndex({
  users: [SELLER, BUYER, NAMELESS],
  vehicles: [{ vin: 'JTDBR32E520123456', owner_id: SELLER.id, tenant_id: null, make: 'Toyota', seller_description: 'Clean car' }],
});

const inquiries = new Map([
  ['inq-account', { id: 'inq-account', buyer_id: BUYER.id, listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
  ['inq-guest', { id: 'inq-guest', buyer_id: null, guest_name: 'Chipo Guest', guest_email: 'chipo@gmail.com', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
  ['inq-anon', { id: 'inq-anon', buyer_id: null, guest_name: null, guest_email: 'anon@gmail.com', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
  ['inq-nameless', { id: 'inq-nameless', buyer_id: NAMELESS.id, guest_name: 'Typed On The Form', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
]);

const inquiryThread = (id, inquiryId, extra = {}) => ({
  id, status: 'open', thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: inquiryId,
  primary_user_id: SELLER.id, created_at: ago(48), ...extra,
});
const accountThread = (id, principal, extra = {}) => ({
  id, status: 'open', thread_type: 'support', subject_type: null, subject_id: null, primary_user_id: principal, created_at: ago(48), ...extra,
});

const ctx = (extra = {}) => ({ index, inquiryById: inquiries, smokeThreadIds: new Set(['t-smoke']), ...extra });

// ── who the customer is ────────────────────────────────────────────────────────────────────────────────────────────────

test('a Marketplace inquiry is named after the BUYER account — the seller (primary_user_id) is context, never the heading', () => {
  const parties = conversationParties(inquiryThread('t-1', 'inq-account'), ctx());
  assert.deepEqual({ ...parties.customer }, { display_name: 'Rudo Banda', source: 'buyer_account', identity_id: null });
  assert.equal(parties.seller.display_name, 'Tendai Moyo');
});

test('a guest Marketplace inquiry is named after the inquiry guest_name', () => {
  const parties = conversationParties(inquiryThread('t-2', 'inq-guest'), ctx());
  assert.deepEqual({ ...parties.customer }, { display_name: 'Chipo Guest', source: 'inquiry_guest', identity_id: null });
});

test('the customer\'s own channel identity is named by id (for the context rail) — never the seller\'s', () => {
  const participantsByThread = new Map([['t-id', [
    { id: 'p-seller', thread_id: 't-id', user_id: SELLER.id, stakeholder_role: 'seller', participant_type: 'user', external_identity_id: 'ci-seller', joined_at: ago(50) },
    { id: 'p-buyer', thread_id: 't-id', user_id: BUYER.id, stakeholder_role: 'buyer', participant_type: 'user', external_identity_id: 'ci-buyer', joined_at: ago(49) },
  ]]]);
  const parties = conversationParties(inquiryThread('t-id', 'inq-account'), ctx({ participantsByThread, identityById: new Map() }));
  assert.equal(parties.customer.display_name, 'Rudo Banda');
  assert.equal(parties.customer.identity_id, 'ci-buyer');
});

test('a buyer account without a recorded name falls back to the name typed on the inquiry', () => {
  assert.equal(conversationParties(inquiryThread('t-3', 'inq-nameless'), ctx()).customer.display_name, 'Typed On The Form');
});

test('a nameless guest falls back to the customer-side channel identity, never to the seller or an address', () => {
  const participantsByThread = new Map([['t-4', [
    { id: 'p-seller', thread_id: 't-4', user_id: SELLER.id, role: 'seller', stakeholder_role: 'seller', participant_type: 'user', external_identity_id: 'ci-seller' },
    { id: 'p-buyer', thread_id: 't-4', user_id: null, role: 'buyer', stakeholder_role: 'buyer', participant_type: 'external_contact', external_identity_id: 'ci-buyer' },
  ]]]);
  const identityById = new Map([
    ['ci-seller', { id: 'ci-seller', display_name: 'Seller WhatsApp Name', channel: 'whatsapp' }],
    ['ci-buyer', { id: 'ci-buyer', display_name: 'Farai (WhatsApp)', channel: 'whatsapp' }],
  ]);
  const parties = conversationParties(inquiryThread('t-4', 'inq-anon'), ctx({ participantsByThread, identityById }));
  assert.deepEqual({ ...parties.customer }, { display_name: 'Farai (WhatsApp)', source: 'channel_identity', identity_id: 'ci-buyer' });
});

test('with nothing to go on the heading is "Unidentified customer" — and the seller name is never borrowed', () => {
  const parties = conversationParties(inquiryThread('t-5', 'inq-anon'), ctx());
  assert.equal(parties.customer.display_name, UNIDENTIFIED_CUSTOMER);
  assert.equal(parties.customer.source, 'unidentified');
  assert.notEqual(parties.customer.display_name, 'Tendai Moyo');
  const orphan = conversationParties(inquiryThread('t-6', 'inq-missing'), ctx());
  assert.equal(orphan.customer.display_name, UNIDENTIFIED_CUSTOMER, 'an inquiry that cannot be found names nobody');
});

test('any other conversation is named after its primary account; with no account, after the requester identity', () => {
  const account = conversationParties(accountThread('t-7', BUYER.id), ctx());
  assert.deepEqual({ ...account.customer }, { display_name: 'Rudo Banda', source: 'account', identity_id: null });
  assert.equal(account.seller, null, 'only a Marketplace inquiry has a seller as context');

  const participantsByThread = new Map([['t-8', [{ id: 'p-req', thread_id: 't-8', user_id: null, role: 'requester', participant_type: 'external_contact', external_identity_id: 'ci-tg' }]]]);
  const identityById = new Map([['ci-tg', { id: 'ci-tg', display_name: 'Telegram Guest', channel: 'telegram' }]]);
  const guest = conversationParties(accountThread('t-8', null), ctx({ participantsByThread, identityById }));
  assert.deepEqual({ ...guest.customer }, { display_name: 'Telegram Guest', source: 'channel_identity', identity_id: 'ci-tg' });
});

test('a provider smoke test reads as ONE heading, recognised only by the server audit event', () => {
  const smoke = conversationParties(accountThread('t-smoke', null), ctx());
  assert.deepEqual({ ...smoke.customer }, { display_name: PROVIDER_SMOKE_TEST_LABEL, source: 'provider_smoke_test', identity_id: null });
  const forged = conversationParties(accountThread('t-forged', BUYER.id, { thread_key: 'smoke_test:whatsapp:+263', metadata: { smoke_test: true } }), ctx());
  assert.equal(forged.customer.display_name, 'Rudo Banda', 'a caller-supplied thread key or metadata is not evidence');
});

test('no email address ever reaches the customer identity', () => {
  for (const t of [inquiryThread('a', 'inq-account'), inquiryThread('b', 'inq-guest'), inquiryThread('c', 'inq-anon'), accountThread('d', NAMELESS.id)]) {
    const serialized = JSON.stringify(conversationParties(t, ctx()));
    assert.ok(!serialized.includes('@'), serialized);
  }
});

// ── the customer account and the customer side (shared with the reply-channel authority) ──────────────────────────────

test('the customer ACCOUNT is the inquiry asker on a Marketplace thread and the primary user elsewhere', () => {
  assert.equal(customerAccountId(inquiryThread('t', 'inq-account'), { inquiry: inquiries.get('inq-account') }), BUYER.id);
  assert.equal(customerAccountId(inquiryThread('t', 'inq-guest'), { inquiry: inquiries.get('inq-guest') }), null, 'a guest has no account');
  assert.equal(customerAccountId(inquiryThread('t', 'inq-x'), {
    inquiry: null,
    participants: [{ id: 'p1', user_id: SELLER.id, stakeholder_role: 'seller' }, { id: 'p2', user_id: BUYER.id, stakeholder_role: 'buyer' }],
  }), BUYER.id, 'without the inquiry row only the buyer participant is evidence — never the seller');
  assert.equal(customerAccountId(accountThread('t', BUYER.id)), BUYER.id);
});

test('the seller is never on the customer side of a Marketplace inquiry; placeholders and departed participants never are', () => {
  const thread = inquiryThread('t', 'inq-account');
  const opts = { thread, customerUserId: BUYER.id };
  assert.equal(isCustomerParticipant({ id: 's', user_id: SELLER.id, stakeholder_role: 'seller', participant_type: 'user' }, opts), false);
  assert.equal(isCustomerParticipant({ id: 's2', user_id: SELLER.id, stakeholder_role: 'participant', participant_type: 'user' }, opts), false, 'the seller account is excluded whatever its role says');
  assert.equal(isCustomerParticipant({ id: 'b', user_id: BUYER.id, stakeholder_role: 'buyer', participant_type: 'user' }, opts), true);
  assert.equal(isCustomerParticipant({ id: 'g', user_id: null, stakeholder_role: 'buyer', participant_type: 'external_contact', external_identity_id: 'ci' }, opts), true);
  assert.equal(isCustomerParticipant({ id: 'x', participant_type: 'system', stakeholder_role: 'buyer_unresolved' }, opts), false);
  assert.equal(isCustomerParticipant({ id: 'l', user_id: BUYER.id, stakeholder_role: 'buyer', participant_type: 'user', left_at: ago(1) }, opts), false);
});

// ── the identity rides on the truth without moving any verdict ─────────────────────────────────────────────────────────

test('conversationTruth carries customer + seller, and every classification and SLA verdict is exactly the pure judges\' own', () => {
  const threads = [
    inquiryThread('t-a', 'inq-account', { sla_due_at: ago(40) }),
    inquiryThread('t-g', 'inq-guest', { sla_due_at: ago(40) }),
    accountThread('t-smoke', BUYER.id, { sla_due_at: ago(40) }),
  ];
  const latestByThread = new Map(threads.map((t) => [t.id, { inbound: ago(30), outbound: null }]));
  for (const t of threads) {
    const truth = conversationTruth(t, { ...ctx(), latestByThread }, NOW);
    assert.ok(truth.customer?.display_name, t.id);
    const provenance = classifyConversation(t, ctx());
    assert.deepEqual(truth.provenance, provenance, `${t.id}: provenance is the classifier's own verdict`);
    assert.deepEqual(truth.sla, slaTruth(t, { category: provenance.category, latestInboundAt: ago(30), latestOutboundAt: null, now: NOW }), `${t.id}: SLA is slaTruth's own verdict`);
    assert.deepEqual(Object.keys(truth).filter((k) => !['customer', 'seller'].includes(k)).sort(), [
      'assigned_team', 'awaiting_reply', 'category', 'latest_inbound_at', 'latest_outbound_at', 'no_individual_assignee', 'open', 'provenance', 'sla', 'status', 'thread_id',
    ], 'only customer + seller are added');
  }
  const summary = summarizeConversationTruth(threads.map((t) => conversationTruth(t, { ...ctx(), latestByThread }, NOW)));
  assert.deepEqual(summary.by_category, { operational: 1, needs_review: 1, certification: 0, automation: 1, historical: 0 });
});

// ── loader ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function world() {
  return createSupabaseWorld({
    users: [SELLER, BUYER],
    vehicles: [{ vin: 'JTDBR32E520123456', owner_id: SELLER.id, tenant_id: null, make: 'Toyota', seller_description: 'Clean car' }],
    marketplace_inquiries: [...inquiries.values()],
    message_threads: [
      inquiryThread('t-acct', 'inq-account', { sla_due_at: ago(40) }),
      inquiryThread('t-anon', 'inq-anon', { sla_due_at: ago(40) }),
    ],
    message_participants: [
      { id: 'p-s', thread_id: 't-anon', user_id: SELLER.id, role: 'seller', stakeholder_role: 'seller', participant_type: 'user' },
      { id: 'p-b', thread_id: 't-anon', user_id: null, role: 'buyer', stakeholder_role: 'buyer', participant_type: 'external_contact', external_identity_id: 'ci-b' },
    ],
    channel_identities: [{ id: 'ci-b', channel: 'whatsapp', display_name: 'Farai (WhatsApp)', normalized_address: '263771234567', external_id: '263771234567' }],
    messages: [],
    communication_audit_events: [],
  });
}

test('the loader reads participants + identities only when asked, and names the customer from them', async () => {
  const w = world();
  const tables = [];
  const spy = { from: (table) => { tables.push(table); return w.client.from(table); } };
  const plain = await loadConversationTruth(spy, { threads: w.rows('message_threads'), now: NOW });
  assert.ok(!tables.includes('message_participants'), 'the default load is unchanged: no participant read');
  assert.equal(plain.truths.find((t) => t.thread_id === 't-acct').customer.display_name, 'Rudo Banda');

  tables.length = 0;
  const full = await loadConversationTruth(spy, { threads: w.rows('message_threads'), now: NOW, withParties: true });
  assert.ok(tables.includes('message_participants') && tables.includes('channel_identities'));
  const anon = full.truths.find((t) => t.thread_id === 't-anon');
  assert.equal(anon.customer.display_name, 'Farai (WhatsApp)');
  assert.ok(!JSON.stringify(full.truths.map((t) => [t.customer, t.seller])).includes('263771234567'), 'never an address');
});

test('a failed participant read throws — a missing name is never presented as a real one', async () => {
  const w = world();
  const failing = {
    from(table) {
      if (table !== 'message_participants') return w.client.from(table);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) };
      return q;
    },
  };
  await assert.rejects(loadConversationTruth(failing, { threads: w.rows('message_threads'), now: NOW, withParties: true }));
});
