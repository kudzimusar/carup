import { test } from 'node:test';
import assert from 'node:assert';

const { recordAdminThreadReply } = await import('../routes/adminCommunicationRoutes.js');

/**
 * An admin reply on an external channel must carry a provider ADDRESS, not just a user id.
 *
 * Found in live staging: every admin reply to a WhatsApp thread with a primary user queued a
 * notification with recipient_identity_id null and no phone number, and the worker dead-lettered it
 * as `recipient_missing` before Meta was ever contacted. The adjacent no-primary-user branch had
 * always resolved an identity, so the capability existed one branch away.
 *
 * The dangerous part is not the missing address — it is how a careless fix would find one. On a
 * multi-party thread the thread-wide "find the external contact" helper can return a DIFFERENT
 * participant's identity, which would deliver one customer's reply to another. These tests pin the
 * resolution to the exact recipient at every hop.
 */

const THREAD = { id: 'thread-1', primary_user_id: 'user-primary', primary_channel: 'whatsapp', priority: 'normal', tenant_id: null };

function harness({ participants, bindings, identities, channel = 'whatsapp', thread = THREAD } = {}) {
  const queued = [];
  const repository = {
    async list(table, filter = {}) {
      if (table === 'message_participants') return participants.filter((p) => p.thread_id === filter.thread_id);
      if (table === 'conversation_channel_bindings') return bindings.filter((b) => b.thread_id === filter.thread_id);
      if (table === 'messages') return [];
      return [];
    },
    async findOne(table, filter = {}) {
      if (table === 'channel_identities') return identities.find((i) => i.id === filter.id) || null;
      return null;
    },
    // The fail-closed path rolls the message back before rethrowing, so the mock must offer these.
    // Without them `repository.deleteById?.(...).catch(...)` throws a TypeError that masks the 422.
    async deleteById() { return null; },
    async updateById() { return null; },
  };
  const services = {
    repository,
    threadService: {
      async recordMessage(_thread, input) { return { id: 'msg-1', provider: null, ...input }; },
    },
    notificationService: {
      async queueExistingMessage(input) { queued.push(input); return { notification: { id: queued.length, status: 'queued' } }; },
    },
    conversationService: { async recordAnalytics() {} },
  };
  const run = () => recordAdminThreadReply({
    services, thread, actor: { id: 'admin-1' },
    body: { message: 'hello', channel, client_message_id: 'cmid-1' },
  });
  return { run, queued };
}

const PRIMARY_PARTICIPANT = { id: 'p-primary', thread_id: 'thread-1', user_id: 'user-primary', is_active: true };
const OTHER_PARTICIPANT = { id: 'p-other', thread_id: 'thread-1', user_id: 'user-other', is_active: true };

const WA_PRIMARY = { id: 'id-wa-primary', user_id: 'user-primary', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '818081201356', normalized_address: '818081201356' };
const WA_OTHER = { id: 'id-wa-other', user_id: 'user-other', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '263771000111', normalized_address: '263771000111' };
const TG_PRIMARY = { id: 'id-tg-primary', user_id: 'user-primary', channel: 'telegram', provider: 'telegram_bot_api', external_id: '5551234', normalized_address: '5551234' };

const bind = (participantId, channel, identityId, extra = {}) => ({
  thread_id: 'thread-1', participant_id: participantId, channel, channel_identity_id: identityId, can_send: true, ...extra,
});

// ── 1. WhatsApp ───────────────────────────────────────────────────────────────────────────────
test('a WhatsApp admin reply carries the primary user id AND their WhatsApp address', async () => {
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [bind('p-primary', 'whatsapp', 'id-wa-primary')],
    identities: [WA_PRIMARY],
  });
  await run();

  assert.equal(queued.length, 1);
  const q = queued[0];
  assert.equal(q.recipientUserId, 'user-primary', 'user scope is kept for preferences/policy');
  assert.equal(q.recipientIdentityId, 'id-wa-primary', 'address scope is kept for provider delivery');
  assert.equal(q.channel, 'whatsapp');
  assert.equal(q.provider, 'meta_whatsapp_cloud_api');
  assert.equal(q.payload.phone_number, '818081201356');
  assert.equal(q.payload.external_identity_id, 'id-wa-primary');
  assert.equal(q.payload.admin_reply, true);
});

// ── 2. Telegram ───────────────────────────────────────────────────────────────────────────────
test('a Telegram admin reply carries the telegram address', async () => {
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [bind('p-primary', 'telegram', 'id-tg-primary')],
    identities: [TG_PRIMARY],
    channel: 'telegram',
  });
  await run();
  assert.equal(queued[0].recipientIdentityId, 'id-tg-primary');
  assert.equal(queued[0].provider, 'telegram_bot_api');
  assert.equal(queued[0].payload.telegram_chat_id, '5551234');
});

// ── 3. in_app unchanged ───────────────────────────────────────────────────────────────────────
test('in_app still queues on the user id alone, with no invented identity', async () => {
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [],
    identities: [],
    channel: 'in_app',
    thread: { ...THREAD, primary_channel: 'in_app' },
  });
  await run();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].recipientUserId, 'user-primary');
  assert.equal(queued[0].recipientIdentityId, undefined, 'in_app must not fabricate a channel identity');
  assert.equal(queued[0].payload.phone_number, undefined);
});

// ── 4. MULTI-PARTY SAFETY ─────────────────────────────────────────────────────────────────────
test('never addresses another participant — the reply goes to the primary user only', async () => {
  const { run, queued } = harness({
    participants: [OTHER_PARTICIPANT, PRIMARY_PARTICIPANT],
    // The other participant's binding is listed FIRST and is more recently used, so a
    // "find any external identity" or "most recent wins" rule would pick the wrong customer.
    bindings: [
      bind('p-other', 'whatsapp', 'id-wa-other', { last_used_at: '2026-08-13T00:00:00Z' }),
      bind('p-primary', 'whatsapp', 'id-wa-primary', { last_used_at: '2026-01-01T00:00:00Z' }),
    ],
    identities: [WA_OTHER, WA_PRIMARY],
  });
  await run();

  assert.equal(queued[0].recipientIdentityId, 'id-wa-primary');
  assert.equal(queued[0].payload.phone_number, '818081201356');
  assert.notEqual(queued[0].recipientIdentityId, 'id-wa-other');
  assert.ok(!JSON.stringify(queued[0]).includes('263771000111'), "another customer's address must never appear");
});

// ── 5. WRONG-CHANNEL SAFETY ───────────────────────────────────────────────────────────────────
test('a WhatsApp reply never silently goes out over Telegram', async () => {
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [bind('p-primary', 'telegram', 'id-tg-primary')],
    identities: [TG_PRIMARY],
    channel: 'whatsapp',
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0, 'no notification may be queued on the wrong channel');
});

// ── 6. MISSING IDENTITY ───────────────────────────────────────────────────────────────────────
test('an external channel with no send-capable identity fails closed with 422', async () => {
  for (const bindings of [
    [],
    [bind('p-primary', 'whatsapp', 'id-wa-primary', { can_send: false })],
    [bind('p-other', 'whatsapp', 'id-wa-other')],
  ]) {
    const { run, queued } = harness({
      participants: [PRIMARY_PARTICIPANT, OTHER_PARTICIPANT],
      bindings,
      identities: [WA_PRIMARY, WA_OTHER],
    });
    await assert.rejects(run, (e) => e.statusCode === 422 && /No deliverable communication recipient/.test(e.message));
    assert.equal(queued.length, 0, 'no orphan notification may be left behind');
  }
});

test('an inactive participant does not qualify as a recipient', async () => {
  const { run, queued } = harness({
    participants: [{ ...PRIMARY_PARTICIPANT, is_active: false }],
    bindings: [bind('p-primary', 'whatsapp', 'id-wa-primary')],
    identities: [WA_PRIMARY],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

// ── 7. identity ownership ─────────────────────────────────────────────────────────────────────
test('a binding pointing at an identity owned by someone else is refused', async () => {
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    // Corrupt/mismatched binding: the primary participant's binding names another user's identity.
    bindings: [bind('p-primary', 'whatsapp', 'id-wa-other')],
    identities: [WA_OTHER],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0, 'ownership is re-checked on the identity itself, not trusted from the binding');
});

// ── 8. ambiguity fails closed ─────────────────────────────────────────────────────────────────
test('two equally-ranked distinct addresses fail closed rather than picking one', async () => {
  const second = { ...WA_PRIMARY, id: 'id-wa-primary-2', external_id: '818099999999', normalized_address: '818099999999' };
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [
      bind('p-primary', 'whatsapp', 'id-wa-primary', { last_used_at: '2026-08-13T00:00:00Z' }),
      bind('p-primary', 'whatsapp', 'id-wa-primary-2', { last_used_at: '2026-08-13T00:00:00Z' }),
    ],
    identities: [WA_PRIMARY, second],
  });
  await assert.rejects(run, (e) => e.statusCode === 422);
  assert.equal(queued.length, 0);
});

test('an explicitly primary binding wins over a more recently used one', async () => {
  const second = { ...WA_PRIMARY, id: 'id-wa-primary-2', external_id: '818099999999', normalized_address: '818099999999' };
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [
      bind('p-primary', 'whatsapp', 'id-wa-primary-2', { last_used_at: '2026-08-13T00:00:00Z' }),
      bind('p-primary', 'whatsapp', 'id-wa-primary', { is_primary: true, last_used_at: '2026-01-01T00:00:00Z' }),
    ],
    identities: [WA_PRIMARY, second],
  });
  await run();
  assert.equal(queued[0].recipientIdentityId, 'id-wa-primary');
});

// ── 9. dedupe semantics unchanged ─────────────────────────────────────────────────────────────
test('the dedupe key still keys on the recipient user, not the address', async () => {
  const { run, queued } = harness({
    participants: [PRIMARY_PARTICIPANT],
    bindings: [bind('p-primary', 'whatsapp', 'id-wa-primary')],
    identities: [WA_PRIMARY],
  });
  await run();
  assert.deepEqual(queued[0].dedupeParts, ['admin_reply', 'thread-1', 'cmid-1', 'user-primary']);
});
