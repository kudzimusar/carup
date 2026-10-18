/**
 * CA-OWNER-02 (H1/H2 in the inbox) — the Command Center list and detail carry each conversation's TRUTH, and the inbox
 * can be viewed by classification.
 *
 * Measured on staging (664 threads): the header said ~654 open / 653 overdue, almost all of it certification and UAT
 * history, and the SLA queue listed every one of them. These tests drive the REAL route handlers over the in-memory
 * Supabase world (the shipped CommunicationRepository + the shipped truth loader), so:
 *
 *   · every thread returned by the list and the detail carries `truth` (category, class, rule, basis, sla, awaiting_reply,
 *     no_individual_assignee) and its `customer`;
 *   · a `view` (active | operational | needs_review | certification | automation | historical | all) is applied to the
 *     CLASSIFIED candidate set BEFORE filtering, sorting and pagination — a page never holds a row from another view;
 *   · a saturated window says so (truth_complete: false) — classification is never silently partial;
 *   · the SLA filters and the SLA sort use truth: certification / automation / historical records are never "breached";
 *   · rows from the DB search RPC (a reduced column set) are judged from their FULL message_threads rows;
 *   · when the truth cannot be read, a classified view refuses (503) instead of presenting an unclassified list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { CommunicationRepository, MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { createAdminCommunicationRouter } = await import('../routes/adminCommunicationRoutes.js');
const {
  CONVERSATION_VIEWS, normalizeConversationView, viewIncludesCategory, viewCounts, truthView, conversationTruth, summarizeConversationTruth,
} = await import('../services/communication/conversationTruth.js');
const { buildThreadQuery } = await import('../services/communication/communicationThreadQuery.js');

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
const ahead = (hours) => new Date(NOW + hours * 3_600_000).toISOString();

const SELLER = { id: 'u_aaaaaaaaaaaaaaaa', email: 'real.seller@gmail.com', name: 'Tendai Moyo', role: 'seller' };
const BUYER = { id: 'u_bbbbbbbbbbbbbbbb', email: 'real.buyer@gmail.com', name: 'Rudo Banda', role: 'buyer' };
const UAT = { id: 'u_cccccccccccccccc', email: 'buyer@carup-staging.test', name: 'UAT buyer', role: 'buyer' };
const SEED = { id: 'u1', email: 'seed@gmail.com', name: 'Seed', role: 'buyer' };

const inquiryThread = (id, inquiryId, hoursAgo, extra = {}) => ({
  id, tenant_id: null, status: 'open', priority: 'normal', thread_type: 'marketplace_inquiry', thread_key: `k-${id}`,
  subject_type: 'marketplace_inquiry', subject_id: inquiryId, primary_user_id: SELLER.id, primary_channel: 'in_app',
  assigned_team: 'marketplace', created_at: ago(48), updated_at: ago(hoursAgo), last_message_at: ago(hoursAgo), sla_due_at: ago(40), metadata: {}, ...extra,
});
const accountThread = (id, principal, hoursAgo, extra = {}) => ({
  id, tenant_id: null, status: 'open', priority: 'normal', thread_type: 'support', thread_key: `k-${id}`,
  subject_type: null, subject_id: null, primary_user_id: principal, primary_channel: 'whatsapp', assigned_team: 'support',
  created_at: ago(48), updated_at: ago(hoursAgo), last_message_at: ago(hoursAgo), sla_due_at: ago(40), metadata: {}, ...extra,
});

function seedWorld({ threads = null } = {}) {
  return createSupabaseWorld({
    users: [SELLER, BUYER, UAT, SEED],
    vehicles: [{ vin: 'JTDBR32E520123456', owner_id: SELLER.id, tenant_id: null, make: 'Toyota', seller_description: 'Clean car' }],
    marketplace_inquiries: [
      { id: 'inq-real', buyer_id: BUYER.id, listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
      { id: 'inq-guest', buyer_id: null, guest_name: 'Chipo Guest', guest_email: 'chipo@gmail.com', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
      { id: 'inq-uat', buyer_id: UAT.id, listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
    ],
    message_threads: threads || [
      inquiryThread('t-op', 'inq-real', 1),
      inquiryThread('t-guest', 'inq-guest', 2),
      inquiryThread('t-uat', 'inq-uat', 3),
      accountThread('t-smoke', null, 4, { thread_key: 'smoke_test:whatsapp:+263' }),
      accountThread('t-hist', SEED.id, 5),
    ],
    message_participants: [
      { id: 'p-op-s', thread_id: 't-op', user_id: SELLER.id, role: 'seller', stakeholder_role: 'seller', participant_type: 'user' },
      { id: 'p-op-b', thread_id: 't-op', user_id: BUYER.id, role: 'buyer', stakeholder_role: 'buyer', participant_type: 'user' },
    ],
    channel_identities: [],
    messages: [
      { id: 'm-op', thread_id: 't-op', direction: 'inbound', channel: 'web', content_text: 'Is it available?', created_at: ago(30) },
      { id: 'm-guest', thread_id: 't-guest', direction: 'inbound', channel: 'web', content_text: 'Price?', created_at: ago(20) },
      { id: 'm-uat', thread_id: 't-uat', direction: 'inbound', channel: 'web', content_text: 'UAT ping', created_at: ago(30) },
    ],
    communication_audit_events: [{ id: 'a-smoke', thread_id: 't-smoke', event_type: 'smoke_test' }],
  });
}

const ADMIN = { id: 'admin-1', role: 'admin', platformRole: 'admin', baseRole: 'admin' };

function handlerOf(router, method, path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} not registered`);
  // Index 0 is authorizeRole; the handler under test is the last layer.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
      send(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, userContext: ADMIN, ...req }, res, (error) => (error ? reject(error) : resolve({ statusCode: 404, body: null })))).catch(reject);
  });
}

function routes(world, repository = new CommunicationRepository({ client: world.client })) {
  const router = createAdminCommunicationRouter({ services: { repository } });
  return {
    list: (query) => call(handlerOf(router, 'get', '/api/admin/communications/threads'), { query }),
    detail: (id) => call(handlerOf(router, 'get', '/api/admin/communications/threads/:id'), { params: { id } }),
  };
}

const ids = (body) => body.threads.map((t) => t.id);

// ── pure view helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

test('views: "active" is operational + needs-review; unknown values are refused, an absent view is "all"', () => {
  assert.deepEqual(CONVERSATION_VIEWS, ['active', 'operational', 'needs_review', 'certification', 'automation', 'historical', 'all']);
  assert.equal(normalizeConversationView(undefined), 'all');
  assert.equal(normalizeConversationView(''), 'all');
  assert.equal(normalizeConversationView('Needs_Review'), 'needs_review');
  assert.equal(normalizeConversationView('everything'), null);
  assert.equal(viewIncludesCategory('active', 'operational'), true);
  assert.equal(viewIncludesCategory('active', 'needs_review'), true);
  assert.equal(viewIncludesCategory('active', 'certification'), false);
  assert.equal(viewIncludesCategory('all', 'historical'), true);
  assert.equal(viewIncludesCategory('automation', 'automation'), true);
  assert.equal(viewIncludesCategory('operational', undefined), false, 'an unclassified row is in no view but "all"');
});

test('truthView projects exactly the verdict the API promises — and view counts come from summarizeConversationTruth', () => {
  const t = conversationTruth(accountThread('x', BUYER.id, 1), { index: { identity: () => ({ class: 'real_business_operational', operational: true, rule: 'r', signals: [] }), user: () => BUYER } }, new Date(NOW));
  const v = truthView(t);
  assert.deepEqual(Object.keys(v).sort(), ['awaiting_reply', 'basis', 'category', 'class', 'latest_inbound_at', 'latest_outbound_at', 'no_individual_assignee', 'open', 'rule', 'sla']);
  assert.deepEqual(Object.keys(v.sla).sort(), ['awaiting_since', 'due_at', 'due_source', 'reason', 'state']);
  const summary = summarizeConversationTruth([t]);
  assert.deepEqual(viewCounts(summary), { all: 1, active: 1, operational: 1, needs_review: 0, certification: 0, automation: 0, historical: 0 });
});

// ── list: classified views ─────────────────────────────────────────────────────────────────────────────────────────────

test('view=active returns only operational + needs-review conversations, each carrying its truth and customer', async () => {
  const { list } = routes(seedWorld());
  const { statusCode, body } = await list({ view: 'active' });
  assert.equal(statusCode, 200);
  assert.deepEqual(ids(body), ['t-op', 't-guest']);
  assert.equal(body.view, 'active');
  assert.equal(body.truth_complete, true);
  assert.deepEqual(body.view_counts, { all: 5, active: 2, operational: 1, needs_review: 1, certification: 1, automation: 1, historical: 1 });
  const op = body.threads[0];
  assert.equal(op.truth.category, 'operational');
  assert.equal(op.truth.basis, 'marketplace_inquiry');
  assert.equal(op.truth.sla.state, 'overdue');
  assert.equal(op.truth.sla.due_source, 'default_priority_target');
  assert.equal(op.truth.awaiting_reply, true);
  assert.equal(op.truth.no_individual_assignee, true);
  assert.deepEqual(op.customer, { display_name: 'Rudo Banda', source: 'buyer_account', identity_id: null }, 'the buyer — never the seller');
  assert.equal(op.seller.display_name, 'Tendai Moyo');
  assert.equal(body.threads[1].truth.category, 'needs_review');
});

test('each classification view holds exactly its own conversations; "all" holds every one, all classified', async () => {
  const { list } = routes(seedWorld());
  for (const [view, expected] of [['operational', ['t-op']], ['needs_review', ['t-guest']], ['certification', ['t-uat']], ['automation', ['t-smoke']], ['historical', ['t-hist']]]) {
    const { body } = await list({ view });
    assert.deepEqual(ids(body), expected, view);
    for (const t of body.threads) assert.equal(viewIncludesCategory(view, t.truth.category), true);
  }
  const all = await list({ view: 'all' });
  assert.deepEqual(ids(all.body).sort(), ['t-guest', 't-hist', 't-op', 't-smoke', 't-uat']);
  assert.ok(all.body.threads.every((t) => t.truth && t.customer));
  assert.equal(all.body.threads.find((t) => t.id === 't-smoke').customer.display_name, 'Provider smoke test');
});

test('classification happens BEFORE pagination: a one-row page of "active" never strands or leaks a row', async () => {
  const { list } = routes(seedWorld());
  const first = await list({ view: 'active', limit: '1' });
  assert.deepEqual(ids(first.body), ['t-op']);
  assert.equal(first.body.page.has_more, true);
  const second = await list({ view: 'active', limit: '1', cursor: first.body.page.next_cursor });
  assert.deepEqual(ids(second.body), ['t-guest']);
  assert.equal(second.body.page.has_more, false, 'the certification / automation / historical rows behind it are not "more"');
});

test('a saturated window is reported: truth_complete is false, never a silently partial classification', async (t) => {
  const saved = process.env.COMMUNICATION_THREAD_WINDOW;
  t.after(() => { if (saved === undefined) delete process.env.COMMUNICATION_THREAD_WINDOW; else process.env.COMMUNICATION_THREAD_WINDOW = saved; });
  process.env.COMMUNICATION_THREAD_WINDOW = '3';
  const { list } = routes(seedWorld());
  const { body } = await list({ view: 'all' });
  assert.equal(body.truth_complete, false);
  assert.equal(body.truth_window.size, 3);
  assert.equal(body.truth_window.saturated, true);
  assert.deepEqual(ids(body).sort(), ['t-guest', 't-op', 't-uat'], 'the three most recently updated');
});

test('a tenant operator\'s classified window is THEIR tenant\'s — other tenants never fill it, and a tenant-less caller sees nothing', async (t) => {
  const saved = process.env.COMMUNICATION_THREAD_WINDOW;
  t.after(() => { if (saved === undefined) delete process.env.COMMUNICATION_THREAD_WINDOW; else process.env.COMMUNICATION_THREAD_WINDOW = saved; });
  process.env.COMMUNICATION_THREAD_WINDOW = '2';
  const world = seedWorld({
    threads: [
      inquiryThread('t-b1', 'inq-real', 1, { tenant_id: 'tenant-b' }),
      inquiryThread('t-b2', 'inq-real', 2, { tenant_id: 'tenant-b' }),
      inquiryThread('t-b3', 'inq-real', 3, { tenant_id: 'tenant-b' }),
      inquiryThread('t-a1', 'inq-real', 4, { tenant_id: 'tenant-a' }),
    ],
  });
  const router = createAdminCommunicationRouter({ services: { repository: new CommunicationRepository({ client: world.client }) } });
  const list = handlerOf(router, 'get', '/api/admin/communications/threads');
  const tenantA = await call(list, { query: { view: 'all' }, userContext: { id: 'agent-a', role: 'support', platformRole: 'support', tenantId: 'tenant-a' } });
  assert.deepEqual(ids(tenantA.body), ['t-a1'], 'tenant B\'s newer threads do not crowd tenant A out of its own window');
  assert.equal(tenantA.body.truth_complete, true);
  const orphan = await call(list, { query: { view: 'all' }, userContext: { id: 'x', role: 'support', platformRole: 'support', tenantId: null } });
  assert.deepEqual(orphan.body.threads, []);
});

test('a full window is read in bounded requests: no IN list longer than 100 ids, no page beyond the row limit', async () => {
  const bulk = Array.from({ length: 450 }, (_, i) => accountThread(`t-${String(i).padStart(4, '0')}`, BUYER.id, 1 + i / 1000));
  const world = seedWorld({ threads: bulk });
  // 12 messages per thread: a 100-thread chunk holds 1200 message rows, more than one PostgREST page.
  for (const t of bulk) for (let k = 0; k < 12; k += 1) world.rows('messages').push({ id: `${t.id}-m${String(k).padStart(2, '0')}`, thread_id: t.id, direction: 'inbound', channel: 'whatsapp', created_at: ago(2 + k) });
  let largestIn = 0;
  const MAX_ROWS = 1000;
  const strict = {
    rpc: (...args) => world.client.rpc(...args),
    from(table) {
      const q = world.client.from(table);
      const realIn = q.in.bind(q);
      const realRange = q.range.bind(q);
      const realThen = q.then.bind(q);
      let ranged = false;
      q.in = (key, values) => {
        largestIn = Math.max(largestIn, values.length);
        // A PostgREST GET carries the IN list in its URL; a gateway refuses an oversized one.
        if (values.length > 100) throw new Error(`414 URI Too Long (${table}.${key}: ${values.length} ids)`);
        return realIn(key, values);
      };
      q.range = (a, b) => { ranged = true; return realRange(a, Math.min(b, a + MAX_ROWS - 1)); };
      // PostgREST's max-rows: an unpaged read silently stops at 1000 rows.
      q.then = (resolve, reject) => realThen((r) => resolve(ranged || !Array.isArray(r?.data) ? r : { ...r, data: r.data.slice(0, MAX_ROWS) }), reject);
      return q;
    },
  };
  const { list } = routes(world, new CommunicationRepository({ client: strict }));
  const { statusCode, body } = await list({ view: 'all', limit: '500' });
  assert.equal(statusCode, 200, JSON.stringify(body).slice(0, 300));
  assert.equal(body.threads.length, 450);
  assert.ok(largestIn <= 100, `largest IN list was ${largestIn}`);
  const short = body.threads.filter((t) => t.unread_count !== 12).map((t) => `${t.id}:${t.unread_count}`);
  assert.deepEqual(short, [], 'every thread\'s messages were read — none lost to the row limit');
});

test('a search still finds a conversation by its customer\'s account email or phone — and by the seller\'s, as the DB search did — inside the view', async () => {
  const world = seedWorld();
  const { error } = await world.client.from('users').update({ phone: '+263771234567' }).eq('id', BUYER.id);
  assert.equal(error ?? null, null);
  const { list } = routes(world);
  // The inquiry thread's primary user is the SELLER; its customer is the inquiry's BUYER (H3). Either account finds it.
  const byEmail = await list({ view: 'active', search: 'real.buyer@gmail.com' });
  assert.equal(byEmail.statusCode, 200);
  assert.deepEqual(ids(byEmail.body), ['t-op']);
  assert.equal(byEmail.body.view_counts.all, 1, 'the views are counted over the searched candidates');
  assert.deepEqual(ids((await list({ view: 'all', search: '771234567' })).body), ['t-op']);
  assert.deepEqual(ids((await list({ view: 'all', search: 'real.seller@gmail.com' })).body), ['t-op', 't-guest', 't-uat']);
  // A search never widens a view, and a term nobody matches finds nothing.
  assert.deepEqual(ids((await list({ view: 'certification', search: 'real.buyer@gmail.com' })).body), []);
  assert.deepEqual(ids((await list({ view: 'all', search: 'nobody@nowhere.invalid' })).body), []);
  // The in-row fields still match on their own (a message text).
  assert.deepEqual(ids((await list({ view: 'all', search: 'Is it available' })).body), ['t-op']);
});

test('an unknown view is refused (400), never silently "all"', async () => {
  const { list } = routes(seedWorld());
  const { statusCode, body } = await list({ view: 'everything' });
  assert.equal(statusCode, 400);
  assert.equal(body.code, 'UNKNOWN_CONVERSATION_VIEW');
});

test('the SLA breach filter uses truth: certification history and answered threads are never "breached"', async () => {
  const world = seedWorld({
    threads: [
      inquiryThread('t-op', 'inq-real', 1),
      inquiryThread('t-uat', 'inq-uat', 2),
      // Answered: the creation-time stamp is in the past, but the first response was recorded and nobody is waiting.
      inquiryThread('t-answered', 'inq-real', 3, { first_response_at: ago(39) }),
    ],
  });
  world.rows('messages').push({ id: 'm-ans-out', thread_id: 't-answered', direction: 'outbound', channel: 'in_app', created_at: ago(39) });
  const { list } = routes(world);
  const { body } = await list({ sla: 'breach', include_terminal: 'false' });
  assert.deepEqual(ids(body), ['t-op']);
  assert.equal(body.counts.sla_breach, 1, 'the tab count is the truth count');
});

test('the SLA sort ranks by the truthful due time; conversations without a live service level sort last', async () => {
  const world = seedWorld({
    threads: [
      inquiryThread('t-later', 'inq-real', 1, { first_response_at: ago(47), next_response_due_at: ahead(5) }),
      inquiryThread('t-uat', 'inq-uat', 2, { sla_due_at: ago(400) }),
      inquiryThread('t-sooner', 'inq-real', 3, { first_response_at: ago(47), next_response_due_at: ahead(1) }),
    ],
  });
  world.rows('messages').push(
    { id: 'm-l', thread_id: 't-later', direction: 'inbound', channel: 'web', created_at: ago(2) },
    { id: 'm-s', thread_id: 't-sooner', direction: 'inbound', channel: 'web', created_at: ago(2) },
  );
  const { list } = routes(world);
  const { body } = await list({ sort: 'sla', view: 'all' });
  assert.deepEqual(ids(body), ['t-sooner', 't-later', 't-uat'], 'a 400-hour-old certification stamp is not "most urgent"');
});

test('when the truth cannot be read, a classified view refuses (503) rather than present an unclassified list', async () => {
  const world = seedWorld();
  const client = {
    from(table) {
      if (table !== 'communication_audit_events') return world.client.from(table);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) };
      return q;
    },
    rpc: (...args) => world.client.rpc(...args),
  };
  const { list } = routes(world, new CommunicationRepository({ client }));
  const { statusCode, body } = await list({ view: 'active' });
  assert.equal(statusCode, 503);
  assert.equal(body.code, 'CONVERSATION_TRUTH_UNAVAILABLE');
  assert.equal(body.threads, undefined, 'no rows are presented as classified');
});

test('a repository without a database client cannot classify: a classified view refuses (503)', async () => {
  const router = createAdminCommunicationRouter({ services: { repository: new MemoryCommunicationRepository({ message_threads: [accountThread('t', BUYER.id, 1)] }) } });
  const { statusCode, body } = await call(handlerOf(router, 'get', '/api/admin/communications/threads'), { query: { view: 'operational' } });
  assert.equal(statusCode, 503);
  assert.equal(body.code, 'CONVERSATION_TRUTH_UNAVAILABLE');
});

// ── list: the API default (no view) keeps its path, and still carries truth ───────────────────────────────────────────

test('without a view the DB search RPC still serves the page — and each row is judged from its FULL thread row', async () => {
  const world = seedWorld({
    threads: [
      // Answered once; the customer then wrote again with no recorded target. The reduced RPC row lacks
      // first_response_at, so judging it would wrongly read the creation-time stamp as "overdue".
      inquiryThread('t-full', 'inq-real', 1, { first_response_at: ago(44), last_inbound_at: ago(10), last_outbound_at: ago(44) }),
    ],
  });
  world.rows('messages').push(
    { id: 'm-full-out', thread_id: 't-full', direction: 'outbound', channel: 'in_app', created_at: ago(44) },
    { id: 'm-full-in', thread_id: 't-full', direction: 'inbound', channel: 'web', created_at: ago(10) },
  );
  const REDUCED = ['id', 'tenant_id', 'thread_type', 'status', 'priority', 'primary_channel', 'assigned_admin_id', 'assigned_team', 'sla_due_at', 'last_message_at', 'updated_at', 'created_at', 'thread_key', 'subject_type', 'subject_id', 'marketplace_listing_id', 'escrow_id', 'financing_application_id', 'primary_user_id', 'ai_mode'];
  let rpcCalls = 0;
  world.rpcs.set('search_communication_threads', (_params, { rowsOf }) => {
    rpcCalls += 1;
    return { data: rowsOf('message_threads').map((r) => Object.fromEntries(REDUCED.map((k) => [k, r[k] ?? null]))), error: null };
  });
  world.rpcs.set('communication_thread_counts', () => ({ data: { total: 1 }, error: null }));
  const { list } = routes(world);
  const { statusCode, body } = await list({});
  assert.equal(statusCode, 200);
  assert.equal(rpcCalls, 1, 'the API default keeps the DB-side search');
  assert.equal(body.page.mode, 'db_keyset');
  assert.equal(body.view, 'all');
  const row = body.threads[0];
  assert.equal(row.truth.category, 'operational');
  assert.equal(row.truth.sla.state, 'not_applicable', 'judged from the full row: the stamp stopped counting at the first response');
  assert.match(row.truth.sla.reason, /no reply target/i);
  assert.equal(row.customer.display_name, 'Rudo Banda');
  assert.equal(body.truth_available, true);
});

test('without a view, a truth failure degrades the rows (truth: null, truth_available: false) instead of failing the inbox', async () => {
  const world = seedWorld();
  const client = {
    from(table) {
      if (table !== 'marketplace_inquiries') return world.client.from(table);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) };
      return q;
    },
    rpc: (...args) => world.client.rpc(...args),
  };
  const { list } = routes(world, new CommunicationRepository({ client }));
  const { statusCode, body } = await list({});
  assert.equal(statusCode, 200);
  assert.equal(body.truth_available, false);
  assert.ok(body.threads.length > 0 && body.threads.every((t) => t.truth === null));
});

// ── detail ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the detail carries the same truth and the same customer as the row', async () => {
  const world = seedWorld();
  const { list, detail } = routes(world);
  const row = (await list({ view: 'all' })).body.threads.find((t) => t.id === 't-op');
  const { statusCode, body } = await detail('t-op');
  assert.equal(statusCode, 200);
  assert.deepEqual(body.thread.truth, row.truth);
  assert.deepEqual(body.thread.customer, row.customer);
  assert.deepEqual(body.thread.seller, row.seller);
  assert.equal(body.truth_available, true);
});

test('on a Marketplace inquiry the detail\'s preferences and linked identities are the BUYER\'s, never the seller\'s', async () => {
  const world = seedWorld();
  world.rows('communication_preferences').push(
    { id: 'pref-seller', user_id: SELLER.id, preferred_channel: 'email', timezone: 'Asia/Tokyo' },
    { id: 'pref-buyer', user_id: BUYER.id, preferred_channel: 'whatsapp', timezone: 'Africa/Harare' },
  );
  world.rows('channel_identities').push(
    { id: 'ci-seller-email', user_id: SELLER.id, channel: 'email', normalized_address: 'real.seller@gmail.com' },
    { id: 'ci-buyer-wa', user_id: BUYER.id, channel: 'whatsapp', normalized_address: '263771234567' },
  );
  const { detail } = routes(world);
  const { body } = await detail('t-op');
  assert.equal(body.preferences.user_id, BUYER.id);
  assert.deepEqual(body.linked_identities.map((i) => i.id), ['ci-buyer-wa']);
});

test('the detail degrades to truth: null when it cannot be judged, never to a guessed verdict', async () => {
  const router = createAdminCommunicationRouter({ services: { repository: new MemoryCommunicationRepository({ message_threads: [accountThread('t', BUYER.id, 1)] }) } });
  const { statusCode, body } = await call(handlerOf(router, 'get', '/api/admin/communications/threads/:id'), { params: { id: 't' } });
  assert.equal(statusCode, 200);
  assert.equal(body.thread.truth, null);
  assert.equal(body.truth_available, false);
});

// ── the pure engine stays backward compatible ──────────────────────────────────────────────────────────────────────────

test('rows without truth keep the legacy SLA filter and sort (repository callers that never classify are unchanged)', () => {
  const rows = [
    { id: 'a', status: 'open', sla_due_at: ago(1), created_at: ago(2) },
    { id: 'b', status: 'open', sla_due_at: ahead(1), created_at: ago(2) },
  ];
  assert.deepEqual(buildThreadQuery(rows, { sla: 'breach' }, { now: NOW }).threads.map((r) => r.id), ['a']);
  assert.deepEqual(buildThreadQuery(rows, { sort: 'sla' }, { now: NOW }).threads.map((r) => r.id), ['a', 'b']);
  assert.equal(buildThreadQuery(rows, {}, { now: NOW }).counts.sla_breach, 1);
});
