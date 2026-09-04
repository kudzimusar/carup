import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationCanonicalConversationService } from '../services/communication/communicationCanonicalConversationService.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { CommunicationCanonicalWebhookService } from '../services/communication/communicationCanonicalWebhookService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationPreferenceService } from '../services/communication/communicationPreferenceService.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationInboundService } from '../services/communication/communicationInboundService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { EmailReplyTokenService, REPLY_TOKEN_SECRET_ENV, hashReplyToken, parseReplyToAddress } from '../services/communication/emailReplyTokenService.js';
import { ResendInboundResolver } from '../services/communication/resendWebhookService.js';

/**
 * G5 — the outbound half of authenticated conversation routing, and the round trip it completes.
 *
 * The inbound half was already implemented and certified. What was missing was the outbound
 * attachment: conversational Email went out from `notifications@mail.carup.dev` with no reply
 * credential, so when a human pressed reply their message arrived carrying no token and no RFC
 * reference and was permanently unroutable. That was observed, not theorised.
 *
 * These tests drive the REAL chain — canonical conversation service, the notification service the
 * factory actually wires, the delivery worker, the transport router, and the real inbound resolver
 * behind a genuinely signed webhook. A hand-built adapter payload cannot prove any of it.
 */

const SECRET = 'g5-roundtrip-derivation-secret';
const WEBHOOK_SECRET = `whsec_${Buffer.from('carup-test-signing-secret-0123456789').toString('base64')}`;
const ENV = {
  [REPLY_TOKEN_SECRET_ENV]: SECRET,
  RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET, RESEND_INBOUND_DOMAIN: 'mail.carup.dev',
  BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev',
};

function signResend(rawBody, { id = 'msg_g5_1', timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`, 'utf8').digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${sig}` };
}

/**
 * A supabase-shaped view over the SAME rows the repository holds.
 *
 * The token service and the inbound resolver speak PostgREST while everything else speaks the
 * repository. Backing both by one store is what makes this a round trip rather than two halves that
 * merely agree with their own fixtures.
 */
function supabaseOver(repository) {
  const clone = (row) => JSON.parse(JSON.stringify(row));
  function builder(table) {
    const rows = repository.rows(table);
    const filters = [];
    const orders = [];
    let mode = 'select';
    let payload = null;
    const run = () => {
      let matched = rows.filter((row) => filters.every((f) => f(row)));
      for (const { column, ascending } of [...orders].reverse()) {
        matched = matched.slice().sort((a, b) => (a[column] === b[column] ? 0 : ((a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1))));
      }
      if (mode === 'update') matched.forEach((row) => Object.assign(row, payload));
      return matched.map(clone);
    };
    const api = {
      select: () => api,
      eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
      is: (c) => { filters.push((r) => r[c] === null || r[c] === undefined); return api; },
      gt: (c, v) => { filters.push((r) => new Date(r[c]) > new Date(v)); return api; },
      in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return api; },
      order: (column, opts = {}) => { orders.push({ column, ascending: opts.ascending !== false }); return api; },
      insert: (row) => {
        mode = 'insert';
        const created = { revoked_at: null, use_count: 0, last_used_at: null, binding_id: null, rotated_from: null, created_at: new Date().toISOString(), ...row };
        rows.push(created);
        return { select: () => ({ single: async () => ({ data: clone(created), error: null }) }) };
      },
      update: (patch) => { mode = 'update'; payload = patch; return api; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      single: async () => ({ data: run()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return api;
  }
  return { from: builder };
}

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const BUYER_PARTICIPANT = '22222222-2222-4222-8222-222222222222';
const SELLER_PARTICIPANT = '33333333-3333-4333-8333-333333333333';
const BUYER_IDENTITY = '44444444-4444-4444-8444-444444444444';
const BINDING_ID = '55555555-5555-4555-8555-555555555555';

/** One canonical conversation: a thread, two participants, an email identity and its binding. */
function conversationWorld() {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: THREAD_ID, thread_key: 'g5-thread', thread_type: 'marketplace_inquiry',
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
    communication_preferences: [{
      id: 'pref-1', user_id: 'buyer-1', tenant_id: null,
      transactional_enabled: true, email_enabled: true, in_app_enabled: true,
    }],
    users: [{ id: 'buyer-1', name: 'Buyer One', email: 'buyer@example.test' }],
    email_reply_tokens: [],
  });

  const supabase = supabaseOver(repository);
  const threadService = new CommunicationThreadService({ repository });
  const preferenceService = new CommunicationPreferenceService({ repository });
  const identityService = new CommunicationIdentityService({ repository });
  const notificationService = new CommunicationProductNotificationService({
    repository, threadService, preferenceService,
    templateService: { render: async () => ({ subject: 'CarUp conversation', body: 'B', templateKey: 'admin_reply_v1', data: {} }) },
  });
  const conversationService = new CommunicationCanonicalConversationService({
    repository, threadService, identityService, notificationService,
  });
  const replyTokenService = new EmailReplyTokenService({ supabase, env: ENV });

  const captured = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    captured.push({ url, body });
    const rfc = `<out-${captured.length}@mail.carup.dev>`;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ id: `resend-${captured.length}`, message_id: rfc }),
      headers: new Map([['message-id', rfc]]),
    };
  };
  const router = new EmailTransportRouter({ env: ENV, fetchImpl });
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: { get: (channel) => (channel === 'email' ? router : null) },
    notificationService,
    replyTokenService,
  });

  const inboundService = new CommunicationInboundService({
    repository, identityService, threadService, notificationService, conversationService,
  });
  const webhookService = new CommunicationCanonicalWebhookService({
    repository,
    inboundService,
    inboundResolver: new ResendInboundResolver({ supabase, replyTokenService }),
    replyTokenService,
    // Resend's email.received carries metadata only; the body is fetched by email_id. Stubbed so the
    // round trip does not depend on a live provider, and it returns real content so "body non-empty"
    // is an assertion rather than a tautology.
    inboundContentService: {
      fetchReceivedEmail: async () => ({ ok: true, text: 'Yes, it is still available.', html: null, headers: {}, derivedFromHtml: false, endpoint: 'stub' }),
    },
    notificationService,
    env: ENV,
  });

  return { repository, supabase, conversationService, notificationService, worker, webhookService, replyTokenService, captured };
}

/** Deliver an outbound conversational message to the buyer, through the real chain. */
async function sendConversationalMessage(world, contentText) {
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform',
    direction: 'outbound', channel: 'email', status: 'queued',
    sender_participant_id: SELLER_PARTICIPANT, content_text: contentText, content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });

  const queued = await world.notificationService.queueExistingMessage({
    message, thread,
    recipientUserId: 'buyer-1',
    recipientIdentityId: BUYER_IDENTITY,
    channel: 'email',
    provider: 'resend',
    notificationType: 'conversation_message',
    title: 'CarUp conversation',
    transactional: true,
    classification: 'conversational',
    dedupeParts: ['conversation-message', message.id, BUYER_PARTICIPANT, 'email'],
    payload: { thread_id: THREAD_ID, email: 'buyer@example.test' },
    metadata: { recipient_participant_id: BUYER_PARTICIPANT, recipient_binding_id: BINDING_ID, recipient_binding_channel: 'email' },
  });

  const result = await world.worker.deliverNotification(
    await world.repository.findOne('notification_queue', { id: queued.notification.id }),
  );
  return { message, notification: queued.notification, result };
}

// ============================================================================
// U. THE REAL OUTBOUND PATH
// ============================================================================

test('U1 a real conversational send carries an authenticated Reply-To bound to the exact participant', async () => {
  const world = conversationWorld();
  const { result } = await sendConversationalMessage(world, 'Is the car still available?');

  assert.equal(result.status, 'sent');
  assert.equal(world.captured.length, 1, 'exactly one provider call');
  const body = world.captured[0].body;

  assert.match(body.reply_to, /^conversation\+[A-Za-z0-9_-]{22}@mail\.carup\.dev$/);
  assert.notEqual(body.reply_to, body.from, 'the reply address is not the no-reply sender');

  // The credential is bound to the EXACT canonical context, not a guess.
  const raw = parseReplyToAddress(body.reply_to);
  const [token] = world.repository.rows('email_reply_tokens');
  assert.equal(token.token_hash, hashReplyToken(raw));
  assert.equal(token.thread_id, THREAD_ID);
  assert.equal(token.participant_id, BUYER_PARTICIPANT, 'the RECIPIENT participant, never the sender');
  assert.notEqual(token.participant_id, SELLER_PARTICIPANT);
  assert.equal(token.binding_id, BINDING_ID, 'the exact email binding');
  assert.equal(token.tenant_id, 'platform');
  assert.equal(token.provider, 'resend');
});

test('U2 G4 provenance flips to reply_to_set=true, without recording the credential', async () => {
  const world = conversationWorld();
  await sendConversationalMessage(world, 'Body.');

  const [attempt] = world.repository.rows('message_delivery_attempts');
  const provenance = attempt.response_metadata.provider_metadata;
  assert.equal(provenance.classification, 'conversational');
  assert.equal(provenance.reply_to_set, true, 'before G5 this was correctly false; it is the evidence G5 landed');

  const raw = parseReplyToAddress(world.captured[0].body.reply_to);
  const serialized = JSON.stringify(provenance);
  assert.ok(!serialized.includes(raw), 'the raw token is credential material, not provenance');
  assert.ok(!serialized.includes(world.captured[0].body.reply_to));
});

test('U3 the delivery attempt correlates to the token RECORD, not the credential', async () => {
  const world = conversationWorld();
  await sendConversationalMessage(world, 'Body.');

  const [attempt] = world.repository.rows('message_delivery_attempts');
  const [token] = world.repository.rows('email_reply_tokens');
  assert.equal(attempt.request_metadata.email_reply_token_id, token.id,
    'attempt -> token -> thread/participant is provable without the audit record becoming replayable');
  assert.ok(!JSON.stringify(attempt).includes(parseReplyToAddress(world.captured[0].body.reply_to)));
});

test('U4 non-conversational Email gets NO conversation reply token', async () => {
  const world = conversationWorld();
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform',
    direction: 'outbound', channel: 'email', status: 'queued', content_text: 'Your order shipped.', content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  const queued = await world.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'buyer-1', recipientIdentityId: BUYER_IDENTITY,
    channel: 'email', provider: 'resend', notificationType: 'order_update',
    classification: 'transactional', transactional: true,
    dedupeParts: ['txn', message.id],
    payload: { thread_id: THREAD_ID, email: 'buyer@example.test' },
    metadata: { recipient_participant_id: BUYER_PARTICIPANT },
  });
  await world.worker.deliverNotification(await world.repository.findOne('notification_queue', { id: queued.notification.id }));

  assert.ok(!world.captured[0].body.reply_to, 'a transactional Email is not a conversation');
  assert.equal(world.repository.rows('email_reply_tokens').length, 0, 'and no credential is minted for one');
});

test('U5 the REAL conversation producer binds to the recipient participant, never the sender', async () => {
  // §L anti-vacuity. The tests above hand the notification service the participant directly, which
  // proves the worker uses what it is given but NOT that the producer gives it the right one. This
  // drives `routeMessage` — the live producer — and asserts the participant that survives onto the
  // queue row is the RECIPIENT. A credential bound to the sender would route every customer reply
  // back to the agent who wrote the message.
  const world = conversationWorld();
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  const sender = await world.repository.findOne('message_participants', { id: SELLER_PARTICIPANT });
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform',
    direction: 'outbound', channel: 'email', status: 'queued',
    sender_participant_id: SELLER_PARTICIPANT, content_text: 'Yes, still available.', content_json: {},
  });

  await world.conversationService.routeMessage(thread, sender, message);

  const emailRow = world.repository.rows('notification_queue').find((n) => n.channel === 'email');
  assert.ok(emailRow, 'the producer queued an email notification');
  assert.equal(emailRow.payload.classification, 'conversational');
  assert.equal(emailRow.metadata.recipient_participant_id, BUYER_PARTICIPANT, 'the RECIPIENT');
  assert.notEqual(emailRow.metadata.recipient_participant_id, SELLER_PARTICIPANT, 'never the sender');
  assert.equal(emailRow.metadata.recipient_binding_id, BINDING_ID, 'and the exact email binding');
  assert.equal(emailRow.metadata.recipient_binding_channel, 'email');

  // ...and that context carries all the way to a credential bound to the same person.
  await world.worker.deliverNotification(await world.repository.findOne('notification_queue', { id: emailRow.id }));
  const [token] = world.repository.rows('email_reply_tokens');
  assert.equal(token.participant_id, BUYER_PARTICIPANT);
  assert.equal(token.binding_id, BINDING_ID);
  assert.match(world.captured[0].body.reply_to, /^conversation\+/);
});

// ============================================================================
// N. FAILURE SEMANTICS — never an Email that looks replyable and is not
// ============================================================================

test('N1 a transient token-store failure sends nothing and retries', async () => {
  const world = conversationWorld();
  world.worker.replyTokenService = { issue: async () => { throw new Error('connection terminated unexpectedly'); } };
  const { result } = await sendConversationalMessage(world, 'Body.');

  assert.equal(world.captured.length, 0, 'zero provider calls');
  assert.equal(result.status, 'retry_scheduled');
  const row = await world.repository.findOne('notification_queue', { id: result.notificationId });
  assert.equal(row.last_error_code, 'reply_token_unavailable');
});

test('N2 missing canonical context dead-letters distinctly, with zero provider calls', async () => {
  const world = conversationWorld();
  const message = await world.repository.insert('messages', {
    id: crypto.randomUUID(), thread_id: THREAD_ID, tenant_id: 'platform',
    direction: 'outbound', channel: 'email', status: 'queued', content_text: 'Hi', content_json: {},
  });
  const thread = await world.repository.findOne('message_threads', { id: THREAD_ID });
  const queued = await world.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'buyer-1', recipientIdentityId: BUYER_IDENTITY,
    channel: 'email', provider: 'resend', notificationType: 'conversation_message',
    classification: 'conversational', transactional: true,
    dedupeParts: ['no-context', message.id],
    payload: { thread_id: THREAD_ID, email: 'buyer@example.test' },
    metadata: {}, // no recipient_participant_id — nothing to bind a credential to
  });
  const result = await world.worker.deliverNotification(await world.repository.findOne('notification_queue', { id: queued.notification.id }));

  assert.equal(world.captured.length, 0, 'zero provider calls');
  assert.equal(result.status, 'dead_letter');
  const row = await world.repository.findOne('notification_queue', { id: result.notificationId });
  assert.equal(row.last_error_code, 'conversation_reply_context_missing');
});

test('N3 a missing derivation secret is an explicit configuration failure, not a silent send', async () => {
  const world = conversationWorld();
  world.worker.replyTokenService = new EmailReplyTokenService({ supabase: world.supabase, env: {} });
  const { result } = await sendConversationalMessage(world, 'Body.');

  assert.equal(world.captured.length, 0, 'zero provider calls');
  const row = await world.repository.findOne('notification_queue', { id: result.notificationId });
  assert.equal(row.last_error_code, 'reply_token_secret_missing');
});

// ============================================================================
// W. THE OLD-EMAIL REGRESSION — the defect a naive wiring would have created
// ============================================================================

test('W1 replying to Email A still routes AFTER Email B was sent on the same thread', async () => {
  // This is the defect. The previous `issue()` minted a new token per outbound message and revoked
  // the previous one, so the moment Email B was sent, every reply to Email A became unroutable.
  const world = conversationWorld();

  await sendConversationalMessage(world, 'Email A: is the car still available?');
  const replyToA = world.captured[0].body.reply_to;

  await sendConversationalMessage(world, 'Email B: also, it has new tyres.');
  const replyToB = world.captured[1].body.reply_to;

  assert.equal(replyToB, replyToA, 'a stable conversation keeps ONE address');

  const resolved = await world.replyTokenService.resolve(parseReplyToAddress(replyToA));
  assert.equal(resolved.ok, true, "Email A's reply address must still route");
  assert.equal(resolved.threadId, THREAD_ID);
  assert.equal(resolved.participantId, BUYER_PARTICIPANT);

  const live = world.repository.rows('email_reply_tokens').filter((r) => !r.revoked_at);
  assert.equal(live.length, 1);
});

// ============================================================================
// V. ROUND TRIP — outbound through transport, inbound through the real resolver
// ============================================================================

test('V1 LEVEL A round trip: outbound Reply-To comes back as one inbound message on the same thread', async () => {
  const world = conversationWorld();
  const { message } = await sendConversationalMessage(world, 'Is the car still available?');

  const before = {
    threads: world.repository.rows('message_threads').length,
    participants: world.repository.rows('message_participants').length,
    identities: world.repository.rows('channel_identities').length,
    messages: world.repository.rows('messages').length,
  };
  const replyTo = world.captured[0].body.reply_to;
  const outboundRfc = world.repository.rows('message_delivery_attempts')[0].provider_message_id;
  assert.ok(outboundRfc, 'precondition: the outbound RFC id was persisted');

  // The human presses reply. Both signals are present, so they must AGREE.
  const payload = {
    type: 'email.received',
    data: {
      email_id: 'inbound-1',
      from: 'buyer@example.test',
      to: [replyTo],
      subject: 'Re: CarUp conversation',
      in_reply_to: outboundRfc,
      message_id: '<reply-1@example.test>',
      headers: { 'Message-Id': '<reply-1@example.test>' },
    },
  };
  const rawBody = JSON.stringify(payload);
  const outcome = await world.webhookService.handleWebhook('resend', 'email', payload, {
    headers: signResend(rawBody), rawBody,
  });

  assert.equal(outcome.success, true);
  const after = {
    threads: world.repository.rows('message_threads').length,
    participants: world.repository.rows('message_participants').length,
    identities: world.repository.rows('channel_identities').length,
    messages: world.repository.rows('messages').length,
  };
  assert.equal(after.threads, before.threads, 'thread delta +0');
  assert.equal(after.participants, before.participants, 'participant delta +0');
  assert.equal(after.identities, before.identities, 'identity delta +0');
  assert.equal(after.messages, before.messages + 1, 'message delta +1');

  const inbound = world.repository.rows('messages').filter((m) => m.direction === 'inbound');
  assert.equal(inbound.length, 1);
  assert.equal(inbound[0].thread_id, THREAD_ID, 'the SAME canonical conversation');
  assert.equal(inbound[0].sender_participant_id, BUYER_PARTICIPANT, 'the same participant the token was bound to');
  assert.ok(inbound[0].content_text.length > 0, 'the body was retrieved');
  assert.notEqual(inbound[0].id, message.id);

  const [token] = world.repository.rows('email_reply_tokens');
  assert.equal(token.use_count, 1, 'use_count 0 -> 1');
});

test('V2 a replayed webhook adds no second message', async () => {
  const world = conversationWorld();
  await sendConversationalMessage(world, 'Is the car still available?');
  const replyTo = world.captured[0].body.reply_to;

  const payload = {
    type: 'email.received',
    data: {
      email_id: 'inbound-replay', from: 'buyer@example.test', to: [replyTo],
      subject: 'Re: CarUp conversation', message_id: '<reply-replay@example.test>',
      headers: { 'Message-Id': '<reply-replay@example.test>' },
    },
  };
  const rawBody = JSON.stringify(payload);
  const before = world.repository.rows('messages').length;
  await world.webhookService.handleWebhook('resend', 'email', payload, { headers: signResend(rawBody), rawBody });
  const afterFirst = world.repository.rows('messages').length;
  assert.equal(afterFirst, before + 1, 'precondition: the first delivery really was ingested');

  const replay = await world.webhookService.handleWebhook('resend', 'email', payload, { headers: signResend(rawBody), rawBody });
  assert.equal(replay.success, true);
  assert.equal(world.repository.rows('messages').length, afterFirst, 'replay is idempotent — +0 messages');
});

test('V3 token-only resolution is the authenticated route', async () => {
  const world = conversationWorld();
  await sendConversationalMessage(world, 'Body.');
  const replyTo = world.captured[0].body.reply_to;

  const resolution = await new ResendInboundResolver({ supabase: world.supabase, replyTokenService: world.replyTokenService })
    .resolve({ to: [replyTo] });
  assert.equal(resolution.ok, true);
  assert.equal(resolution.resolution, 'authenticated_reply_token');
  assert.equal(resolution.threadId, THREAD_ID);
  assert.equal(resolution.participantId, BUYER_PARTICIPANT);
});

test('V4 token and RFC signals must AGREE — a disagreement fails closed', async () => {
  const world = conversationWorld();
  await sendConversationalMessage(world, 'Body.');
  const replyTo = world.captured[0].body.reply_to;

  // An RFC reference pointing at a message on a DIFFERENT thread.
  const otherThreadId = '99999999-9999-4999-8999-999999999999';
  await world.repository.insert('message_threads', { id: otherThreadId, thread_key: 'other', tenant_id: 'platform', status: 'open' });
  const otherMessage = await world.repository.insert('messages', { id: crypto.randomUUID(), thread_id: otherThreadId, tenant_id: 'platform', direction: 'outbound', channel: 'email', status: 'sent', content_json: {} });
  await world.repository.insert('message_delivery_attempts', { id: crypto.randomUUID(), message_id: otherMessage.id, provider: 'resend', provider_message_id: '<other@mail.carup.dev>' });

  const resolution = await new ResendInboundResolver({ supabase: world.supabase, replyTokenService: world.replyTokenService })
    .resolve({ to: [replyTo], in_reply_to: '<other@mail.carup.dev>' });
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, 'token_rfc_disagreement', 'never guess which signal to believe');
});

// ============================================================================
// X. NO RAW CREDENTIAL IS PERSISTED ANYWHERE CARUP CONTROLS
// ============================================================================

test('X1 the raw token appears ONLY in the provider payload, never in any stored row', async () => {
  const world = conversationWorld();
  await sendConversationalMessage(world, 'Is the car still available?');

  const replyTo = world.captured[0].body.reply_to;
  const raw = parseReplyToAddress(replyTo);
  assert.ok(raw && raw.length === 22);
  assert.ok(JSON.stringify(world.captured[0].body).includes(raw), 'it IS on the wire — that is its purpose');

  for (const table of [
    'notification_queue', 'messages', 'message_delivery_attempts',
    'email_reply_tokens', 'message_threads', 'message_participants',
    'channel_identities', 'conversation_channel_bindings', 'communication_audit_events', 'webhook_logs',
  ]) {
    const serialized = JSON.stringify(world.repository.rows(table));
    assert.ok(!serialized.includes(raw), `${table} must not store the raw token`);
    assert.ok(!serialized.includes(replyTo), `${table} must not store the reply address`);
  }
  assert.ok(!JSON.stringify(world.repository.rows('email_reply_tokens')).includes(SECRET), 'nor the derivation secret');
});
