/**
 * CA-OWNER-02 (A, H) — Communications position for the Corporate read model, from the SAME conversation truth the Command
 * Center uses.
 *
 * Proven here:
 *   · open / awaiting-reply / overdue / no-individual-assignee count OPERATIONAL conversations only; needs-review and
 *     certification history are reported apart (certification never adds to overdue);
 *   · "overdue" says when it is measured against the default priority targets because no governed SLA policy exists;
 *   · dead-letter notifications are a technical delivery figure with their age and their recipients' K2B classes;
 *   · a failed thread read degrades every conversation fact — never zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { readCommunicationsFacts } = await import('../services/corporate/management/communicationsFacts.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const seed = () => createSupabaseWorld({
  users: [
    { id: 'u_aaaaaaaaaaaaaaaa', email: 'tendai@gmail.com', name: 'Tendai Moyo' },
    { id: 'u_bbbbbbbbbbbbbbbb', email: 'rudo@gmail.com', name: 'Rudo Banda' },
    { id: 'u_cccccccccccccccc', email: 'uat@carup-staging.test', name: 'UAT buyer' },
  ],
  vehicles: [{ vin: 'JTDBR32E520000001', owner_id: 'u_aaaaaaaaaaaaaaaa', make: 'Toyota' }],
  marketplace_inquiries: [
    { id: 'inq-real', buyer_id: 'u_bbbbbbbbbbbbbbbb', listing_id: 'JTDBR32E520000001', listing_type: 'vehicle' },
    { id: 'inq-uat', buyer_id: 'u_cccccccccccccccc', listing_id: 'JTDBR32E520000001', listing_type: 'vehicle' },
    { id: 'inq-guest', buyer_id: null, guest_email: 'x@gmail.com', guest_name: 'X', listing_id: 'JTDBR32E520000001', listing_type: 'vehicle' },
  ],
  message_threads: [
    { id: 't-real', status: 'open', subject_type: 'marketplace_inquiry', subject_id: 'inq-real', primary_user_id: 'u_aaaaaaaaaaaaaaaa', assigned_team: 'marketplace', sla_due_at: ago(40), created_at: ago(48) },
    { id: 't-uat', status: 'open', subject_type: 'marketplace_inquiry', subject_id: 'inq-uat', primary_user_id: 'u_aaaaaaaaaaaaaaaa', sla_due_at: ago(40), created_at: ago(48) },
    { id: 't-guest', status: 'open', subject_type: 'marketplace_inquiry', subject_id: 'inq-guest', primary_user_id: 'u_aaaaaaaaaaaaaaaa', sla_due_at: ago(40), created_at: ago(48) },
    { id: 't-done', status: 'resolved', subject_type: 'marketplace_inquiry', subject_id: 'inq-real', primary_user_id: 'u_aaaaaaaaaaaaaaaa', created_at: ago(100) },
  ],
  messages: [
    { id: 'm1', thread_id: 't-real', direction: 'inbound', created_at: ago(30) },
    { id: 'm2', thread_id: 't-uat', direction: 'inbound', created_at: ago(30) },
    { id: 'm3', thread_id: 't-guest', direction: 'inbound', created_at: ago(20) },
  ],
  communication_audit_events: [],
  communication_sla_policies: [],
  notification_queue: [
    { id: 1, status: 'dead_letter', channel: 'email', recipient_user_id: 'u_cccccccccccccccc', created_at: ago(1000) },
    { id: 2, status: 'dead_letter', channel: 'whatsapp', recipient_user_id: 'u_bbbbbbbbbbbbbbbb', created_at: ago(900) },
    { id: 3, status: 'delivered', channel: 'in_app', recipient_user_id: 'u_bbbbbbbbbbbbbbbb', created_at: ago(10) },
  ],
});

const factsOf = async (client) => Object.fromEntries((await readCommunicationsFacts(client, { now: NOW })).facts.map((f) => [f.id, f]));

test('conversation facts count operational work only; needs-review and certification history are reported apart', async () => {
  const f = await factsOf(seed().client);
  assert.equal(f['communications.conversation.open'].value, 1);
  assert.equal(f['communications.conversation.open'].provenance.raw, 3);
  assert.equal(f['communications.conversation.open'].provenance.excluded_non_operational, 1);
  assert.equal(f['communications.conversation.open'].provenance.unknown_requires_review, 1);
  assert.equal(f['communications.conversation.awaiting_reply'].value, 1);
  assert.equal(f['communications.conversation.awaiting_reply'].extent.oldest_at, ago(30));
  assert.equal(f['communications.conversation.overdue'].value, 1, 'only the operational conversation; the UAT one is never overdue');
  assert.match(f['communications.conversation.overdue'].detail, /no governed SLA policy/i);
  assert.equal(f['communications.conversation.no_individual_assignee'].value, 1);
  assert.equal(f['communications.conversation.needs_review'].value, 1);
  assert.equal(f['communications.conversation.non_operational'].value, 1);
});

test('dead-letter notifications are a technical delivery figure with their age and their recipients\' K2B classes', async () => {
  const f = await factsOf(seed().client);
  const d = f['communications.notification.dead_letter'];
  assert.equal(d.kind, 'technical');
  assert.equal(d.value, 2);
  assert.equal(d.extent.newest_at, ago(900));
  assert.equal(d.provenance.by_class.uat, 1);
});

test('a failed thread read degrades every conversation fact — never zero', async () => {
  const w = seed();
  const client = {
    from(t) {
      if (t !== 'message_threads') return w.client.from(t);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, range: async () => ({ data: null, error: { message: 'down' } }) };
      return q;
    },
  };
  const f = await factsOf(client);
  for (const id of ['communications.conversation.open', 'communications.conversation.awaiting_reply', 'communications.conversation.overdue']) {
    assert.equal(f[id].state, 'DEGRADED', id);
    assert.equal(f[id].value, null, id);
  }
  assert.equal(f['communications.notification.dead_letter'].state, 'TECHNICAL_OPERATIONAL', 'the dead-letter read does not depend on the thread read');
});
