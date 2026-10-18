/**
 * CA-OWNER-02 (H1/H2) — the conversation-truth LOADER: it reads exactly what the K2B judgement and the SLA truth need, in
 * full (chunked + paged), and fails loudly instead of returning a partial answer.
 *
 * Proven against the in-memory Supabase world:
 *   · inquiries, principals, listings, smoke-test audit events and the latest customer / staff messages are read for the
 *     given threads, and every thread gets its truth;
 *   · a large thread set is read in chunks without losing a row (no silent 1000-row truncation);
 *   · a failed source read throws — the caller turns that into DEGRADED, never into zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { loadConversationTruth } = await import('../services/communication/conversationTruthLoader.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

function seed(extraThreads = []) {
  return createSupabaseWorld({
    users: [
      { id: 'u_aaaaaaaaaaaaaaaa', email: 'real.seller@gmail.com', name: 'Tendai Moyo' },
      { id: 'u_bbbbbbbbbbbbbbbb', email: 'real.buyer@gmail.com', name: 'Rudo Banda' },
      { id: 'u_cccccccccccccccc', email: 'buyer@carup-staging.test', name: 'UAT buyer' },
    ],
    vehicles: [{ vin: 'JTDBR32E520123456', owner_id: 'u_aaaaaaaaaaaaaaaa', tenant_id: null, make: 'Toyota', seller_description: 'Clean car' }],
    marketplace_inquiries: [
      { id: 'inq-uat', buyer_id: 'u_cccccccccccccccc', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
      { id: 'inq-real', buyer_id: 'u_bbbbbbbbbbbbbbbb', listing_id: 'JTDBR32E520123456', listing_type: 'vehicle' },
    ],
    message_threads: [
      { id: 't-uat', status: 'open', subject_type: 'marketplace_inquiry', subject_id: 'inq-uat', primary_user_id: 'u_aaaaaaaaaaaaaaaa', sla_due_at: ago(40), assigned_team: 'marketplace' },
      { id: 't-real', status: 'open', subject_type: 'marketplace_inquiry', subject_id: 'inq-real', primary_user_id: 'u_aaaaaaaaaaaaaaaa', sla_due_at: ago(40), assigned_team: 'marketplace' },
      { id: 't-smoke', status: 'open', subject_type: null, subject_id: null, primary_user_id: 'u_bbbbbbbbbbbbbbbb', thread_key: 'smoke_test:whatsapp:x', sla_due_at: ago(40) },
      ...extraThreads,
    ],
    messages: [
      { id: 'm1', thread_id: 't-real', direction: 'inbound', created_at: ago(30) },
      { id: 'm2', thread_id: 't-uat', direction: 'inbound', created_at: ago(30) },
      { id: 'm3', thread_id: 't-smoke', direction: 'outbound', created_at: ago(30) },
      { id: 'm4', thread_id: 't-real', direction: 'internal', created_at: ago(1) },
    ],
    communication_audit_events: [
      { id: 'a1', thread_id: 't-smoke', event_type: 'smoke_test' },
      { id: 'a2', thread_id: 't-real', event_type: 'reply_sent' },
    ],
  });
}

test('every thread gets its truth from exactly the rows K2B and the SLA truth need', async () => {
  const world = seed();
  const threads = world.rows('message_threads');
  const { truths, summary } = await loadConversationTruth(world.client, { threads, now: NOW });
  const byId = new Map(truths.map((t) => [t.thread_id, t]));
  assert.equal(byId.get('t-uat').category, 'certification');
  assert.equal(byId.get('t-real').category, 'operational');
  assert.equal(byId.get('t-smoke').category, 'automation');
  assert.equal(byId.get('t-real').sla.state, 'overdue', 'the internal note is not a reply to the customer');
  assert.equal(byId.get('t-real').latest_inbound_at, ago(30));
  assert.equal(summary.operational.overdue, 1);
  assert.equal(summary.non_operational_open, 2);
});

test('a large thread set is read in chunks without losing a row', async () => {
  const extra = Array.from({ length: 1205 }, (_, i) => ({ id: `t-bulk-${String(i).padStart(4, '0')}`, status: 'open', subject_type: null, subject_id: null, primary_user_id: 'u_cccccccccccccccc' }));
  const world = seed(extra);
  const { truths, summary } = await loadConversationTruth(world.client, { threads: world.rows('message_threads'), now: NOW });
  assert.equal(truths.length, 1208);
  assert.equal(summary.by_category.certification, 1206);
});

/**
 * A client whose every request takes `delayMs`, counting requests in flight overall and per table. Measured on the staging
 * candidate: run one after another, the ~20 reads of a 664-conversation load exceeded the 8 s Corporate read budget, so
 * every communications figure was DEGRADED although each read succeeded.
 */
function slowClient(client, delayMs) {
  const stats = { inFlight: 0, max: 0, requests: 0, tables: {} };
  const track = (table, delta) => {
    stats.inFlight += delta;
    const t = (stats.tables[table] ||= { inFlight: 0, max: 0, requests: 0 });
    t.inFlight += delta;
    if (delta > 0) { stats.requests += 1; t.requests += 1; stats.max = Math.max(stats.max, stats.inFlight); t.max = Math.max(t.max, t.inFlight); }
  };
  const wrap = (builder, table) => new Proxy(builder, {
    get(target, prop) {
      if (prop === 'then') {
        return (resolve, reject) => {
          track(table, +1);
          setTimeout(() => target.then((v) => { track(table, -1); resolve(v); }, (e) => { track(table, -1); reject(e); }), delayMs);
        };
      }
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const out = value.apply(target, args);
        return out && typeof out === 'object' && typeof out.then === 'function' ? wrap(out, table) : out;
      };
    },
  });
  return { client: { ...client, from: (table) => wrap(client.from(table), table) }, stats };
}

test('independent reads run at the same time and chunked reads overlap within a bound — the load fits the read budget', async () => {
  const extra = Array.from({ length: 450 }, (_, i) => ({ id: `t-par-${String(i).padStart(4, '0')}`, status: 'open', subject_type: null, subject_id: null, primary_user_id: 'u_cccccccccccccccc' }));
  const world = seed(extra);
  const { client, stats } = slowClient(world.client, 20);
  const { truths } = await loadConversationTruth(client, { threads: world.rows('message_threads'), now: NOW });
  assert.equal(truths.length, 453, 'nothing is lost by reading concurrently');
  assert.ok(stats.tables.messages.requests >= 5, 'the 453 thread ids are read in 100-id chunks');
  assert.ok(stats.max >= 3, `independent sources overlap (max in flight ${stats.max})`);
  assert.ok(stats.tables.messages.max >= 2, `message chunks overlap (max ${stats.tables.messages.max})`);
  for (const [table, t] of Object.entries(stats.tables)) assert.ok(t.max <= 4, `${table}: at most 4 chunk reads in flight (saw ${t.max})`);
});

test('a failed source read throws, so the caller can show the figure as degraded — never as zero', async () => {
  const world = seed();
  const failing = {
    from(table) {
      if (table !== 'messages') return world.client.from(table);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) };
      return q;
    },
  };
  await assert.rejects(loadConversationTruth(failing, { threads: world.rows('message_threads'), now: NOW }));
});
