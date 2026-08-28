import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationPreferenceService } from '../services/communication/communicationPreferenceService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { EmailReplyTokenService, REPLY_TOKEN_SECRET_ENV, hashReplyToken } from '../services/communication/emailReplyTokenService.js';

/**
 * C4 FINAL — a conversational Email that promises an authenticated Reply-To must not be sent unless
 * the credential state that promise depends on is durably persisted.
 *
 * THE SUPERSEDED BEHAVIOUR. `issue()` reports `refreshPersisted`, and the worker consumed only
 * `issued.address`. So a reuse whose expiry refresh was rejected by the database still shipped: the
 * recipient was handed a reply window the store never accepted, answered inside the window they
 * were promised, and their reply was unroutable.
 *
 * THE CONTRACT NOW. Persistence failure withholds the send and RETRIES.
 *
 *   - No provider call. There is nothing to duplicate and nothing to un-send.
 *   - The live token is NOT revoked and no second credential is minted. It was selected by
 *     `.gt('expires_at', now)`, so it is still usable — only its extension is unconfirmed.
 *   - Not a dead-letter. A rejected write is weather; the next attempt re-runs the same reuse path.
 *   - If the credential genuinely expires before recovery, the ordinary G5 issuance rules take over
 *     on the next attempt and mint a fresh one. Nothing special is needed for that case.
 */

const SECRET = 'c4-final-derivation-secret';
const ENV = {
  [REPLY_TOKEN_SECRET_ENV]: SECRET,
  RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_INBOUND_DOMAIN: 'mail.carup.dev',
};

const THREAD_ID = 'c4-thread-1';
const BUYER_PARTICIPANT = 'c4-participant-buyer';
const SELLER_PARTICIPANT = 'c4-participant-seller';
const BUYER_IDENTITY = 'c4-identity-buyer';
const BINDING_ID = 'c4-binding-buyer';

/** PostgREST-shaped surface over the memory repository, with an injectable write fault. */
function supabaseOver(repository, ctl) {
  return {
    from: (name) => {
      const filters = [];
      let patch = null;
      let inserting = null;
      const api = {
        select: () => api,
        insert: (values) => { inserting = Array.isArray(values) ? values : [values]; return api; },
        update: (p) => { patch = p; return api; },
        eq: (c, v) => { filters.push((r) => String(r[c] ?? '') === String(v ?? '')); return api; },
        is: (c, v) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return api; },
        gt: (c, v) => { filters.push((r) => new Date(r[c]) > new Date(v)); return api; },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: repository.rows(name).filter((r) => filters.every((f) => f(r)))[0] || null, error: null }),
        single: async () => {
          if (inserting) return { data: await repository.insert(name, inserting[0]), error: null };
          return { data: repository.rows(name).filter((r) => filters.every((f) => f(r)))[0] || null, error: null };
        },
        then: (res, rej) => {
          if (patch) {
            if (name === 'email_reply_tokens' && ctl.failTokenWrites) {
              // Rejected the way PostgREST does: resolve with an error, mutate nothing.
              return Promise.resolve({ data: null, error: { code: '42501', message: 'simulated token-store write rejection' } }).then(res, rej);
            }
            repository.rows(name).filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          return Promise.resolve({ data: repository.rows(name).filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}

function buildWorld() {
  const ctl = { failTokenWrites: false };
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: THREAD_ID, thread_key: 'c4-thread', thread_type: 'marketplace_inquiry',
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
    replyTokenService: new EmailReplyTokenService({ supabase: supabaseOver(repository, ctl), env: ENV }),
  });

  return { ctl, repository, notificationService, worker, captured };
}

let seq = 0;
async function queueConversational(world) {
  seq += 1;
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform',
    direction: 'outbound', channel: 'email', status: 'queued',
    sender_participant_id: SELLER_PARTICIPANT, content_text: `message ${seq}`, content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  return world.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'buyer-1', recipientIdentityId: BUYER_IDENTITY,
    channel: 'email', provider: 'resend', notificationType: 'conversation_message',
    title: 'CarUp conversation', transactional: true, classification: 'conversational',
    dedupeParts: ['conversation-message', message.id, BUYER_PARTICIPANT, 'email'],
    metadata: { recipient_participant_id: BUYER_PARTICIPANT, recipient_binding_id: BINDING_ID, recipient_binding_channel: 'email' },
  });
}

const deliver = async (world, queued) => world.worker.deliverNotification(
  await world.repository.findOne('notification_queue', { id: queued.notification.id }),
);

/** Establish a live reusable token, so the SECOND send takes the reuse/refresh path. */
async function establishLiveToken(world) {
  const first = await queueConversational(world);
  const result = await deliver(world, first);
  assert.equal(result.status, 'sent', 'precondition: the first send must succeed');
  assert.equal(world.repository.rows('email_reply_tokens').length, 1);
  return first;
}

// ============================================================================
// A — refresh persistence failure withholds the send
// ============================================================================

test('C4-A a failed refresh means ZERO provider calls and a RETRYABLE notification', async () => {
  const world = buildWorld();
  await establishLiveToken(world);
  const callsAfterFirst = world.captured.length;

  world.ctl.failTokenWrites = true;
  const second = await queueConversational(world);
  const result = await deliver(world, second);

  assert.equal(world.captured.length, callsAfterFirst, 'the provider must not be called at all');
  assert.equal(result.status, 'retry_scheduled', `expected a retry, got ${result.status}`);

  const row = await world.repository.findOne('notification_queue', { id: second.notification.id });
  assert.equal(row.status, 'retry_scheduled');
  assert.equal(row.last_error_code, 'reply_token_refresh_unpersisted');
  assert.equal(row.dead_lettered_at ?? null, null, 'a rejected write is weather, not a permanent failure');
  assert.ok(row.next_attempt_at, 'the canonical retry mechanism must have scheduled it');
});

test('C4-A2 the still-live token is NOT revoked and NO second credential is minted', async () => {
  const world = buildWorld();
  await establishLiveToken(world);
  const tokenBefore = JSON.parse(JSON.stringify(world.repository.rows('email_reply_tokens')[0]));

  world.ctl.failTokenWrites = true;
  await deliver(world, await queueConversational(world));

  const tokens = world.repository.rows('email_reply_tokens');
  assert.equal(tokens.length, 1, 'no replacement credential');
  assert.equal(tokens[0].revoked_at ?? null, null, 'the delivered address must stay live');
  assert.equal(tokens[0].token_hash, tokenBefore.token_hash);
  assert.equal(tokens[0].expires_at, tokenBefore.expires_at, 'and the rejected write really did not land');
});

test('C4-A3 the raw token and Reply-To address appear nowhere in persisted state', async () => {
  const world = buildWorld();
  await establishLiveToken(world);
  world.ctl.failTokenWrites = true;
  const second = await queueConversational(world);
  await deliver(world, second);

  const row = await world.repository.findOne('notification_queue', { id: second.notification.id });
  const persisted = JSON.stringify({
    row,
    audits: world.repository.rows('communication_audit_events') || [],
    attempts: world.repository.rows('message_delivery_attempts') || [],
  });
  // Reconstruct the credential the way the server can, then prove it is absent.
  const tokenRow = world.repository.rows('email_reply_tokens')[0];
  const raw = crypto.createHmac('sha256', SECRET)
    .update(`carup-email-reply-token:v2:${tokenRow.id}`).digest().subarray(0, 16).toString('base64url');
  assert.equal(hashReplyToken(raw), tokenRow.token_hash, 'sanity: this really is the live credential');

  assert.equal(persisted.includes(raw), false, 'the raw token must never be persisted');
  assert.equal(persisted.includes(`conversation+${raw}@mail.carup.dev`), false, 'nor the Reply-To address');
  assert.equal(persisted.includes('simulated token-store write rejection'), false, 'nor raw provider error text');
  // The error message names the failed half only.
  assert.match(row.last_error_message, /did not persist/);
});

// ============================================================================
// B / C — recovery sends exactly once
// ============================================================================

test('C4-B a retry after the store recovers persists the refresh and sends EXACTLY once', async () => {
  const world = buildWorld();
  await establishLiveToken(world);
  const callsAfterFirst = world.captured.length;

  world.ctl.failTokenWrites = true;
  const second = await queueConversational(world);
  assert.equal((await deliver(world, second)).status, 'retry_scheduled');
  assert.equal(world.captured.length, callsAfterFirst);

  // The store recovers; the canonical retry re-runs the same reuse path.
  world.ctl.failTokenWrites = false;
  const retried = await deliver(world, second);

  assert.equal(retried.status, 'sent');
  assert.equal(world.captured.length, callsAfterFirst + 1, 'EXACTLY one provider call for this message');

  const row = await world.repository.findOne('notification_queue', { id: second.notification.id });
  assert.equal(row.status, 'sent');
  const replyTo = world.captured.at(-1).body.reply_to || world.captured.at(-1).body.replyTo;
  const address = Array.isArray(replyTo) ? replyTo[0] : replyTo;
  assert.match(address, /^conversation\+[A-Za-z0-9_-]{22}@mail\.carup\.dev$/, 'the Reply-To must work');
});

test('C4-C the withheld attempt produces NO duplicate Email — one message, one send', async () => {
  const world = buildWorld();
  await establishLiveToken(world);
  const callsAfterFirst = world.captured.length;

  world.ctl.failTokenWrites = true;
  const second = await queueConversational(world);
  await deliver(world, second);
  await deliver(world, second); // a second failed attempt must still send nothing
  assert.equal(world.captured.length, callsAfterFirst, 'still zero sends for this message');

  world.ctl.failTokenWrites = false;
  await deliver(world, second);
  assert.equal(world.captured.length, callsAfterFirst + 1, 'and exactly one after recovery');

  // The address is stable across the whole episode — the reuse contract is intact.
  const first = world.captured[0].body.reply_to || world.captured[0].body.replyTo;
  const last = world.captured.at(-1).body.reply_to || world.captured.at(-1).body.replyTo;
  assert.deepEqual(last, first, 'reuse must not have changed the credential the customer already has');
});

test('C4-D G4 reply_to_set provenance stays truthful', async () => {
  const world = buildWorld();
  await establishLiveToken(world);
  world.ctl.failTokenWrites = true;
  const second = await queueConversational(world);
  await deliver(world, second);

  // Nothing was sent, so nothing may claim a Reply-To was set.
  const withheld = await world.repository.findOne('notification_queue', { id: second.notification.id });
  assert.equal(JSON.stringify(withheld).includes('"reply_to_set":true'), false);

  const attemptsBefore = (world.repository.rows('message_delivery_attempts') || []).length;
  assert.equal(attemptsBefore, 1, 'only the FIRST message produced a delivery attempt; the withheld one produced none');

  world.ctl.failTokenWrites = false;
  await deliver(world, second);

  // Send provenance is wire-derived and lands under response_metadata.provider_metadata.
  const attempts = world.repository.rows('message_delivery_attempts') || [];
  assert.equal(attempts.length, 2, 'exactly one further attempt, from the recovered send');
  const provenance = attempts.at(-1).response_metadata?.provider_metadata || {};
  assert.equal(provenance.reply_to_set, true, 'the successful send must record reply_to_set = true');
  assert.equal(attempts.at(-1).status, 'sent');
});

test('C4-E a FRESH issue is unaffected — only an explicit persistence failure withholds', async () => {
  const world = buildWorld();
  const first = await queueConversational(world);
  const result = await deliver(world, first);
  assert.equal(result.status, 'sent', 'the fresh-issue path has no refresh to persist and must send');
  assert.equal(world.captured.length, 1);
});

test('C4-F a token-store fault on the LOOKUP still retries, and a missing secret still dead-letters', async () => {
  // The pre-existing classification must not be weakened by the new branch.
  const world = buildWorld();
  world.worker.replyTokenService = {
    issue: async () => { const e = new Error('token store unreachable'); throw e; },
  };
  const a = await deliver(world, await queueConversational(world));
  assert.equal(a.status, 'retry_scheduled');

  const world2 = buildWorld();
  world2.worker.replyTokenService = {
    issue: async () => { const e = new Error('secret missing'); e.code = 'reply_token_secret_missing'; throw e; },
  };
  const b = await deliver(world2, await queueConversational(world2));
  assert.equal(b.status, 'dead_letter', 'a missing secret is configuration, not weather');
  assert.equal(world2.captured.length, 0);
});
