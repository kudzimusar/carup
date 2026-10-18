/**
 * CA-OWNER-02 (H2) — the Command Center header strip reads TRUTH, not raw thread stamps.
 *
 * Measured on staging (664 threads): "654 open / 654 unassigned / 653 overdue / 49 dead-letter" — almost all of it
 * certification and UAT history, overdue by the creation-time stamp of conversations nobody is waiting on. GET
 * /api/admin/communications/metrics now carries a `truth` block computed by the conversation-truth loader over EVERY
 * non-terminal thread (read in pages, so nothing is silently truncated at the 1000-row PostgREST limit):
 *
 *   operational: open / awaiting reply / overdue / no individual assignee / oldest awaiting since
 *   needs_review: the same, shown apart — never added to operational
 *   non_operational_open: certification / automation / historical conversations "filtered out of the working inbox"
 *
 * A failed computation is `truth: { available: false }` — the UI shows "unavailable", never 0. The legacy numeric fields
 * stay for API compatibility.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { CommunicationRepository, MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { createAdminCommunicationRouter } = await import('../routes/adminCommunicationRoutes.js');

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

const SELLER = { id: 'u_aaaaaaaaaaaaaaaa', email: 'real.seller@gmail.com', name: 'Tendai Moyo' };
const BUYER = { id: 'u_bbbbbbbbbbbbbbbb', email: 'real.buyer@gmail.com', name: 'Rudo Banda' };
const UAT = { id: 'u_cccccccccccccccc', email: 'buyer@carup-staging.test', name: 'UAT buyer' };
const SEED = { id: 'u1', email: 'seed@gmail.com', name: 'Seed' };

const thread = (id, extra = {}) => ({
  id, tenant_id: null, status: 'open', priority: 'normal', thread_type: 'support', thread_key: `k-${id}`, subject_type: null,
  subject_id: null, primary_user_id: BUYER.id, assigned_team: 'support', created_at: ago(48), updated_at: ago(1), sla_due_at: ago(40), ...extra,
});
const inquiry = (id, inquiryId, extra = {}) => thread(id, { thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: inquiryId, primary_user_id: SELLER.id, ...extra });

function seedWorld({ threads, messages = [], deadLetters = [] } = {}) {
  return createSupabaseWorld({
    users: [SELLER, BUYER, UAT, SEED],
    vehicles: [{ vin: 'JTDBR32E520123456', owner_id: SELLER.id, tenant_id: null, make: 'Toyota', seller_description: 'Clean car' }],
    marketplace_inquiries: [
      { id: 'inq-real', buyer_id: BUYER.id, listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
      { id: 'inq-guest', buyer_id: null, guest_email: 'chipo@gmail.com', guest_name: 'Chipo', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
      { id: 'inq-uat', buyer_id: UAT.id, listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
    ],
    message_threads: threads,
    message_participants: [],
    channel_identities: [],
    messages,
    communication_audit_events: [{ id: 'a-smoke', thread_id: 't-smoke', event_type: 'smoke_test' }],
    notification_queue: deadLetters,
    webhook_logs: [],
  });
}

const STANDARD = {
  threads: [
    inquiry('t-op-overdue', 'inq-real'),                                                        // operational, overdue
    inquiry('t-op-answered', 'inq-real', { first_response_at: ago(39), assigned_admin_id: 'admin-7' }), // operational, nobody waiting
    inquiry('t-guest', 'inq-guest'),                                                             // needs review, overdue
    inquiry('t-uat', 'inq-uat'),                                                                 // certification
    thread('t-smoke', { primary_user_id: null }),                                                // automation
    thread('t-hist', { primary_user_id: SEED.id }),                                              // historical
    inquiry('t-op-resolved', 'inq-real', { status: 'resolved' }),                                // terminal — not counted
    inquiry('t-uat-closed', 'inq-uat', { status: 'closed' }),                                    // terminal — not counted
  ],
  messages: [
    { id: 'm1', thread_id: 't-op-overdue', direction: 'inbound', channel: 'web', created_at: ago(30) },
    { id: 'm2', thread_id: 't-op-answered', direction: 'inbound', channel: 'web', created_at: ago(41) },
    { id: 'm3', thread_id: 't-op-answered', direction: 'outbound', channel: 'in_app', created_at: ago(39) },
    { id: 'm4', thread_id: 't-guest', direction: 'inbound', channel: 'web', created_at: ago(20) },
    { id: 'm5', thread_id: 't-uat', direction: 'inbound', channel: 'web', created_at: ago(30) },
  ],
  deadLetters: [
    { id: 'n1', tenant_id: null, status: 'dead_letter', channel: 'whatsapp', updated_at: ago(30), dead_lettered_at: ago(30) },
    { id: 'n2', tenant_id: null, status: 'dead_letter', channel: 'email', updated_at: ago(2), dead_lettered_at: ago(2) },
  ],
};

const PLATFORM_ADMIN = { id: 'admin-1', role: 'admin', platformRole: 'admin', baseRole: 'admin' };

function metricsHandler(repository) {
  const router = createAdminCommunicationRouter({ services: { repository } });
  const layer = router.stack.find((item) => item.route?.path === '/api/admin/communications/metrics' && item.route.methods?.get);
  assert.ok(layer, 'the metrics route keeps its path');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function getMetrics(repository, userContext = PLATFORM_ADMIN) {
  const handler = metricsHandler(repository);
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, userContext }, res, (e) => (e ? reject(e) : resolve(null)))).catch(reject);
  });
}

test('the truth block counts operational work apart from needs-review, and sets non-operational records aside', async () => {
  const world = seedWorld(STANDARD);
  const { statusCode, body } = await getMetrics(new CommunicationRepository({ client: world.client }));
  assert.equal(statusCode, 200);
  const truth = body.truth;
  assert.equal(truth.available, true);
  assert.deepEqual(truth.operational, {
    open: 2, awaiting_reply: 1, overdue: 1, live: 0, no_individual_assignee: 1, oldest_awaiting_since: ago(30),
  });
  assert.deepEqual(truth.needs_review, {
    open: 1, awaiting_reply: 1, overdue: 1, live: 0, no_individual_assignee: 1, oldest_awaiting_since: ago(20),
  });
  assert.equal(truth.non_operational_open, 3, 'certification + automation + historical, filtered out of the working inbox');
  assert.equal(truth.total_open, 6, 'terminal conversations are not open work');
  assert.deepEqual(truth.by_category, { operational: 2, needs_review: 1, certification: 1, automation: 1, historical: 1 });
  assert.deepEqual(truth.view_counts, { all: 6, active: 3, operational: 2, needs_review: 1, certification: 1, automation: 1, historical: 1 });
  assert.ok(truth.as_of);
});

test('the legacy numeric fields stay for compatibility (the UI no longer shows them)', async () => {
  const world = seedWorld(STANDARD);
  const { body } = await getMetrics(new CommunicationRepository({ client: world.client }));
  for (const key of ['open_threads', 'unassigned_threads', 'overdue_threads', 'dead_letter_count', 'duplicate_webhook_count']) {
    assert.equal(typeof body[key], 'number', key);
  }
  assert.equal(body.overdue_threads, 6, 'the raw stamp still says 6 overdue — exactly the figure the truth replaces (1 operational + 1 needs review)');
});

test('dead-letter stays a labelled technical delivery figure, with its newest date', async () => {
  const world = seedWorld(STANDARD);
  const { body } = await getMetrics(new CommunicationRepository({ client: world.client }));
  assert.equal(body.dead_letter_count, 2);
  assert.equal(body.dead_letter_latest_at, ago(2));
});

test('every non-terminal thread is read — beyond the 1000-row page — so the truth is never silently truncated', async () => {
  const bulk = Array.from({ length: 1205 }, (_, i) => inquiry(`t-uat-${String(i).padStart(4, '0')}`, 'inq-uat'));
  const world = seedWorld({ threads: [...STANDARD.threads, ...bulk], messages: STANDARD.messages });
  const { body } = await getMetrics(new CommunicationRepository({ client: world.client }));
  assert.equal(body.truth.available, true);
  assert.equal(body.truth.by_category.certification, 1206);
  assert.equal(body.truth.non_operational_open, 1208);
  assert.equal(body.truth.operational.overdue, 1, 'twelve hundred stale certification stamps add nothing to overdue');
});

test('a tenant-scoped operator sees only their own tenant in the truth block', async () => {
  const world = seedWorld({
    threads: [inquiry('t-a', 'inq-real', { tenant_id: 'tenant-a' }), inquiry('t-b', 'inq-real', { tenant_id: 'tenant-b' }), inquiry('t-b2', 'inq-guest', { tenant_id: 'tenant-b' })],
    messages: [],
  });
  const { body } = await getMetrics(new CommunicationRepository({ client: world.client }), { id: 'agent-a', role: 'support', platformRole: 'support', tenantId: 'tenant-a' });
  assert.equal(body.truth.total_open, 1);
  assert.equal(body.truth.operational.open, 1);
  assert.equal(body.truth.needs_review.open, 0);
});

test('a failed truth computation is { available: false } — never zeros presented as fact', async () => {
  const world = seedWorld(STANDARD);
  const client = {
    from(table) {
      if (table !== 'messages') return world.client.from(table);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) };
      return q;
    },
    rpc: (...args) => world.client.rpc(...args),
  };
  const { statusCode, body } = await getMetrics(new CommunicationRepository({ client }));
  assert.equal(statusCode, 200, 'the header strip still loads');
  assert.deepEqual(body.truth, { available: false });
  assert.equal(typeof body.dead_letter_count, 'number', 'the delivery figure is independent of the conversation truth');
});

test('without a database client the truth is unavailable, not zero', async () => {
  const { body } = await getMetrics(new MemoryCommunicationRepository({ message_threads: STANDARD.threads }));
  assert.deepEqual(body.truth, { available: false });
});
