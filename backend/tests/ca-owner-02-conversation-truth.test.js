/**
 * CA-OWNER-02 (H1/H2) — conversation truth: WHOSE conversation is this, and is a customer really waiting?
 *
 * One definition shared by the Command Center and the Corporate read model.
 *
 * Provenance (H1) is never a new classifier: it is the accepted K2B authority (recordProvenance.js) asked about the
 * conversation's real customer —
 *   · a Marketplace inquiry conversation is judged as K2B judges the INQUIRY (asker + listing), because its
 *     primary_user_id is only a compatibility projection of the SELLER;
 *   · any other conversation is judged by its account principal (primary_user_id);
 *   · a provider smoke test is recognised only by the server-written `smoke_test` audit event — never by a thread key or
 *     metadata a caller can supply;
 *   · anything K2B cannot place is "needs review" — never silently operational, never silently test.
 *
 * SLA truth (H2): a service-level state exists only while a customer turn is actually waiting for a reply, on an operational
 * (or needs-review) conversation. Certification / automation / historical records never become "overdue", and the
 * creation-time response stamp stops counting once a first response is recorded. No timestamp is rewritten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProvenanceIndex } = await import('../services/provenance/provenanceContext.js');
const {
  classifyConversation, slaTruth, conversationTruth, summarizeConversationTruth, categoryForProvenanceClass, CONVERSATION_CATEGORIES,
} = await import('../services/communication/conversationTruth.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const users = [
  { id: 'u_aaaaaaaaaaaaaaaa', email: 'real.seller@gmail.com', name: 'Tendai Moyo' },       // presumed real
  { id: 'u_bbbbbbbbbbbbbbbb', email: 'real.buyer@gmail.com', name: 'Rudo Banda' },         // presumed real
  { id: 'u_cccccccccccccccc', email: 'buyer@carup-staging.test', name: 'UAT buyer' },     // reserved test domain → uat
  { id: 'u_golden_seller_1', email: 'golden@gmail.com', name: 'Golden seller' },           // registered automation family
  { id: 'u1', email: 'seed@gmail.com', name: 'Seed' },                                     // legacy seed → seed_demo
];
const vehicles = [
  { vin: 'JTDBR32E520123456', owner_id: 'u_aaaaaaaaaaaaaaaa', tenant_id: null, make: 'Toyota', seller_description: 'Clean car' },
];
const index = createProvenanceIndex({ users, vehicles });
const inquiries = new Map([
  ['inq-uat', { id: 'inq-uat', buyer_id: 'u_cccccccccccccccc', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
  ['inq-guest', { id: 'inq-guest', buyer_id: null, guest_email: 'someone@gmail.com', guest_name: 'Someone', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
  ['inq-real', { id: 'inq-real', buyer_id: 'u_bbbbbbbbbbbbbbbb', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' }],
]);
const ctx = { index, inquiryById: inquiries, smokeThreadIds: new Set(['t-smoke']) };

const inquiryThread = (id, inquiryId, extra = {}) => ({
  id, status: 'open', thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: inquiryId,
  primary_user_id: 'u_aaaaaaaaaaaaaaaa', created_at: ago(48), sla_due_at: ago(40), ...extra,
});
const accountThread = (id, principal, extra = {}) => ({
  id, status: 'open', thread_type: 'account', subject_type: null, subject_id: null, primary_user_id: principal,
  created_at: ago(48), sla_due_at: ago(40), ...extra,
});

// ── H1 · provenance ────────────────────────────────────────────────────────────────────────────────────────────────────

test('a provider smoke test is recognised by its server-written audit event, whoever the account is', () => {
  const r = classifyConversation(accountThread('t-smoke', 'u_bbbbbbbbbbbbbbbb'), ctx);
  assert.equal(r.category, 'automation');
  assert.equal(r.class, 'ci_automation');
  assert.equal(r.rule, 'audit_event:provider_smoke_test');
});

test('a caller-supplied smoke-test thread key or metadata is NOT evidence', () => {
  const r = classifyConversation(accountThread('t-forged', 'u_bbbbbbbbbbbbbbbb', { thread_key: 'smoke_test:whatsapp:+263', metadata: { smoke_test: true } }), ctx);
  assert.equal(r.category, 'operational', 'only the server audit event marks a smoke test');
});

test('a Marketplace inquiry conversation is judged by the INQUIRY: a UAT buyer makes it certification, even though the seller looks real', () => {
  const r = classifyConversation(inquiryThread('t-uat', 'inq-uat'), ctx);
  assert.equal(r.category, 'certification');
  assert.equal(r.class, 'uat');
  assert.equal(r.basis, 'marketplace_inquiry');
});

test('an unverified guest asker is needs-review (the K2B guest rule), never presumed real', () => {
  const r = classifyConversation(inquiryThread('t-guest', 'inq-guest'), ctx);
  assert.equal(r.category, 'needs_review');
  assert.equal(r.operational, false);
});

test('a real buyer account on a real listing is an operational conversation', () => {
  const r = classifyConversation(inquiryThread('t-real', 'inq-real'), ctx);
  assert.equal(r.category, 'operational');
  assert.equal(r.operational, true);
});

test('an inquiry conversation whose inquiry cannot be found is needs-review, never silently real', () => {
  const r = classifyConversation(inquiryThread('t-orphan', 'inq-missing'), ctx);
  assert.equal(r.category, 'needs_review');
  assert.equal(r.rule, 'inquiry_not_found');
});

test('an account conversation is judged by its principal: registered family → automation, legacy seed → historical, none → needs review', () => {
  assert.equal(classifyConversation(accountThread('t-g', 'u_golden_seller_1'), ctx).category, 'automation');
  assert.equal(classifyConversation(accountThread('t-s', 'u1'), ctx).category, 'historical');
  assert.equal(classifyConversation(accountThread('t-n', null), ctx).category, 'needs_review');
});

test('every K2B class maps to exactly one conversation category', () => {
  assert.deepEqual(CONVERSATION_CATEGORIES, ['operational', 'needs_review', 'certification', 'automation', 'historical']);
  for (const [cls, cat] of Object.entries({
    real_owner_created: 'operational', real_business_operational: 'operational', historical_real: 'historical',
    uat: 'certification', golden_test: 'certification', proof_certification: 'certification',
    ci_automation: 'automation', seed_demo: 'historical', legacy_synthetic: 'historical', unknown_requires_review: 'needs_review',
  })) assert.equal(categoryForProvenanceClass(cls), cat, cls);
});

// ── H2 · SLA truth ─────────────────────────────────────────────────────────────────────────────────────────────────────

const turn = (inbound, outbound) => ({ latestInboundAt: inbound, latestOutboundAt: outbound, now: NOW });

test('a certification or automation record is never overdue, whatever its stale stamp says', () => {
  const s = slaTruth(inquiryThread('t', 'inq-uat'), { category: 'certification', ...turn(ago(30), null) });
  assert.equal(s.state, 'certification');
  assert.equal(s.due_at, null);
  assert.equal(slaTruth(accountThread('t', 'x'), { category: 'automation', ...turn(ago(30), null) }).state, 'certification');
  assert.equal(slaTruth(accountThread('t', 'x'), { category: 'historical', ...turn(ago(30), null) }).state, 'historical');
});

test('a conversation with no customer message waiting is "SLA not applicable", not overdue', () => {
  const s = slaTruth(accountThread('t', 'x', { first_response_at: ago(47) }), { category: 'operational', ...turn(null, ago(47)) });
  assert.equal(s.state, 'not_applicable');
  assert.match(s.reason, /no customer message/i);
});

test('a customer waiting for a first response past the default priority target is overdue — and the target is named as a default', () => {
  const s = slaTruth(accountThread('t', 'x'), { category: 'operational', ...turn(ago(30), null) });
  assert.equal(s.state, 'overdue');
  assert.equal(s.due_at, ago(40));
  assert.equal(s.due_source, 'default_priority_target');
  assert.equal(s.awaiting_since, ago(30));
});

test('after a first response, the creation-time stamp no longer counts: a new customer turn with no recorded target is not overdue', () => {
  const s = slaTruth(accountThread('t', 'x', { first_response_at: ago(44) }), { category: 'operational', ...turn(ago(10), ago(44)) });
  assert.equal(s.state, 'not_applicable');
  assert.match(s.reason, /no reply target/i);
  assert.equal(s.awaiting_since, ago(10));
});

test('a recorded next-response target in the future is a live SLA; one in the past is overdue', () => {
  const live = slaTruth(accountThread('t', 'x', { first_response_at: ago(44), next_response_due_at: new Date(NOW.getTime() + 3_600_000).toISOString() }), { category: 'operational', ...turn(ago(1), ago(44)) });
  assert.equal(live.state, 'live');
  assert.equal(live.due_source, 'service_target');
  const late = slaTruth(accountThread('t', 'x', { first_response_at: ago(44), next_response_due_at: ago(2), sla_policy_id: 'p1' }), { category: 'operational', ...turn(ago(5), ago(44)) });
  assert.equal(late.state, 'overdue');
  assert.equal(late.due_source, 'sla_policy');
});

test('paused, waiting-on-customer, with-assistant and closed conversations carry their own SLA state', () => {
  assert.equal(slaTruth(accountThread('t', 'x', { sla_paused_at: ago(1), sla_pause_reason: 'customer_hold' }), { category: 'operational', ...turn(ago(30), null) }).state, 'paused');
  assert.match(slaTruth(accountThread('t', 'x', { status: 'awaiting_user' }), { category: 'operational', ...turn(ago(30), null) }).reason, /waiting on the customer/i);
  assert.match(slaTruth(accountThread('t', 'x', { status: 'awaiting_ai' }), { category: 'operational', ...turn(ago(30), null) }).reason, /assistant/i);
  assert.match(slaTruth(accountThread('t', 'x', { status: 'resolved' }), { category: 'operational', ...turn(ago(30), null) }).reason, /closed/i);
});

test('a reply sent after the customer\'s last message means nobody is waiting', () => {
  const s = slaTruth(accountThread('t', 'x'), { category: 'operational', ...turn(ago(30), ago(29)) });
  assert.equal(s.state, 'not_applicable');
  assert.match(s.reason, /replied/i);
});

// ── combined + summary ─────────────────────────────────────────────────────────────────────────────────────────────────

test('the customer turn is read from messages when the thread stamp is missing', () => {
  const t = accountThread('t-real-acct', 'u_bbbbbbbbbbbbbbbb', { last_inbound_at: null, last_outbound_at: null });
  const truth = conversationTruth(t, { ...ctx, latestByThread: new Map([['t-real-acct', { inbound: ago(30), outbound: null }]]) }, NOW);
  assert.equal(truth.category, 'operational');
  assert.equal(truth.awaiting_reply, true);
  assert.equal(truth.sla.state, 'overdue');
});

test('the summary counts operational work only as operational: needs-review is shown apart, certification never adds to overdue', () => {
  const latestByThread = new Map([
    ['t-real', { inbound: ago(30), outbound: null }],
    ['t-uat', { inbound: ago(30), outbound: null }],
    ['t-guest', { inbound: ago(30), outbound: null }],
    ['t-smoke', { inbound: null, outbound: ago(30) }],
  ]);
  const list = [
    inquiryThread('t-real', 'inq-real', { assigned_team: 'marketplace' }),
    inquiryThread('t-uat', 'inq-uat'),
    inquiryThread('t-guest', 'inq-guest'),
    accountThread('t-smoke', 'u_bbbbbbbbbbbbbbbb', { status: 'resolved' }),
  ].map((t) => conversationTruth(t, { ...ctx, latestByThread }, NOW));
  const s = summarizeConversationTruth(list);
  assert.equal(s.total, 4);
  assert.deepEqual(s.by_category, { operational: 1, needs_review: 1, certification: 1, automation: 1, historical: 0 });
  assert.equal(s.operational.open, 1);
  assert.equal(s.operational.awaiting_reply, 1);
  assert.equal(s.operational.overdue, 1);
  assert.equal(s.operational.no_individual_assignee, 1);
  assert.equal(s.needs_review.open, 1);
  assert.equal(s.needs_review.awaiting_reply, 1);
  assert.equal(s.non_operational_open, 1, 'only the open UAT conversation; the resolved smoke test is not open');
});
