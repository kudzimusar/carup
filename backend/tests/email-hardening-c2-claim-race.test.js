import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationPreferenceService } from '../services/communication/communicationPreferenceService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { EmailReplyTokenService, REPLY_TOKEN_SECRET_ENV } from '../services/communication/emailReplyTokenService.js';

/**
 * C2-RACE — a conversational notification must never be claimable before its G5 routing context
 * exists.
 *
 * NOT the original Codex C2, which claimed the canonical subclass DISCARDS `input.metadata`. That is
 * refuted: it merges it. The real defect was the ORDER in which it did so.
 *
 *   super.queueExistingMessage()  ->  INSERT commits, row is immediately claimable
 *   this.repository.updateById()  ->  routing metadata patched in a SECOND HTTP request
 *
 * `CommunicationRepository` is a thin PostgREST wrapper with no transactions, so the gap is a full
 * network round trip. The delivery worker runs in a DIFFERENT PROCESS — pg_cron calls
 * POST /api/internal/communications/process every minute, and that job is active in staging — so no
 * event-loop ordering protects it. A claim landing in the gap finds no `recipient_participant_id`,
 * and the worker DURABLY dead-letters `conversation_reply_context_missing`. The Email is never sent
 * and is never retried.
 *
 * The fix removes the window rather than timing around it: the metadata is composed before the row
 * exists and the single INSERT carries it. These tests claim at the most hostile possible instant —
 * synchronously inside the insert, before the producer has even returned — and prove the row is
 * already complete. Nothing here depends on cron cadence, latency, or sleep.
 */

const SECRET = 'c2-race-derivation-secret';
const ENV = {
  [REPLY_TOKEN_SECRET_ENV]: SECRET,
  RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_INBOUND_DOMAIN: 'mail.carup.dev',
};

const THREAD_ID = 'c2-thread-1';
const BUYER_PARTICIPANT = 'c2-participant-buyer';
const SELLER_PARTICIPANT = 'c2-participant-seller';
const BUYER_IDENTITY = 'c2-identity-buyer';
const BINDING_ID = 'c2-binding-buyer';

function supabaseOver(repository) {
  const table = (name) => {
    const filters = [];
    let patch = null;
    let rows = () => repository.rows(name);
    const api = {
      select: () => api,
      insert: (values) => { const list = Array.isArray(values) ? values : [values]; patch = null; rows = () => list; api._insert = list; return api; },
      update: (p) => { patch = p; return api; },
      eq: (c, v) => { filters.push((r) => String(r[c] ?? '') === String(v ?? '')); return api; },
      is: (c, v) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return api; },
      gt: (c, v) => { filters.push((r) => new Date(r[c]) > new Date(v)); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: repository.rows(name).filter((r) => filters.every((f) => f(r)))[0] || null, error: null }),
      single: async () => {
        if (api._insert) { const saved = await repository.insert(name, api._insert[0]); return { data: saved, error: null }; }
        return { data: repository.rows(name).filter((r) => filters.every((f) => f(r)))[0] || null, error: null };
      },
      then: (res, rej) => {
        const matched = repository.rows(name).filter((r) => filters.every((f) => f(r)));
        if (patch) matched.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: patch ? null : matched, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { from: table };
}

function buildWorld() {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: THREAD_ID, thread_key: 'c2-thread', thread_type: 'marketplace_inquiry',
      business_workflow: 'marketplace', status: 'open', primary_channel: 'email',
      priority: 'normal', tenant_id: 'platform', metadata: {},
    }],
    message_participants: [
      { id: BUYER_PARTICIPANT, thread_id: THREAD_ID, user_id: 'buyer-1', role: 'requester', participant_type: 'customer', left_at: null, external_identity_id: BUYER_IDENTITY },
      { id: SELLER_PARTICIPANT, thread_id: THREAD_ID, user_id: 'seller-1', role: 'responder', participant_type: 'agent', left_at: null },
    ],
    channel_identities: [{
      id: BUYER_IDENTITY, channel: 'email', provider: 'resend', user_id: 'buyer-1',
      normalized_address: 'buyer@example.test', external_id: 'buyer@example.test',
      consent_status: 'granted', verified: true,
    }],
    conversation_channel_bindings: [{
      id: BINDING_ID, thread_id: THREAD_ID, participant_id: BUYER_PARTICIPANT, channel: 'email',
      channel_identity_id: BUYER_IDENTITY, provider: 'resend', is_primary: true,
      can_send: true, can_receive: true, transactional_consent: true, expires_at: null,
    }],
    communication_preferences: [{ id: 'pref-1', user_id: 'buyer-1', tenant_id: null, transactional_enabled: true, email_enabled: true, in_app_enabled: true }],
    users: [{ id: 'buyer-1', name: 'Buyer One', email: 'buyer@example.test' }],
    email_reply_tokens: [],
  });

  const threadService = new CommunicationThreadService({ repository });
  const preferenceService = new CommunicationPreferenceService({ repository });
  const notificationService = new CommunicationProductNotificationService({
    repository, threadService, preferenceService,
    templateService: { render: async () => ({ subject: 'CarUp conversation', body: 'B', templateKey: 'admin_reply_v1', data: {} }) },
  });

  const captured = [];
  const fetchImpl = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    const rfc = `<out-${captured.length}@mail.carup.dev>`;
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `resend-${captured.length}`, message_id: rfc }), headers: new Map([['message-id', rfc]]) };
  };
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: { get: (channel) => (channel === 'email' ? new EmailTransportRouter({ env: ENV, fetchImpl }) : null) },
    notificationService,
    replyTokenService: new EmailReplyTokenService({ supabase: supabaseOver(repository), env: ENV }),
  });

  return { repository, notificationService, worker, captured };
}

/** Queue an outbound conversational Email exactly as the canonical conversation service does. */
async function queueConversational(world) {
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform',
    direction: 'outbound', channel: 'email', status: 'queued',
    sender_participant_id: SELLER_PARTICIPANT, content_text: 'Is it still available?', content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  return world.notificationService.queueExistingMessage({
    message,
    thread,
    recipientUserId: 'buyer-1',
    recipientIdentityId: BUYER_IDENTITY,
    channel: 'email',
    provider: 'resend',
    notificationType: 'conversation_message',
    title: 'CarUp conversation',
    transactional: true,
    classification: 'conversational',
    dedupeParts: ['conversation-message', message.id, BUYER_PARTICIPANT, 'email'],
    // Exactly what CommunicationCanonicalConversationService passes.
    metadata: {
      recipient_participant_id: BUYER_PARTICIPANT,
      recipient_binding_id: BINDING_ID,
      recipient_binding_channel: 'email',
    },
  });
}

test('RACE-1 the row is COMPLETE the instant it exists — a claim cannot observe a partial row', async () => {
  const world = buildWorld();
  const observed = [];
  const original = world.repository.insert.bind(world.repository);
  world.repository.insert = async (table, row) => {
    const saved = await original(table, row);
    if (table === 'notification_queue') {
      // The most hostile instant available: the row has committed and the producer has not returned.
      // Under the old ordering the metadata patch had not been sent yet and this snapshot was blind.
      observed.push(JSON.parse(JSON.stringify(await world.repository.findOne('notification_queue', { id: saved.id }))));
    }
    return saved;
  };

  await queueConversational(world);

  assert.equal(observed.length, 1);
  const atInsert = observed[0];
  assert.equal(atInsert.metadata.recipient_participant_id, BUYER_PARTICIPANT,
    'the participant id must be present at INSERT, not patched in afterwards');
  assert.equal(atInsert.metadata.recipient_binding_id, BINDING_ID);
  assert.equal(atInsert.metadata.recipient_binding_channel, 'email');
  assert.equal(atInsert.payload.classification, 'conversational');
});

test('RACE-2 a worker claiming DURING the insert delivers instead of dead-lettering', async () => {
  const world = buildWorld();
  let claimResults = null;
  const original = world.repository.insert.bind(world.repository);
  world.repository.insert = async (table, row) => {
    const saved = await original(table, row);
    if (table === 'notification_queue' && !claimResults) {
      // pg_cron wakes here. This is the exact interleaving that produced a permanent dead-letter.
      claimResults = await world.worker.processDueNotifications({ limit: 5 });
    }
    return saved;
  };

  await queueConversational(world);

  assert.ok(claimResults, 'the worker must actually have claimed the row');
  assert.equal(claimResults.length, 1, 'the row WAS claimable — this is not passing by being invisible');
  assert.equal(claimResults[0].status, 'sent', `expected a send, got ${claimResults[0].status} / ${claimResults[0].errorCode || ''}`);

  const row = world.repository.rows('notification_queue')[0];
  assert.equal(row.status, 'sent');
  assert.equal(row.dead_lettered_at ?? null, null);
  assert.notEqual(row.last_error_code, 'conversation_reply_context_missing');
});

test('RACE-3 the delivered Email really does carry an authenticated G5 Reply-To', async () => {
  const world = buildWorld();
  const original = world.repository.insert.bind(world.repository);
  let claimed = null;
  world.repository.insert = async (table, row) => {
    const saved = await original(table, row);
    if (table === 'notification_queue' && !claimed) claimed = await world.worker.processDueNotifications({ limit: 5 });
    return saved;
  };

  await queueConversational(world);

  assert.equal(world.captured.length, 1, 'exactly one provider send');
  const replyTo = world.captured[0].body.reply_to || world.captured[0].body.replyTo;
  const address = Array.isArray(replyTo) ? replyTo[0] : replyTo;
  assert.ok(address, 'a conversational Email must carry a Reply-To');
  assert.match(address, /^conversation\+[A-Za-z0-9_-]{22}@mail\.carup\.dev$/,
    'the Reply-To must be a derived v2 reply credential, not the bare sender');
  // The credential is stored only as a hash — the raw token never lands in the row.
  const stored = world.repository.rows('email_reply_tokens');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash?.length, 64);
  assert.equal(JSON.stringify(world.repository.rows('notification_queue')).includes(address.split('+')[1].split('@')[0]), false,
    'the raw token must never be persisted on the notification row');
});

test('RACE-4 a normal (unraced) enqueue still delivers, and routing metadata is intact', async () => {
  const world = buildWorld();
  const queued = await queueConversational(world);
  const row = await world.repository.findOne('notification_queue', { id: queued.notification.id });
  // The routing fields the old post-insert patch used to add must still be present.
  assert.deepEqual(row.metadata.attempted_channels, ['email']);
  assert.equal(row.metadata.routing_mode, 'single_route');
  assert.deepEqual(row.metadata.fallback_channels, []);

  const results = await world.worker.processDueNotifications({ limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'sent');
});

test('RACE-5 fallback channels still compose correctly through the single insert', async () => {
  const world = buildWorld();
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform', direction: 'outbound',
    channel: 'email', status: 'queued', sender_participant_id: SELLER_PARTICIPANT, content_text: 'x', content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  const queued = await world.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'buyer-1', recipientIdentityId: BUYER_IDENTITY,
    channel: 'email', provider: 'resend', notificationType: 'conversation_message',
    title: 'CarUp conversation', transactional: true, classification: 'conversational',
    fallbackChannels: ['in_app'],
    dedupeParts: ['conversation-message', message.id, BUYER_PARTICIPANT, 'email'],
    metadata: { recipient_participant_id: BUYER_PARTICIPANT, recipient_binding_id: BINDING_ID, recipient_binding_channel: 'email' },
  });
  const row = await world.repository.findOne('notification_queue', { id: queued.notification.id });
  assert.deepEqual(row.metadata.fallback_channels, ['in_app']);
  assert.equal(row.metadata.routing_mode, 'single_primary_with_ordered_fallback');
  assert.equal(row.metadata.recipient_participant_id, BUYER_PARTICIPANT);
});

test('RACE-6 the worker still DURABLY dead-letters when context is genuinely absent', async () => {
  // The fix must not weaken the guard. A conversational Email with no resolvable participant is
  // still a durable failure — guessing one would defeat the credential entirely.
  const world = buildWorld();
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform', direction: 'outbound',
    channel: 'email', status: 'queued', sender_participant_id: SELLER_PARTICIPANT, content_text: 'x', content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  const queued = await world.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'buyer-1', recipientIdentityId: BUYER_IDENTITY,
    channel: 'email', provider: 'resend', notificationType: 'conversation_message',
    title: 'CarUp conversation', transactional: true, classification: 'conversational',
    dedupeParts: ['conversation-message', message.id, 'no-participant', 'email'],
    metadata: {},
  });
  const result = await world.worker.deliverNotification(
    await world.repository.findOne('notification_queue', { id: queued.notification.id }),
  );
  assert.equal(result.status, 'dead_letter');
  const row = await world.repository.findOne('notification_queue', { id: queued.notification.id });
  assert.equal(row.last_error_code, 'conversation_reply_context_missing');
  assert.ok(row.dead_lettered_at, 'the dead-letter must stay durable');
  assert.equal(world.captured.length, 0, 'and nothing may be sent');
});
