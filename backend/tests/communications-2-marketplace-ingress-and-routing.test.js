import { test } from 'node:test';
import assert from 'node:assert';

import { CommunicationConversationService } from '../services/communication/communicationConversationService.js';

/**
 * Three release-review findings on the Marketplace canonicalization path, pinned together because
 * they share one story: the canonical conversation was created correctly and then the things that
 * depend on it were not.
 *
 *  1. A provider callback arrives in PLATFORM tenant context. Channel identities are tenant-scoped,
 *     so the webhook mints a SECOND identity for a number a seller-tenant conversation already owns,
 *     and inbound routing — which searches bindings by identity id — finds nothing and opens a
 *     shadow conversation for a customer who is already in one.
 *  2. The orchestrator returns straight from canonicalization and never reaches queueFromDomainEvent,
 *     so the seller was never notified that an inquiry had arrived.
 *  3. The canonical message is deduped by client_message_id but the funnel analytics were not, so a
 *     replayed domain event double-counted conversation_started and inquiry_created.
 */

function makeRepository(seed = {}) {
  const tables = {
    channel_identities: [], conversation_channel_bindings: [], message_threads: [],
    message_participants: [], messages: [], conversation_events: [], marketplace_inquiries: [],
    ...seed,
  };
  let seq = 0;
  return {
    tables,
    async list(table, filter = {}) {
      return (tables[table] || []).filter((row) => Object.entries(filter)
        .every(([k, v]) => v === undefined || String(row[k]) === String(v)));
    },
    async findOne(table, filter = {}) {
      return (await this.list(table, filter))[0] || null;
    },
    async insert(table, row) {
      const saved = { id: row.id || `${table}-${++seq}`, created_at: row.created_at || new Date().toISOString(), ...row };
      (tables[table] ||= []).push(saved);
      return saved;
    },
    async updateById(table, id, patch) {
      const row = (tables[table] || []).find((r) => String(r.id) === String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

// ── 1. tenant-scoped provider ingress ─────────────────────────────────────────────────────────
const ADDRESS = '818081201356';

function ingressFixture({ address = ADDRESS, extraThread = false, expiredBinding = false } = {}) {
  const repository = makeRepository();
  // The Marketplace conversation, owned under the SELLER's tenant.
  repository.tables.message_threads.push({ id: 'thread-mkt', tenant_id: 'tenant-seller', status: 'open' });
  repository.tables.message_participants.push({ id: 'p-buyer', thread_id: 'thread-mkt', user_id: 'buyer-1', permissions: { read: true, send: true } });
  repository.tables.channel_identities.push({
    id: 'id-tenant', tenant_id: 'tenant-seller', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
    external_id: address, normalized_address: address, consent_status: 'implied_transactional',
  });
  repository.tables.conversation_channel_bindings.push({
    id: 'bind-tenant', thread_id: 'thread-mkt', participant_id: 'p-buyer', channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api', channel_identity_id: 'id-tenant',
    can_send: true, can_receive: true, last_used_at: '2026-08-12T00:00:00Z',
    ...(expiredBinding ? { expires_at: '2020-01-01T00:00:00Z' } : {}),
  });

  if (extraThread) {
    repository.tables.message_threads.push({ id: 'thread-other', tenant_id: 'tenant-other', status: 'open' });
    repository.tables.message_participants.push({ id: 'p-other', thread_id: 'thread-other', user_id: 'buyer-2', permissions: { read: true } });
    repository.tables.channel_identities.push({
      id: 'id-other', tenant_id: 'tenant-other', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
      external_id: address, normalized_address: address, consent_status: 'implied_transactional',
    });
    repository.tables.conversation_channel_bindings.push({
      id: 'bind-other', thread_id: 'thread-other', participant_id: 'p-other', channel: 'whatsapp',
      provider: 'meta_whatsapp_cloud_api', channel_identity_id: 'id-other',
      can_send: true, can_receive: true, last_used_at: '2026-08-13T00:00:00Z',
    });
  }

  // The identity a public webhook creates: same number, platform context, no bindings.
  const webhookIdentity = {
    id: 'id-platform', tenant_id: null, channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
    external_id: address, normalized_address: address, consent_status: 'unknown',
  };
  repository.tables.channel_identities.push(webhookIdentity);

  const service = new CommunicationConversationService({ repository, threadService: {}, identityService: {}, notificationService: {} });
  return { service, repository, webhookIdentity };
}

test('a platform webhook resolves to the seller-tenant Marketplace conversation, not a shadow thread', async () => {
  const { service, webhookIdentity } = ingressFixture();
  const resolved = await service.resolveInboundConversation({
    identity: webhookIdentity, channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  });

  assert.ok(resolved, 'the inbound message must find the existing conversation');
  assert.equal(resolved.thread.id, 'thread-mkt');
  assert.equal(resolved.participant.id, 'p-buyer');
  assert.equal(resolved.resolution, 'provider_ingress_address_binding');
  assert.equal(resolved.matched_identity_id, 'id-tenant');
  // Routing only. Tenant ownership is untouched.
  assert.equal(resolved.thread.tenant_id, 'tenant-seller');
  assert.equal(webhookIdentity.tenant_id, null, 'the webhook identity must not be re-tenanted');
});

test('a different number never matches', async () => {
  const { service, webhookIdentity } = ingressFixture();
  const resolved = await service.resolveInboundConversation({
    identity: { ...webhookIdentity, normalized_address: '263771999888' },
    channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  });
  assert.equal(resolved, null);
});

test('two conversations for the same number fail CLOSED rather than guessing by recency', async () => {
  const { service, webhookIdentity } = ingressFixture({ extraThread: true });
  const resolved = await service.resolveInboundConversation({
    identity: webhookIdentity, channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  });
  assert.equal(resolved, null, 'one customer\'s message must never land in another customer\'s thread');
});

test('a different channel or provider never cross-matches', async () => {
  const { service, webhookIdentity } = ingressFixture();
  assert.equal(await service.resolveInboundConversation({
    identity: { ...webhookIdentity, channel: 'telegram' }, channel: 'telegram', provider: 'telegram_bot_api',
  }), null);
  assert.equal(await service.resolveInboundConversation({
    identity: webhookIdentity, channel: 'whatsapp', provider: 'some_other_provider',
  }), null);
});

test('an expired or receive-disabled binding is not a route', async () => {
  const { service, webhookIdentity } = ingressFixture({ expiredBinding: true });
  assert.equal(await service.resolveInboundConversation({
    identity: webhookIdentity, channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  }), null);
});

test('an opted-out sibling identity is never used as a route', async () => {
  const { service, repository, webhookIdentity } = ingressFixture();
  repository.tables.channel_identities.find((i) => i.id === 'id-tenant').consent_status = 'opted_out';
  assert.equal(await service.resolveInboundConversation({
    identity: webhookIdentity, channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  }), null);
});

test('the identity’s own binding still wins without consulting siblings', async () => {
  const { service, repository } = ingressFixture();
  repository.tables.conversation_channel_bindings.push({
    id: 'bind-direct', thread_id: 'thread-mkt', participant_id: 'p-buyer', channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api', channel_identity_id: 'id-platform',
    can_send: true, can_receive: true, last_used_at: '2026-08-13T12:00:00Z',
  });
  const resolved = await service.resolveInboundConversation({
    identity: repository.tables.channel_identities.find((i) => i.id === 'id-platform'),
    channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
  });
  assert.equal(resolved.binding.id, 'bind-direct');
  assert.equal(resolved.resolution, undefined, 'the direct path is unchanged');
});

// ── 2 & 3. seller notification + analytics idempotency ────────────────────────────────────────
function canonicalizationFixture() {
  const repository = makeRepository({
    marketplace_inquiries: [{
      id: 'inq-1', seller_id: 'seller-1', buyer_id: 'buyer-1', seller_tenant_id: 'tenant-seller',
      listing_id: 'listing-1', message: 'Is this car still available?', source_channel: 'web', metadata: {},
    }],
  });
  const queued = [];
  const thread = { id: 'thread-mkt', tenant_id: 'tenant-seller', status: 'open', metadata: {} };
  repository.tables.message_threads.push(thread);

  const service = new CommunicationConversationService({
    repository,
    threadService: {
      async resolveOrCreateThread() { return { thread }; },
      async recordMessage(_thread, input) { return repository.insert('messages', { thread_id: thread.id, ...input }); },
    },
    identityService: { async resolveOrCreateIdentity(input) { return repository.insert('channel_identities', input); } },
    notificationService: {
      async queueExistingMessage(input) {
        // Real dedupe semantics: the same dedupe key must not create a second notification.
        const key = (input.dedupeParts || []).join(':');
        const existing = queued.find((q) => q.key === key);
        if (existing) return { notification: existing.notification };
        const notification = { id: queued.length + 1, status: 'queued' };
        queued.push({ key, input, notification });
        return { notification };
      },
    },
  });
  return { service, repository, queued };
}

test('the seller is notified exactly once, and the buyer never receives their own inquiry', async () => {
  const { service, queued } = canonicalizationFixture();
  await service.canonicalizeMarketplaceInquiry({ payload: { inquiryId: 'inq-1' } });

  const sellerNotifications = queued.filter((q) => q.input.recipientUserId === 'seller-1');
  const buyerNotifications = queued.filter((q) => q.input.recipientUserId === 'buyer-1');
  assert.equal(sellerNotifications.length, 1, 'the seller must be told an inquiry arrived');
  assert.equal(buyerNotifications.length, 0, 'the buyer authored it — no self-echo');
  assert.equal(sellerNotifications[0].input.channel, 'in_app');
  assert.equal(sellerNotifications[0].input.notificationType, 'conversation_message');
});

test('replaying the same inquiry adds no second message, notification or funnel event', async () => {
  const { service, repository, queued } = canonicalizationFixture();
  await service.canonicalizeMarketplaceInquiry({ payload: { inquiryId: 'inq-1' } });

  const afterFirst = {
    messages: repository.tables.messages.length,
    seller: queued.filter((q) => q.input.recipientUserId === 'seller-1').length,
    started: repository.tables.conversation_events.filter((e) => e.event_type === 'conversation_started').length,
    created: repository.tables.conversation_events.filter((e) => e.event_type === 'inquiry_created').length,
  };
  assert.deepEqual(afterFirst, { messages: 1, seller: 1, started: 1, created: 1 });

  await service.canonicalizeMarketplaceInquiry({ payload: { inquiryId: 'inq-1' } });

  assert.equal(repository.tables.messages.length, 1, 'exactly one canonical Marketplace message');
  assert.equal(queued.filter((q) => q.input.recipientUserId === 'seller-1').length, 1, 'no duplicate seller notification');
  assert.equal(repository.tables.conversation_events.filter((e) => e.event_type === 'conversation_started').length, 1);
  assert.equal(repository.tables.conversation_events.filter((e) => e.event_type === 'inquiry_created').length, 1);
});

test('the seller notification references the canonical message and thread', async () => {
  const { service, repository, queued } = canonicalizationFixture();
  await service.canonicalizeMarketplaceInquiry({ payload: { inquiryId: 'inq-1' } });
  const [message] = repository.tables.messages;
  const seller = queued.find((q) => q.input.recipientUserId === 'seller-1');
  assert.equal(seller.input.message.id, message.id);
  assert.equal(seller.input.thread.id, 'thread-mkt');
  assert.equal(message.client_message_id, 'marketplace-inquiry:inq-1');
});

test('a failed analytics write never breaks the authoritative conversation path', async () => {
  const { service, repository, queued } = canonicalizationFixture();
  repository.insert = async (table, row) => {
    if (table === 'conversation_events') throw new Error('analytics table missing');
    return makeRepository.prototype; // unreachable
  };
  // Re-wire a working insert for every other table.
  const original = makeRepository();
  repository.insert = async (table, row) => {
    if (table === 'conversation_events') throw new Error('analytics table missing');
    const saved = { id: `${table}-x${repository.tables[table]?.length ?? 0}`, created_at: new Date().toISOString(), ...row };
    (repository.tables[table] ||= []).push(saved);
    return saved;
  };
  void original;

  const result = await service.canonicalizeMarketplaceInquiry({ payload: { inquiryId: 'inq-1' } });
  assert.ok(result[0].thread, 'the conversation still resolves');
  assert.ok(result[0].message, 'the canonical message is still recorded');
  assert.equal(queued.filter((q) => q.input.recipientUserId === 'seller-1').length, 1, 'the seller is still notified');
});
