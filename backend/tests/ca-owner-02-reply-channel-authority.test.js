/**
 * CA-OWNER-02 (H4) — the SERVER decides which channels a Command Center reply can reach, from the CUSTOMER's evidence.
 *
 * Found on staging: recordAdminThreadReply sent `body.channel || thread.primary_channel || 'in_app'`. A conversation that
 * began in-app and continued on WhatsApp keeps primary_channel = 'in_app', so any caller that did not name a channel
 * replied in-app; and an in-app reply on a Marketplace thread went to thread.primary_user_id — the SELLER.
 *
 *   deliverable = the customer's bindings (can_send ≠ false, transactional_consent ≠ false, not expired)
 *               + the customer's channel identities (not opted out / revoked)
 *               + in_app ONLY when the customer has a CarUp account (never the seller's)
 *   default     = the channel of the customer's latest inbound message / binding, if deliverable
 *                 → else the primary deliverable binding → else in_app for an account → else 409 REPLY_CHANNEL_UNRESOLVED
 *                 (thread.primary_channel on its own is never the answer)
 *   requested   = used only if deliverable, otherwise 409 REPLY_CHANNEL_NOT_DELIVERABLE — never silently substituted.
 * Internal notes are unchanged (no delivery). Nothing is written when a reply is refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  replyChannelAuthority, resolveReplyChannel, REPLY_CHANNEL_NOT_DELIVERABLE, REPLY_CHANNEL_UNRESOLVED,
} = await import('../services/communication/replyChannelResolution.js');
const { recordAdminThreadReply, createAdminCommunicationRouter } = await import('../routes/adminCommunicationRoutes.js');
const { createSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { CommunicationRepository } = await import('../services/communication/communicationRepository.js');

const NOW = Date.parse('2026-10-18T00:00:00.000Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const ACCOUNT_THREAD = { id: 'th-acct', primary_user_id: 'u-cust', primary_channel: 'in_app', priority: 'normal', tenant_id: null, thread_type: 'support' };
const INQUIRY_THREAD = {
  id: 'th-mkt', primary_user_id: 'u-seller', primary_channel: 'in_app', priority: 'normal', tenant_id: null,
  thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'inq-1',
};
const GUEST_THREAD = { ...INQUIRY_THREAD, id: 'th-guest', subject_id: 'inq-guest' };

const P_CUST = { id: 'p-cust', thread_id: 'th-acct', user_id: 'u-cust', participant_type: 'user', role: 'requester', is_active: true, external_identity_id: 'ci-cust-wa' };
const P_SELLER = { id: 'p-seller', thread_id: 'th-mkt', user_id: 'u-seller', participant_type: 'user', stakeholder_role: 'seller', role: 'seller', external_identity_id: 'ci-seller-wa' };
const P_BUYER = { id: 'p-buyer', thread_id: 'th-mkt', user_id: 'u-buyer', participant_type: 'user', stakeholder_role: 'buyer', role: 'buyer', external_identity_id: 'ci-buyer-wa' };
const P_GUEST_SELLER = { ...P_SELLER, id: 'p-g-seller', thread_id: 'th-guest' };
const P_GUEST = { id: 'p-guest', thread_id: 'th-guest', user_id: null, participant_type: 'external_contact', stakeholder_role: 'buyer', role: 'buyer', external_identity_id: 'ci-guest-wa' };

const WA = (id, userId, address, extra = {}) => ({ id, user_id: userId, channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: address, normalized_address: address, consent_status: 'implied_transactional', ...extra });
const CI_CUST = WA('ci-cust-wa', 'u-cust', '263770000001');
const CI_SELLER = WA('ci-seller-wa', 'u-seller', '818081201356');
const CI_BUYER = WA('ci-buyer-wa', 'u-buyer', '263771234567');
const CI_GUEST = WA('ci-guest-wa', null, '263779999999');

const bind = (threadId, participantId, channel, identityId, extra = {}) => ({
  id: `b-${participantId}-${channel}`, thread_id: threadId, participant_id: participantId, channel, channel_identity_id: identityId,
  can_send: true, transactional_consent: true, ...extra,
});

const inbound = (threadId, channel, hoursAgo) => ({ id: `in-${threadId}-${channel}-${hoursAgo}`, thread_id: threadId, direction: 'inbound', channel, created_at: at(hoursAgo) });

// ── the pure authority ─────────────────────────────────────────────────────────────────────────────────────────────────

test('REQUIRED: primary_channel in_app + the customer\'s primary WhatsApp binding with the latest inbound → default "whatsapp"', () => {
  const authority = replyChannelAuthority({
    thread: ACCOUNT_THREAD,
    participants: [P_CUST],
    bindings: [bind('th-acct', 'p-cust', 'whatsapp', 'ci-cust-wa', { is_primary: true, last_inbound_message_id: 'in-wa', last_used_at: at(1) })],
    identities: [CI_CUST],
    messages: [inbound('th-acct', 'in_app', 300), inbound('th-acct', 'whatsapp', 1)],
    now: NOW,
  });
  assert.equal(authority.default_channel, 'whatsapp');
  assert.equal(authority.basis, 'latest_inbound');
  assert.deepEqual(authority.deliverable, ['whatsapp', 'in_app']);
  assert.deepEqual(resolveReplyChannel(authority, null), { ok: true, channel: 'whatsapp', basis: 'latest_inbound' });
});

test('REQUIRED: a guest has no account, so in_app is not deliverable and a requested in_app is refused', () => {
  const authority = replyChannelAuthority({
    thread: GUEST_THREAD,
    inquiry: { id: 'inq-guest', buyer_id: null, guest_name: 'Chipo' },
    participants: [P_GUEST_SELLER, P_GUEST],
    bindings: [bind('th-guest', 'p-guest', 'whatsapp', 'ci-guest-wa', { is_primary: true })],
    identities: [CI_GUEST, CI_SELLER],
    messages: [inbound('th-guest', 'web', 5)],
    now: NOW,
  });
  assert.deepEqual(authority.deliverable, ['whatsapp'], 'the seller\'s account never makes in_app deliverable');
  assert.equal(authority.default_channel, 'whatsapp');
  assert.equal(authority.basis, 'primary_binding', 'the inquiry form (web) is not a reply channel');
  const refused = resolveReplyChannel(authority, 'in_app');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, REPLY_CHANNEL_NOT_DELIVERABLE);
});

test('REQUIRED: a requested email with no email binding or identity is refused, never substituted', () => {
  const authority = replyChannelAuthority({
    thread: ACCOUNT_THREAD, participants: [P_CUST], bindings: [bind('th-acct', 'p-cust', 'whatsapp', 'ci-cust-wa')], identities: [CI_CUST], messages: [], now: NOW,
  });
  const refused = resolveReplyChannel(authority, 'email');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, REPLY_CHANNEL_NOT_DELIVERABLE);
  assert.deepEqual(refused.deliverable, ['whatsapp', 'in_app']);
});

test('on a Marketplace inquiry the SELLER\'s bindings and identities are never the customer\'s channels', () => {
  const authority = replyChannelAuthority({
    thread: INQUIRY_THREAD,
    inquiry: { id: 'inq-1', buyer_id: 'u-buyer' },
    participants: [P_SELLER, { ...P_BUYER, external_identity_id: null }],
    bindings: [bind('th-mkt', 'p-seller', 'telegram', 'ci-seller-tg', { is_primary: true, last_used_at: at(1) })],
    identities: [CI_SELLER],
    messages: [],
    now: NOW,
  });
  assert.deepEqual(authority.deliverable, ['in_app'], 'only the buyer\'s CarUp account');
  assert.equal(authority.customer.user_id, 'u-buyer');
  assert.equal(authority.default_channel, 'in_app');
  assert.equal(authority.basis, 'customer_account');
});

test('bindings that cannot send, lack transactional consent or have expired are not deliverable; opted-out identities neither', () => {
  const authority = replyChannelAuthority({
    thread: GUEST_THREAD,
    inquiry: { id: 'inq-guest', buyer_id: null },
    participants: [P_GUEST_SELLER, { ...P_GUEST, external_identity_id: 'ci-guest-email' }],
    bindings: [
      bind('th-guest', 'p-guest', 'whatsapp', 'ci-guest-wa', { can_send: false }),
      bind('th-guest', 'p-guest', 'telegram', 'ci-guest-tg', { transactional_consent: false }),
      bind('th-guest', 'p-guest', 'sms', 'ci-guest-sms', { expires_at: at(1) }),
    ],
    identities: [{ id: 'ci-guest-email', channel: 'email', consent_status: 'opted_out' }],
    messages: [],
    now: NOW,
  });
  assert.deepEqual(authority.deliverable, []);
  assert.equal(authority.default_channel, null);
  assert.equal(resolveReplyChannel(authority, null).code, REPLY_CHANNEL_UNRESOLVED);
});

test('thread.primary_channel on its own is never the answer', () => {
  const authority = replyChannelAuthority({
    thread: { ...ACCOUNT_THREAD, primary_channel: 'whatsapp' }, participants: [{ ...P_CUST, external_identity_id: null }], bindings: [], identities: [], messages: [], now: NOW,
  });
  assert.deepEqual(authority.deliverable, ['in_app']);
  assert.equal(authority.default_channel, 'in_app');
  assert.equal(resolveReplyChannel(authority, 'whatsapp').code, REPLY_CHANNEL_NOT_DELIVERABLE);
});

test('the default prefers the latest customer turn: a newer Telegram message beats an older primary WhatsApp binding', () => {
  const authority = replyChannelAuthority({
    thread: ACCOUNT_THREAD,
    participants: [{ ...P_CUST, external_identity_id: null }],
    bindings: [
      bind('th-acct', 'p-cust', 'whatsapp', 'ci-cust-wa', { is_primary: true, last_used_at: at(50) }),
      bind('th-acct', 'p-cust', 'telegram', 'ci-cust-tg', { last_used_at: at(2) }),
    ],
    identities: [],
    messages: [inbound('th-acct', 'whatsapp', 50), inbound('th-acct', 'telegram', 2)],
    now: NOW,
  });
  assert.equal(authority.default_channel, 'telegram');
  assert.deepEqual(authority.deliverable, ['whatsapp', 'telegram', 'in_app'], 'the primary binding is listed first');
});

// ── recordAdminThreadReply: the authority is enforced on the write path ───────────────────────────────────────────────

function harness({ thread, participants = [], bindings = [], identities = [], messages = [], inquiries = [] } = {}) {
  const queued = [];
  const recorded = [];
  const deleted = [];
  const repository = {
    async list(table, filter = {}) {
      if (table === 'message_participants') return participants.filter((p) => p.thread_id === filter.thread_id);
      if (table === 'conversation_channel_bindings') return bindings.filter((b) => b.thread_id === filter.thread_id);
      if (table === 'messages') {
        return messages.filter((m) => (filter.thread_id === undefined || m.thread_id === filter.thread_id)
          && (filter.direction === undefined || m.direction === filter.direction)
          && (filter.client_message_id === undefined || m.client_message_id === filter.client_message_id));
      }
      return [];
    },
    async findOne(table, filter = {}) {
      if (table === 'channel_identities') return identities.find((i) => i.id === filter.id) || null;
      if (table === 'message_participants') return participants.find((p) => p.id === filter.id) || null;
      if (table === 'marketplace_inquiries') return inquiries.find((i) => i.id === filter.id) || null;
      return null;
    },
    async deleteById(table, id) { deleted.push([table, id]); return null; },
    async updateById() { return null; },
  };
  const services = {
    repository,
    threadService: { async recordMessage(_t, input) { const m = { id: `msg-${recorded.length + 1}`, provider: null, ...input }; recorded.push(m); return m; } },
    notificationService: { async queueExistingMessage(input) { queued.push(input); return { notification: { id: queued.length, status: 'queued' } }; } },
  };
  const reply = (body) => recordAdminThreadReply({ services, thread, actor: { id: 'admin-1' }, body: { message: 'hello', client_message_id: 'cmid-1', ...body } });
  return { reply, queued, recorded, deleted };
}

test('REQUIRED (write path): no channel named → the reply goes out on the customer\'s WhatsApp, not the stale primary_channel', async () => {
  const { reply, queued, recorded } = harness({
    thread: ACCOUNT_THREAD,
    participants: [P_CUST],
    bindings: [bind('th-acct', 'p-cust', 'whatsapp', 'ci-cust-wa', { is_primary: true, last_inbound_message_id: 'in-wa', last_used_at: at(1) })],
    identities: [CI_CUST],
    messages: [inbound('th-acct', 'in_app', 300), inbound('th-acct', 'whatsapp', 1)],
  });
  await reply({});
  assert.equal(recorded[0].channel, 'whatsapp');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].channel, 'whatsapp');
  assert.equal(queued[0].recipientIdentityId, 'ci-cust-wa');
  assert.equal(queued[0].payload.phone_number, '263770000001');
});

test('REQUIRED (write path): requested in_app for a guest → 409 REPLY_CHANNEL_NOT_DELIVERABLE and nothing is written', async () => {
  const { reply, queued, recorded } = harness({
    thread: GUEST_THREAD,
    participants: [P_GUEST_SELLER, P_GUEST],
    bindings: [bind('th-guest', 'p-guest', 'whatsapp', 'ci-guest-wa', { is_primary: true })],
    identities: [CI_GUEST, CI_SELLER],
    inquiries: [{ id: 'inq-guest', buyer_id: null }],
  });
  await assert.rejects(reply({ channel: 'in_app' }), (e) => e.statusCode === 409 && e.code === REPLY_CHANNEL_NOT_DELIVERABLE && /in.app/i.test(e.message));
  assert.equal(recorded.length, 0, 'refused before any message is recorded');
  assert.equal(queued.length, 0);
});

test('REQUIRED (write path): requested email without an email binding or identity → 409, nothing written', async () => {
  const { reply, queued, recorded } = harness({
    thread: ACCOUNT_THREAD, participants: [P_CUST], bindings: [bind('th-acct', 'p-cust', 'whatsapp', 'ci-cust-wa')], identities: [CI_CUST],
  });
  await assert.rejects(reply({ channel: 'email' }), (e) => e.statusCode === 409 && e.code === REPLY_CHANNEL_NOT_DELIVERABLE);
  assert.equal(recorded.length, 0);
  assert.equal(queued.length, 0);
});

test('REQUIRED (write path): an in_app reply on a Marketplace inquiry goes to the BUYER account, never the seller', async () => {
  const { reply, queued } = harness({
    thread: INQUIRY_THREAD,
    participants: [P_SELLER, P_BUYER],
    inquiries: [{ id: 'inq-1', buyer_id: 'u-buyer' }],
    identities: [CI_SELLER, CI_BUYER],
  });
  await reply({ channel: 'in_app' });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].channel, 'in_app');
  assert.equal(queued[0].recipientUserId, 'u-buyer');
  assert.deepEqual(queued[0].dedupeParts, ['admin_reply', 'th-mkt', 'cmid-1', 'u-buyer']);
});

test('a WhatsApp reply on a Marketplace inquiry reaches the buyer even when the seller has a fresher WhatsApp binding', async () => {
  const { reply, queued } = harness({
    thread: INQUIRY_THREAD,
    participants: [P_SELLER, P_BUYER],
    bindings: [
      bind('th-mkt', 'p-seller', 'whatsapp', 'ci-seller-wa', { last_used_at: at(1) }),
      bind('th-mkt', 'p-buyer', 'whatsapp', 'ci-buyer-wa', { last_used_at: at(30) }),
    ],
    identities: [CI_SELLER, CI_BUYER],
    inquiries: [{ id: 'inq-1', buyer_id: 'u-buyer' }],
  });
  await reply({ channel: 'whatsapp' });
  assert.equal(queued[0].recipientUserId, 'u-buyer');
  assert.equal(queued[0].payload.phone_number, '263771234567');
  assert.ok(!JSON.stringify(queued[0]).includes('818081201356'), 'the seller\'s number never appears');
});

test('naming the seller as the recipient on a Marketplace inquiry is refused', async () => {
  const { reply, queued } = harness({
    thread: INQUIRY_THREAD,
    participants: [P_SELLER, P_BUYER],
    bindings: [bind('th-mkt', 'p-seller', 'whatsapp', 'ci-seller-wa'), bind('th-mkt', 'p-buyer', 'whatsapp', 'ci-buyer-wa')],
    identities: [CI_SELLER, CI_BUYER],
    inquiries: [{ id: 'inq-1', buyer_id: 'u-buyer' }],
  });
  await assert.rejects(reply({ channel: 'whatsapp', recipient_participant_id: 'p-seller' }), (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

test('no channel named and nothing reachable → 409 REPLY_CHANNEL_UNRESOLVED, nothing written', async () => {
  const { reply, queued, recorded } = harness({
    thread: GUEST_THREAD,
    participants: [P_GUEST_SELLER, { ...P_GUEST, external_identity_id: null }],
    inquiries: [{ id: 'inq-guest', buyer_id: null }],
  });
  await assert.rejects(reply({}), (e) => e.statusCode === 409 && e.code === REPLY_CHANNEL_UNRESOLVED);
  assert.equal(recorded.length, 0);
  assert.equal(queued.length, 0);
});

test('an internal note is unchanged: no channel authority, no delivery, the thread\'s own channel label', async () => {
  const { reply, queued, recorded } = harness({ thread: GUEST_THREAD, participants: [], inquiries: [{ id: 'inq-guest', buyer_id: null }] });
  const result = await reply({ internal: true, channel: 'in_app' });
  assert.equal(result.notification, null);
  assert.equal(recorded[0].direction, 'internal');
  assert.equal(recorded[0].channel, 'in_app');
  assert.equal(queued.length, 0);
});

test('a replayed client_message_id is answered from the original record even if the channel would now be refused', async () => {
  const { reply, queued, recorded } = harness({
    thread: GUEST_THREAD,
    participants: [],
    messages: [{ id: 'msg-original', thread_id: 'th-guest', client_message_id: 'cmid-1', direction: 'outbound', channel: 'whatsapp' }],
    inquiries: [{ id: 'inq-guest', buyer_id: null }],
  });
  const result = await reply({ channel: 'in_app' });
  assert.equal(result.duplicate, true);
  assert.equal(result.message.id, 'msg-original');
  assert.equal(recorded.length, 0);
  assert.equal(queued.length, 0);
});

// ── the detail exposes the authority to the composer ───────────────────────────────────────────────────────────────────

test('GET /threads/:id exposes reply_channel { default_channel, deliverable, basis } for the composer', async () => {
  const world = createSupabaseWorld({
    message_threads: [{ ...ACCOUNT_THREAD, status: 'open', created_at: at(400), updated_at: at(1) }],
    message_participants: [P_CUST],
    channel_identities: [CI_CUST],
    conversation_channel_bindings: [bind('th-acct', 'p-cust', 'whatsapp', 'ci-cust-wa', { is_primary: true, last_inbound_message_id: 'in-wa', last_used_at: at(1) })],
    messages: [inbound('th-acct', 'in_app', 300), inbound('th-acct', 'whatsapp', 1)],
    users: [{ id: 'u-cust', email: 'cust@gmail.com', name: 'Rudo Banda' }],
  });
  const router = createAdminCommunicationRouter({ services: { repository: new CommunicationRepository({ client: world.client }) } });
  const layer = router.stack.find((item) => item.route?.path === '/api/admin/communications/threads/:id' && item.route.methods?.get);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const body = await new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve(b); } };
    Promise.resolve(handler({ params: { id: 'th-acct' }, query: {}, headers: {}, userContext: { id: 'admin-1', platformRole: 'admin' } }, res, reject)).catch(reject);
  });
  assert.deepEqual(body.reply_channel, { default_channel: 'whatsapp', deliverable: ['whatsapp', 'in_app'], basis: 'latest_inbound' });
  assert.equal(JSON.stringify(body.reply_channel).includes('263770000001'), false, 'channels only — never an address');
});
