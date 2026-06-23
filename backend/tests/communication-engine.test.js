import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.CARUP_CHANNEL_WEBHOOK_SECRET = 'test-channel-secret';
process.env.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN = 'telegram-secret';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationInboundService } from '../services/communication/communicationInboundService.js';
import { CommunicationWebhookService } from '../services/communication/communicationWebhookService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { FakeCommunicationAdapter } from '../services/communication/adapters/fakeCommunicationAdapter.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { createCommunicationRouter } from '../routes/communicationRoutes.js';
import { recordAdminThreadReply } from '../routes/adminCommunicationRoutes.js';

const migrationSql = readFileSync(new URL('../../database/migrations/20260623143000_omnichannel_communication_engine.sql', import.meta.url), 'utf8');
const securityFile = readFileSync(new URL('../middleware/securityMiddleware.js', import.meta.url), 'utf8');
const communicationRouteFile = readFileSync(new URL('../routes/communicationRoutes.js', import.meta.url), 'utf8');
const serverFile = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function createHarness({ adapter = null, referralChannelGateway = null } = {}) {
  const repository = new MemoryCommunicationRepository();
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const inboundService = new CommunicationInboundService({
    repository,
    identityService,
    threadService,
    notificationService,
    referralChannelGateway: referralChannelGateway || {
      calls: [],
      async processInbound(channel, input) {
        this.calls.push({ channel, input });
        const hasCode = input.text?.toUpperCase().includes('AGENT8-CODE');
        return {
          success: true,
          channel,
          extracted_referral_code: hasCode ? 'AGENT8-CODE' : null,
          validation: hasCode ? { valid: true, code: { id: 'code-1', campaign_id: 'campaign-1' }, attribution: { campaign_id: 'campaign-1' } } : null,
          reply: 'Referral gateway acknowledged.',
        };
      },
    },
  });
  const webhookService = new CommunicationWebhookService({ repository, inboundService });
  const registry = {
    get: () => adapter || new FakeCommunicationAdapter({ channel: 'in_app' }),
    health: () => [],
  };
  const deliveryWorker = new CommunicationDeliveryWorker({ repository, adapterRegistry: registry });
  return { repository, identityService, threadService, notificationService, preferenceService: notificationService.preferenceService, inboundService, webhookService, deliveryWorker };
}

function createMetaWhatsAppPayload(text = 'hello from WhatsApp') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-1' },
          messages: [{
            id: `wamid.${Buffer.from(text).toString('hex').slice(0, 16)}`,
            from: '263771234567',
            timestamp: '1782240000',
            type: 'text',
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

class ThrowingCommunicationAdapter {
  constructor({ channel = 'in_app', provider = 'throwing', error = null } = {}) {
    this.channel = channel;
    this.provider = provider;
    this.error = error || Object.assign(new Error('provider timeout'), { code: 'timeout' });
  }

  async send() {
    throw this.error;
  }
}

function invokeRouter(router, req) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      type(value) {
        this.headers.type = value;
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, headers: this.headers, body });
      },
      json(body) {
        resolve({ statusCode: this.statusCode, headers: this.headers, body });
      },
    };
    router.handle(req, response, (error) => {
      if (error) reject(error);
      else resolve({ statusCode: 404, headers: {}, body: null });
    });
  });
}

test('migration is additive and creates canonical communication tables without dropping legacy queues', () => {
  for (const table of ['message_threads', 'message_participants', 'messages', 'channel_identities', 'webhook_logs', 'communication_preferences', 'communication_escalations']) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migrationSql, /ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS/);
  assert.match(migrationSql, /ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS/);
  assert.equal(/DROP TABLE IF EXISTS notification_queue/i.test(migrationSql), false);
  assert.equal(/DROP TABLE IF EXISTS outbox_events/i.test(migrationSql), false);
  assert.match(migrationSql, /ENABLE ROW LEVEL SECURITY/);
});

test('TEST 1 WhatsApp share link preserves listing and referral attribution', async () => {
  const { notificationService, threadService } = createHarness();
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'user-1', thread_type: 'marketplace_inquiry' })).thread;
  const queued = await notificationService.queueNotification({
    recipientUserId: 'user-1',
    thread,
    notificationType: 'listing_shared',
    channel: 'in_app',
    templateKey: 'listing_shared_v1',
    variables: { share_text: 'View listing', share_url: 'https://carup.test/marketplace/listing/VIN123?ref=AGENT8-CODE&campaign_id=camp-1&channel=whatsapp' },
    dedupeParts: ['share', 'user-1', 'VIN123', 'AGENT8-CODE', 'whatsapp'],
    payload: { listing_id: 'VIN123', referral_code: 'AGENT8-CODE', campaign_id: 'camp-1', channel: 'whatsapp' },
  });
  assert.equal(queued.notification.payload.listing_id, 'VIN123');
  assert.equal(queued.notification.payload.referral_code, 'AGENT8-CODE');
  assert.equal(queued.notification.payload.channel, 'whatsapp');
  assert.ok(queued.notification.message.includes('AGENT8-CODE'));
});

test('TEST 2 authoritative domain event queues notification and links canonical message', async () => {
  const { repository, notificationService } = createHarness();
  const queued = await notificationService.queueFromDomainEvent({
    id: 'event-1',
    event_type: 'ESCROW_UPDATED',
    payload: { escrowId: 'escrow-1', currentStatus: 'Escrowed', recipientUserId: 'buyer-1' },
  });
  assert.ok(queued.length >= 1);
  const queueRows = await repository.list('notification_queue');
  const messages = await repository.list('messages');
  assert.equal(queueRows[0].dedupe_key.includes('ESCROW_UPDATED'), true);
  assert.equal(queueRows[0].message_id, messages[0].id);
  assert.equal(messages[0].content_text.includes('backend records'), true);
});

test('TEST 3 retryable fake adapter failure records attempt, schedules retry, then succeeds without duplicate message', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'in_app', failPlan: [{ retryable: true, errorCode: 'timeout' }] });
  const { repository, notificationService, deliveryWorker, threadService } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'user-1', thread_type: 'support' })).thread;
  const { notification } = await notificationService.queueNotification({
    recipientUserId: 'user-1',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'support' },
    dedupeParts: ['retry-test', 'user-1'],
  });
  const first = await deliveryWorker.deliverNotification(notification);
  assert.equal(first.status, 'retry_scheduled');
  const retryRow = await repository.findOne('notification_queue', { id: notification.id });
  assert.equal(retryRow.status, 'retry_scheduled');
  assert.ok(retryRow.next_attempt_at);
  const second = await deliveryWorker.deliverNotification(retryRow);
  assert.equal(second.status, 'sent');
  assert.equal((await repository.list('messages')).length, 1);
  assert.equal((await repository.list('message_delivery_attempts')).length, 2);
});

test('TEST 4 duplicate Telegram webhook creates one log/message and returns safe success', async () => {
  const { repository, webhookService } = createHarness();
  const payload = { update_id: 88, message: { message_id: 1, text: '/start AGENT8-CODE', from: { id: 'tg-user' }, chat: { id: 'tg-chat' } } };
  const headers = { 'x-telegram-bot-api-secret-token': 'telegram-secret' };
  const first = await webhookService.handleWebhook('telegram', 'telegram', payload, { headers });
  const second = await webhookService.handleWebhook('telegram', 'telegram', payload, { headers });
  assert.equal(first.count, 1);
  assert.equal(second.duplicate, true);
  assert.equal((await repository.list('webhook_logs')).length, 1);
  assert.equal((await repository.list('messages')).length, 1);
  assert.equal((await repository.list('message_threads')).length, 1);
});

test('external admin reply creates one canonical message, queues notification, and delivery worker sends it', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'in_app' });
  const { repository, threadService, notificationService, deliveryWorker } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({
    primary_user_id: 'user-admin-reply',
    thread_type: 'support',
    primary_channel: 'in_app',
  })).thread;
  const result = await recordAdminThreadReply({
    services: { threadService, notificationService },
    thread,
    actor: { id: 'admin-1' },
    body: { message: 'A specialist reviewed your case.', channel: 'in_app' },
  });

  assert.equal(result.message.direction, 'outbound');
  assert.equal(result.notification.message_id, result.message.id);
  assert.equal(result.notification.recipient_user_id, 'user-admin-reply');
  assert.equal((await repository.list('messages')).length, 1);
  assert.equal((await repository.list('notification_queue')).length, 1);

  const delivered = await deliveryWorker.deliverNotification(result.notification);
  assert.equal(delivered.status, 'sent');
  assert.equal((await repository.findOne('messages', { id: result.message.id })).status, 'delivered');
  assert.equal((await repository.list('message_delivery_attempts')).length, 1);
});

test('internal admin note creates no external notification queue row', async () => {
  const { repository, threadService, notificationService } = createHarness();
  const thread = (await threadService.resolveOrCreateThread({
    primary_user_id: 'user-internal-note',
    thread_type: 'support',
    primary_channel: 'in_app',
  })).thread;
  const result = await recordAdminThreadReply({
    services: { threadService, notificationService },
    thread,
    actor: { id: 'admin-1' },
    body: { message: 'Internal handling note.', channel: 'in_app', internal: true },
  });
  assert.equal(result.message.direction, 'internal');
  assert.equal(result.notification, null);
  assert.equal((await repository.list('messages')).length, 1);
  assert.equal((await repository.list('notification_queue')).length, 0);
});

test('valid Meta GET verification returns challenge and invalid token is rejected', () => {
  const { webhookService } = createHarness();
  webhookService.env.CARUP_META_WEBHOOK_VERIFY_TOKEN = 'verify-token';
  const challenge = webhookService.verifyMetaCallback('whatsapp', {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'verify-token',
    'hub.challenge': '123456789',
  });
  assert.equal(challenge, '123456789');
  assert.throws(() => webhookService.verifyMetaCallback('whatsapp', {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'wrong-token',
    'hub.challenge': '123456789',
  }), /Meta webhook verification failed/);
});

test('communication Meta GET route returns the challenge as plain text', async () => {
  const router = createCommunicationRouter({
    services: {
      webhookService: {
        verifyMetaCallback(channel, query) {
          assert.equal(channel, 'whatsapp');
          assert.equal(query['hub.verify_token'], 'verify-token');
          return query['hub.challenge'];
        },
      },
      adapterRegistry: { health: () => [] },
    },
  });
  const response = await invokeRouter(router, {
    method: 'GET',
    url: '/api/communications/webhooks/meta/whatsapp',
    originalUrl: '/api/communications/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123',
    headers: {},
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-token',
      'hub.challenge': 'abc123',
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.type, 'text/plain');
  assert.equal(response.body, 'abc123');
});

test('Meta raw-body signature accepts exact payload and rejects modified payload', async () => {
  const { repository, identityService, threadService, notificationService } = createHarness();
  const inboundService = new CommunicationInboundService({
    repository,
    identityService,
    threadService,
    notificationService,
    referralChannelGateway: {
      async processInbound() {
        return { success: true, validation: null, reply: 'ok' };
      },
    },
  });
  const webhookService = new CommunicationWebhookService({
    repository,
    inboundService,
    env: { CARUP_META_APP_SECRET: 'meta-secret' },
  });
  const payload = createMetaWhatsAppPayload('signed body AGENT8-CODE');
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', 'meta-secret').update(rawBody).digest('hex')}`;
  const accepted = await webhookService.handleWebhook('meta', 'whatsapp', payload, {
    rawBody,
    headers: { 'x-hub-signature-256': signature },
    actor: { actor_tenant_id: 'platform' },
  });
  assert.equal(accepted.success, true);
  assert.equal(accepted.count, 1);

  const modifiedPayload = createMetaWhatsAppPayload('modified body AGENT8-CODE');
  await assert.rejects(() => webhookService.handleWebhook('meta', 'whatsapp', modifiedPayload, {
    rawBody: JSON.stringify(modifiedPayload),
    headers: { 'x-hub-signature-256': signature },
    actor: { actor_tenant_id: 'platform' },
  }), /Webhook verification failed/);
});

test('notification enqueue uses database default id and works with legacy BIGSERIAL queue shape', async () => {
  const repository = new MemoryCommunicationRepository({}, { legacyNotificationQueueIds: true });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'legacy-user', thread_type: 'support' })).thread;
  const queued = await notificationService.queueNotification({
    recipientUserId: 'legacy-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'legacy queue' },
  });
  assert.equal(queued.notification.id, 1);
  assert.equal(typeof queued.notification.id, 'number');
  assert.equal(queued.notification.message_id, queued.message.id);
});

test('thrown retryable adapter exception records attempt, schedules retry, and clears processing lock', async () => {
  const adapter = new ThrowingCommunicationAdapter({ error: Object.assign(new Error('socket timeout'), { code: 'timeout' }) });
  const { repository, notificationService, deliveryWorker, threadService } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'throw-user', thread_type: 'support' })).thread;
  const { notification } = await notificationService.queueNotification({
    recipientUserId: 'throw-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'retry exception' },
    maxAttempts: 3,
  });
  const result = await deliveryWorker.deliverNotification(notification);
  const row = await repository.findOne('notification_queue', { id: notification.id });
  assert.equal(result.status, 'retry_scheduled');
  assert.equal(row.status, 'retry_scheduled');
  assert.equal(row.locked_at, null);
  assert.equal(row.locked_by, null);
  assert.equal(row.last_error_code, 'timeout');
  assert.equal((await repository.list('message_delivery_attempts')).length, 1);
});

test('final thrown adapter failure records attempt, reaches dead letter, and clears processing lock', async () => {
  const adapter = new ThrowingCommunicationAdapter({ error: Object.assign(new Error('provider still down'), { code: 'timeout' }) });
  const { repository, notificationService, deliveryWorker, threadService } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'dead-user', thread_type: 'support' })).thread;
  const { notification } = await notificationService.queueNotification({
    recipientUserId: 'dead-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'dead exception' },
    maxAttempts: 1,
  });
  const result = await deliveryWorker.deliverNotification(notification);
  const row = await repository.findOne('notification_queue', { id: notification.id });
  assert.equal(result.status, 'dead_letter');
  assert.equal(row.status, 'dead_letter');
  assert.equal(row.locked_at, null);
  assert.equal(row.locked_by, null);
  assert.equal(row.last_error_code, 'timeout');
  assert.equal((await repository.list('message_delivery_attempts')).length, 1);
});

test('identity service rejects unsafe merges based on weak evidence', async () => {
  const { identityService } = createHarness();
  const identity = await identityService.resolveOrCreateIdentity({ channel: 'email', external_id: 'person@example.com', display_name: 'Same Name' });
  await assert.rejects(() => identityService.linkIdentityToUser(identity.id, 'user-1', { nameMatch: true }), /Unsafe identity merge/);
  const linked = await identityService.linkIdentityToUser(identity.id, 'user-1', { adminApproved: true });
  assert.equal(linked.user_id, 'user-1');
  assert.equal(linked.verified, true);
});

test('AI policy forces human handoff for finance and escrow decision requests', async () => {
  const { inboundService, repository } = createHarness();
  const result = await inboundService.ingest({
    channel: 'web_chat',
    provider: 'web',
    text: 'Please approve my finance and release escrow payment now',
    externalSenderId: 'web-user-1',
    user_id: 'user-1',
  }, { actor_user_id: 'user-1', gateway_trusted: true });
  assert.equal(result.classification.handoffRequired, true);
  const thread = (await repository.list('message_threads'))[0];
  assert.equal(thread.status, 'escalated');
  assert.equal((await repository.list('communication_escalations')).length, 1);
  assert.equal(result.ai.canSend, false);
});

test('marketing opt-out suppresses non-transactional channel selection while transactional in-app remains available', async () => {
  const { preferenceService } = createHarness();
  await preferenceService.updatePreferences('user-1', { marketing_enabled: false, whatsapp_enabled: true, in_app_enabled: true });
  const prefs = await preferenceService.getPreferences('user-1');
  assert.deepEqual(preferenceService.selectChannels(prefs, { channels: ['whatsapp', 'in_app'], transactional: false }), []);
  assert.ok(preferenceService.selectChannels(prefs, { channels: ['in_app'], transactional: true }).includes('in_app'));
});

test('dead-letter recovery supports retry and cancel', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'in_app', failPlan: [{ retryable: false, errorCode: 'invalid_recipient' }] });
  const { repository, notificationService, deliveryWorker, threadService } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'user-1', thread_type: 'support' })).thread;
  const { notification } = await notificationService.queueNotification({
    recipientUserId: 'user-1',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'support' },
  });
  await deliveryWorker.deliverNotification(notification);
  assert.equal((await repository.findOne('notification_queue', { id: notification.id })).status, 'dead_letter');
  assert.equal((await deliveryWorker.retryDeadLetter(notification.id)).status, 'queued');
  assert.equal((await deliveryWorker.cancelDeadLetter(notification.id)).status, 'cancelled');
});

test('communication webhook endpoint is listed as CSRF-exempt machine route', () => {
  assert.equal(securityFile.includes('/api\\/communications\\/webhooks'), true);
});

test('communication router registers Meta GET webhook verification endpoint and raw body handoff', () => {
  assert.equal(communicationRouteFile.includes("router.get('/api/communications/webhooks/:provider/:channel'"), true);
  assert.equal(communicationRouteFile.includes('verifyMetaCallback'), true);
  assert.equal(communicationRouteFile.includes('rawBody: req.rawBody'), true);
  assert.equal(serverFile.includes('verify: (req, _res, buf)'), true);
  assert.equal(serverFile.includes('communications\\/webhooks\\/meta'), true);
});
