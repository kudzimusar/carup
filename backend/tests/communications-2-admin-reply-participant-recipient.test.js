import { test } from 'node:test';
import assert from 'node:assert';

const { recordAdminThreadReply } = await import('../routes/adminCommunicationRoutes.js');

/**
 * An admin reply must be delivered to a PARTICIPANT, not to thread.primary_user_id.
 *
 * Found by physical staging certification, not by review. canonicalizeMarketplaceInquiry sets
 * `primary_user_id: sellerId` and documents it as "compatibility projection only; auth is
 * participant-based" — but recordAdminThreadReply used it as the delivery address key. On the
 * certification thread the seller had no WhatsApp binding while the BUYER participant owned it, so
 * the reply resolved nothing and returned 422. A whole-database scan then found ZERO threads where
 * primary_user_id owned a send-capable WhatsApp binding: no canonical Marketplace conversation
 * could drive a governed WhatsApp admin reply at all.
 *
 * The dangerous fix is "just use the first bound participant" — on a multi-party thread that
 * delivers one customer's reply to another. So ambiguity fails closed and is never settled by
 * cross-participant recency.
 */

const MARKETPLACE_THREAD = {
  id: 'thread-mkt',
  // The seller, exactly as canonicalizeMarketplaceInquiry writes it.
  primary_user_id: 'user-seller',
  primary_channel: 'in_app',
  priority: 'normal',
  tenant_id: '00000000-0000-0000-0000-000000000001',
};

const SELLER = { id: 'p-seller', thread_id: 'thread-mkt', user_id: 'user-seller', participant_type: 'user', stakeholder_role: 'seller', is_active: true };
const BUYER = { id: 'p-buyer', thread_id: 'thread-mkt', user_id: 'user-buyer', participant_type: 'user', stakeholder_role: 'buyer', is_active: true };
const BUYER_2 = { id: 'p-buyer-2', thread_id: 'thread-mkt', user_id: 'user-buyer-2', participant_type: 'user', stakeholder_role: 'buyer', is_active: true };
const SYSTEM_PLACEHOLDER = { id: 'p-sys', thread_id: 'thread-mkt', user_id: null, participant_type: 'system', stakeholder_role: 'buyer_unresolved', is_active: true };
const FOREIGN = { id: 'p-foreign', thread_id: 'thread-other', user_id: 'user-foreign', participant_type: 'user', is_active: true };

const WA_BUYER = { id: 'id-wa-buyer', user_id: 'user-buyer', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '263771234567', normalized_address: '263771234567' };
const WA_BUYER_2 = { id: 'id-wa-buyer-2', user_id: 'user-buyer-2', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '263779999999', normalized_address: '263779999999' };
const WA_SELLER = { id: 'id-wa-seller', user_id: 'user-seller', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '818081201356', normalized_address: '818081201356' };
const WA_FOREIGN = { id: 'id-wa-foreign', user_id: 'user-foreign', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '263770000001', normalized_address: '263770000001' };

const bind = (participantId, channel, identityId, extra = {}) => ({
  thread_id: 'thread-mkt', participant_id: participantId, channel, channel_identity_id: identityId, can_send: true, ...extra,
});

function harness({
  participants, bindings, identities, channel = 'whatsapp',
  thread = MARKETPLACE_THREAD, body = {}, existingMessages = [],
} = {}) {
  const queued = [];
  const recorded = [];
  const deleted = [];
  const repository = {
    async list(table, filter = {}) {
      // Honour the thread_id filter the way the real repository does, so thread scoping is not
      // accidentally provided by the mock.
      if (table === 'message_participants') return participants.filter((p) => p.thread_id === filter.thread_id);
      if (table === 'conversation_channel_bindings') return bindings.filter((b) => b.thread_id === filter.thread_id);
      if (table === 'messages') return existingMessages.filter((m) => m.client_message_id === filter.client_message_id);
      if (table === 'notification_queue') return [];
      return [];
    },
    async findOne(table, filter = {}) {
      if (table === 'channel_identities') return identities.find((i) => i.id === filter.id) || null;
      // Deliberately NOT thread-filtered: a participant id from another thread IS returned here, so
      // the resolver's own thread-ownership check is what must reject it.
      if (table === 'message_participants') return participants.find((p) => p.id === filter.id) || null;
      return null;
    },
    async deleteById(table, id) { deleted.push([table, id]); return null; },
    async updateById() { return null; },
  };
  const services = {
    repository,
    threadService: {
      async recordMessage(_thread, input) {
        const msg = { id: `msg-${recorded.length + 1}`, provider: null, ...input };
        recorded.push(msg);
        return msg;
      },
    },
    notificationService: {
      async queueExistingMessage(input) { queued.push(input); return { notification: { id: queued.length, status: 'queued' } }; },
    },
    conversationService: { async recordAnalytics() {} },
  };
  const run = () => recordAdminThreadReply({
    services,
    thread,
    actor: { id: 'admin-1' },
    body: { message: 'hello', channel, client_message_id: 'cmid-1', ...body },
  });
  return { run, queued, recorded, deleted };
}

// ── 1 + 2 + 3. The certification case: seller is primary, buyer owns the binding ───────────────
test('addresses the BUYER when the primary user (seller) has no WhatsApp binding', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    bindings: [bind('p-buyer', 'whatsapp', 'id-wa-buyer')],
    identities: [WA_BUYER],
  });
  const { notification } = await run();

  assert.ok(notification, 'a notification must be queued — this used to 422');
  assert.equal(queued.length, 1);
  const q = queued[0];
  // (2) the queued row carries the BUYER, never the thread's primary user.
  assert.equal(q.recipientUserId, 'user-buyer', 'recipient_user_id must be the addressed participant');
  assert.notEqual(q.recipientUserId, 'user-seller', 'must never be copied from thread.primary_user_id');
  assert.equal(q.recipientIdentityId, 'id-wa-buyer');
  assert.equal(q.provider, 'meta_whatsapp_cloud_api');
  // (3) a provider address is present, so the worker cannot dead-letter as recipient_missing.
  assert.equal(q.payload.phone_number, '263771234567');
  assert.equal(q.payload.external_identity_id, 'id-wa-buyer');
});

// ── 4. Compatibility: primary user IS deliverable ─────────────────────────────────────────────
test('when the primary user has a valid binding, existing behaviour is preserved', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    // Both are bound; the buyer's is far more recent, so a naive "most recent wins" would divert.
    bindings: [
      bind('p-buyer', 'whatsapp', 'id-wa-buyer', { last_used_at: '2026-08-14T00:00:00Z' }),
      bind('p-seller', 'whatsapp', 'id-wa-seller', { last_used_at: '2020-01-01T00:00:00Z' }),
    ],
    identities: [WA_BUYER, WA_SELLER],
  });
  await run();
  assert.equal(queued[0].recipientUserId, 'user-seller');
  assert.equal(queued[0].recipientIdentityId, 'id-wa-seller');
  assert.ok(!JSON.stringify(queued[0]).includes('263771234567'), "the other participant's address must not appear");
});

// ── 5. Ambiguity fails closed ─────────────────────────────────────────────────────────────────
test('two eligible participants and no explicit target -> recipient_ambiguous, nothing written', async () => {
  const { run, queued, recorded, deleted } = harness({
    participants: [SELLER, BUYER, BUYER_2],
    bindings: [
      bind('p-buyer', 'whatsapp', 'id-wa-buyer', { last_used_at: '2026-08-14T00:00:00Z' }),
      bind('p-buyer-2', 'whatsapp', 'id-wa-buyer-2', { last_used_at: '2026-08-13T00:00:00Z' }),
    ],
    identities: [WA_BUYER, WA_BUYER_2],
  });
  await assert.rejects(run, (e) => e.statusCode === 422 && e.code === 'recipient_ambiguous');
  assert.equal(queued.length, 0, 'zero notification');
  // The message is rolled back, so an ambiguous reply leaves no half-written conversation.
  assert.equal(recorded.length, 1);
  assert.deepEqual(deleted, [['messages', 'msg-1']], 'the recorded message must be rolled back');
});

// ── 6. Explicit participant among two ─────────────────────────────────────────────────────────
test('an explicit recipient_participant_id selects exactly that participant', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER, BUYER_2],
    bindings: [
      bind('p-buyer', 'whatsapp', 'id-wa-buyer'),
      bind('p-buyer-2', 'whatsapp', 'id-wa-buyer-2'),
    ],
    identities: [WA_BUYER, WA_BUYER_2],
    body: { recipient_participant_id: 'p-buyer-2' },
  });
  await run();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].recipientUserId, 'user-buyer-2');
  assert.equal(queued[0].recipientIdentityId, 'id-wa-buyer-2');
  assert.ok(!JSON.stringify(queued[0]).includes('263771234567'), 'the non-selected participant must not be addressed');
});

// ── 7. Explicit participant from another thread ───────────────────────────────────────────────
test('an explicit participant belonging to a different thread fails closed', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER, FOREIGN],
    bindings: [
      bind('p-buyer', 'whatsapp', 'id-wa-buyer'),
      // Deliberately reachable: this binding row is filed under THIS thread while naming the
      // foreign participant. If the binding were filed under thread-other it would be filtered out
      // by the thread-scoped lookup and the test would pass without the ownership check ever
      // running — i.e. it would not be load-bearing. Here the participant's thread_id check is the
      // only thing standing between a cross-thread participant id and a real delivery.
      bind('p-foreign', 'whatsapp', 'id-wa-foreign'),
    ],
    identities: [WA_BUYER, WA_FOREIGN],
    body: { recipient_participant_id: 'p-foreign' },
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0, 'cross-thread targeting must never deliver');
});

// ── 8. Participant / identity ownership mismatch ──────────────────────────────────────────────
test('a participant whose binding names another user\'s identity fails closed', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    // The buyer's binding points at buyer-2's identity.
    bindings: [bind('p-buyer', 'whatsapp', 'id-wa-buyer-2')],
    identities: [WA_BUYER_2],
    body: { recipient_participant_id: 'p-buyer' },
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0, 'ownership is re-checked on the identity, not trusted from the binding');
});

// ── 9. Wrong channel ──────────────────────────────────────────────────────────────────────────
test('a WhatsApp reply never goes out over a participant\'s telegram binding', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    bindings: [bind('p-buyer', 'telegram', 'id-tg-buyer')],
    identities: [{ id: 'id-tg-buyer', user_id: 'user-buyer', channel: 'telegram', provider: 'telegram_bot_api', external_id: '999', normalized_address: '999' }],
    channel: 'whatsapp',
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

// ── 10. Two equally-ranked distinct addresses inside ONE participant ──────────────────────────
test('one participant offering two equally-ranked distinct addresses fails closed', async () => {
  const second = { ...WA_BUYER, id: 'id-wa-buyer-alt', external_id: '263771111111', normalized_address: '263771111111' };
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    bindings: [
      bind('p-buyer', 'whatsapp', 'id-wa-buyer', { last_used_at: '2026-08-14T00:00:00Z' }),
      bind('p-buyer', 'whatsapp', 'id-wa-buyer-alt', { last_used_at: '2026-08-14T00:00:00Z' }),
    ],
    identities: [WA_BUYER, second],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

// ── 11. Replay ────────────────────────────────────────────────────────────────────────────────
test('replaying the same client_message_id yields no second message and no second send', async () => {
  const { run, queued, recorded } = harness({
    participants: [SELLER, BUYER],
    bindings: [bind('p-buyer', 'whatsapp', 'id-wa-buyer')],
    identities: [WA_BUYER],
    existingMessages: [{ id: 'msg-existing', thread_id: 'thread-mkt', client_message_id: 'cmid-1' }],
  });
  const result = await run();
  assert.equal(result.duplicate, true);
  assert.equal(result.message.id, 'msg-existing');
  assert.equal(queued.length, 0, 'no second notification may be queued');
  assert.equal(recorded.length, 0, 'no second message may be recorded');
});

// ── Extra guards ──────────────────────────────────────────────────────────────────────────────
test('system/agent placeholder participants are never addressed', async () => {
  const { run, queued } = harness({
    participants: [SELLER, SYSTEM_PLACEHOLDER],
    bindings: [bind('p-sys', 'whatsapp', 'id-wa-buyer')],
    identities: [WA_BUYER],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

test('an opted-out identity is never used as a delivery target', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    bindings: [bind('p-buyer', 'whatsapp', 'id-wa-buyer')],
    identities: [{ ...WA_BUYER, consent_status: 'opted_out' }],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

test('an expired binding is not deliverable', async () => {
  const { run, queued } = harness({
    participants: [SELLER, BUYER],
    bindings: [bind('p-buyer', 'whatsapp', 'id-wa-buyer', { expires_at: '2020-01-01T00:00:00Z' })],
    identities: [WA_BUYER],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

test('a departed participant is not deliverable', async () => {
  const { run, queued } = harness({
    participants: [SELLER, { ...BUYER, left_at: '2026-08-01T00:00:00Z' }],
    bindings: [bind('p-buyer', 'whatsapp', 'id-wa-buyer')],
    identities: [WA_BUYER],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});
