/**
 * CA-OWNER-02 (B) — the named Operations and Trust queues, read from the queue tables directly (never through an existing
 * list endpoint that stops at 50/100/200 rows).
 *
 * Proven here:
 *   · each queue is named separately with its own "awaiting CarUp action" predicate — nothing is summed into a risk score;
 *   · a queue whose records have a principal counts K2B-operational items only and reports what was set aside;
 *   · each queue carries the oldest and newest waiting item and a presence-only attention state (no governed target exists,
 *     so nothing is ever called late);
 *   · governance review never re-counts the evidence items the evidence queue already holds;
 *   · referral trust cases (no principal K2B can judge) are counted only with an explicit "not provenance-filtered" label;
 *   · one failed queue read degrades that queue alone — never zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { readQueueFacts } = await import('../services/corporate/management/queueFacts.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const REAL = 'u_aaaaaaaaaaaaaaaa';
const UAT = 'u_cccccccccccccccc';

const seed = () => createSupabaseWorld({
  users: [
    { id: REAL, email: 'tendai@gmail.com', name: 'Tendai Moyo' },
    { id: UAT, email: 'uat@carup-staging.test', name: 'UAT dealer' },
  ],
  vehicles: [
    { vin: 'JTDBR32E520000001', owner_id: REAL, make: 'Toyota', status: 'Pending', publication_status: 'review_pending', created_at: ago(4) },
    { vin: 'JTDBR32E520000009', owner_id: UAT, make: 'Toyota', status: 'Available', publication_status: 'published', created_at: ago(4) },
  ],
  marketplace_inquiries: [
    { id: 'i1', buyer_id: REAL, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'new', created_at: ago(2) },
    { id: 'i2', buyer_id: REAL, listing_id: 'JTDBR32E520000001', listing_type: 'vehicle', status: 'contacted', created_at: ago(5) },
  ],
  garage_applications: [{ id: 'g1', applicant_user_id: REAL, status: 'submitted', submitted_at: ago(6), created_at: ago(6) }, { id: 'g2', applicant_user_id: REAL, status: 'information_required', submitted_at: ago(9), created_at: ago(9) }],
  diaspora_compliance_reviews: [],
  diaspora_workbook_import_batches: [],
  verification_sessions: [
    { id: 'v1', user_id: REAL, status: 'submitted', workflow_phase: 'reviewer_action_required', submitted_at: ago(3), created_at: ago(3) },
    { id: 'v2', user_id: REAL, status: 'pending_manual_review', workflow_phase: null, submitted_at: ago(8), created_at: ago(8) },
    { id: 'v3', user_id: REAL, status: 'submitted', workflow_phase: 'applicant_action_required', submitted_at: ago(1), created_at: ago(1) },
    { id: 'v4', user_id: UAT, status: 'submitted', workflow_phase: 'escalated', submitted_at: ago(2), created_at: ago(2) },
  ],
  vehicle_evidence: [
    { id: 'e1', vin: 'JTDBR32E520000001', verification_status: 'pending', uploaded_at: ago(7), created_at: ago(7) },
    { id: 'e2', vin: 'JTDBR32E520000009', verification_status: 'pending', uploaded_at: ago(1), created_at: ago(1) },
    { id: 'e3', vin: 'JTDBR32E520000001', verification_status: 'verified', uploaded_at: ago(20), created_at: ago(20) },
  ],
  trust_fact_requests: [],
  fraud_cases: [{ id: 'f1', vin: 'JTDBR32E520000001', status: 'investigating', created_at: ago(10), updated_at: ago(1) }],
  temporal_findings: [{ id: 'tf1', vin: 'JTDBR32E520000001', reviewer_state: 'pending_review', created_at: ago(2) }],
  disclosure_conflicts: [],
  vehicle_identity_candidates: [],
  dealer_profiles: [{ id: 'd1', user_id: UAT, compliance_review_state: 'in_review', created_at: ago(30), updated_at: ago(3) }],
  partsentry_review_requests: [],
  vehicle_document_extractions: [],
  referral_events: [
    { id: 'r1', event_type: 'trust.review_case_created', metadata: { status: 'open' }, created_at: ago(4) },
    { id: 'r2', event_type: 'trust.review_case_created', metadata: { status: 'approved' }, created_at: ago(40) },
  ],
});

const queuesOf = async (client, plane) => {
  const { queues } = await readQueueFacts(client, { now: NOW, plane, communications: async () => ({ summary: { operational: { awaiting_reply: 2, oldest_awaiting_since: ago(1.5) } } }) });
  return Object.fromEntries(queues.map((q) => [q.id, q]));
};

test('operations queues are named separately, each with its own awaiting-CarUp predicate', async () => {
  const q = await queuesOf(seed().client, 'operations');
  assert.equal(q['ops.marketplace_moderation'].fact.value, 1);
  assert.equal(q['ops.marketplace_inquiry_new'].fact.value, 1, 'status new only — contacted is already being handled');
  assert.equal(q['ops.garage_applications'].fact.value, 1, 'information_required is the applicant\'s move, not CarUp\'s');
  assert.equal(q['ops.garage_applications'].fact.extent.oldest_at, ago(6));
  assert.equal(q['ops.communications_awaiting_reply'].fact.value, 2);
  assert.equal(q['ops.diaspora_compliance'].fact.value, 0);
  assert.equal(q['ops.diaspora_compliance'].attention.state, 'clear');
  assert.equal(q['ops.garage_applications'].attention.state, 'work_waiting');
  assert.match(q['ops.garage_applications'].attention.rule, /no governed target/i);
  assert.equal(q['ops.garage_applications'].operate.route, '/admin/garage-applications');
});

test('trust queues count K2B-operational items and report what was set aside', async () => {
  const q = await queuesOf(seed().client, 'trust');
  assert.equal(q['trust.identity_verification'].fact.value, 2, 'reviewer action + legacy manual review; the applicant\'s move and the UAT case are not counted');
  assert.equal(q['trust.identity_verification'].fact.provenance.excluded_non_operational, 1);
  assert.equal(q['trust.evidence'].fact.value, 1, 'the evidence on the UAT-owned vehicle is set aside');
  assert.equal(q['trust.evidence'].fact.extent.oldest_at, ago(7));
  assert.equal(q['trust.fraud'].fact.value, 1);
  assert.equal(q['trust.dealer_compliance'].fact.value, 0);
  assert.equal(q['trust.dealer_compliance'].fact.provenance.excluded_non_operational, 1);
  assert.equal(q['trust.trust_facts'].fact.value, 0);
});

test('governance review never re-counts the evidence items held by the evidence queue', async () => {
  const q = await queuesOf(seed().client, 'trust');
  assert.equal(q['trust.governance_review'].fact.value, 1, 'one temporal finding; the pending evidence items belong to the evidence queue');
  assert.match(q['trust.governance_review'].fact.detail, /evidence/i);
});

test('referral trust cases are counted only with an explicit not-provenance-filtered label', async () => {
  const q = await queuesOf(seed().client, 'trust');
  const r = q['trust.referral'];
  assert.equal(r.fact.value, 1);
  assert.equal(r.fact.provenance, null);
  assert.match(r.fact.detail, /not provenance-filtered/i);
});

test('one failed queue read degrades that queue alone — never zero', async () => {
  const w = seed();
  const client = {
    from(t) {
      if (t !== 'fraud_cases') return w.client.from(t);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'down' } }) };
      return q;
    },
  };
  const q = await queuesOf(client, 'trust');
  assert.equal(q['trust.fraud'].fact.state, 'DEGRADED');
  assert.equal(q['trust.fraud'].fact.value, null);
  assert.equal(q['trust.fraud'].attention.state, 'unknown');
  assert.equal(q['trust.evidence'].fact.state, 'TECHNICAL_OPERATIONAL');
});
