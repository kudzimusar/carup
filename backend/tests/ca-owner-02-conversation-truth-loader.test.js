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
