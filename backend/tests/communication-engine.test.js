import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.CARUP_CHANNEL_WEBHOOK_SECRET = 'test-channel-secret';
process.env.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN = 'telegram-secret';

import { CommunicationRepository, MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationInboundService } from '../services/communication/communicationInboundService.js';
import { CommunicationWebhookService } from '../services/communication/communicationWebhookService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { registerCommunicationListeners } from '../services/communication/communicationEventListeners.js';
import { FakeCommunicationAdapter } from '../services/communication/adapters/fakeCommunicationAdapter.js';
import {
  SendGridEmailAdapter,
  CloudflareEmailAdapter,
  TwilioSmsAdapter,
  MetaWhatsAppAdapter,
  FacebookMessengerAdapter,
  InstagramMessagingAdapter,
  TelegramBotAdapter,
  ExpoPushAdapter,
  createDefaultAdapterRegistry,
  assertRealTelegramAdapter,
} from '../services/communication/adapters/providerAdapters.js';
const { createCommunicationRouter } = await import('../routes/communicationRoutes.js');
const { recordAdminThreadReply } = await import('../routes/adminCommunicationRoutes.js');

const migrationSql = readFileSync(new URL('../../database/migrations/20260623143000_omnichannel_communication_engine.sql', import.meta.url), 'utf8');
const providerRuntimeMigrationSql = readFileSync(new URL('../../database/migrations/20260624120000_communication_provider_runtime.sql', import.meta.url), 'utf8');
const runtimeHardeningMigrationSql = readFileSync(new URL('../../database/migrations/20260624044812_agent8_communication_runtime_security_hardening.sql', import.meta.url), 'utf8');
const legacyQueueCompatibilityMigrationSql = readFileSync(new URL('../../database/migrations/20260625031500_agent8_communication_legacy_queue_compatibility.sql', import.meta.url), 'utf8');
const securityFile = readFileSync(new URL('../middleware/securityMiddleware.js', import.meta.url), 'utf8');
const communicationRouteFile = readFileSync(new URL('../routes/communicationRoutes.js', import.meta.url), 'utf8');
const adminCommunicationRouteFile = readFileSync(new URL('../routes/adminCommunicationRoutes.js', import.meta.url), 'utf8');
const serverFile = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const eventWorkerFile = readFileSync(new URL('../services/eventBus/eventWorker.js', import.meta.url), 'utf8');
const cloudflareWorkerFile = readFileSync(new URL('../../cloudflare/carup-communications-edge/src/index.js', import.meta.url), 'utf8');
const backendVercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const supabaseCronMigrationSql = readFileSync(new URL('../../database/migrations/20260626120000_communication_supabase_cron.sql', import.meta.url), 'utf8');

function createHarness({ adapter = null, referralChannelGateway = null, repository = null } = {}) {
  repository ||= new MemoryCommunicationRepository();
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

function createCloudflareEmailPayload(overrides = {}) {
  return {
    event: 'inbound_email',
    message_id: '<cf-message-1@example.test>',
    idempotency_key: 'cf-inbound-1',
    sender: 'buyer@example.test',
    recipient: 'support@example.test',
    subject: 'Marketplace inquiry',
    text: 'Can I inspect the marketplace listing?',
    raw_size: 512,
    headers: {
      'message-id': '<cf-message-1@example.test>',
      'in-reply-to': '<root@example.test>',
      references: '<root@example.test>',
    },
    references: ['<root@example.test>'],
    attachments: [],
    ...overrides,
  };
}

function signCloudflarePayload(payload, secret = 'cloudflare-inbound-secret', { timestamp = Math.floor(Date.now() / 1000), nonce = 'nonce-1', rawBody = null } = {}) {
  const body = rawBody || JSON.stringify(payload);
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${bodyHash}.${body}`).digest('hex');
  return {
    rawBody: body,
    headers: {
      'x-carup-cloudflare-timestamp': String(timestamp),
      'x-carup-cloudflare-nonce': nonce,
      'x-carup-body-sha256': bodyHash,
      'x-carup-cloudflare-signature': `v1=${signature}`,
    },
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

function invokeRouteHandler(router, method, path, handlerIndex, req) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods?.[method.toLowerCase()]);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} not found`);
  const handler = layer.route.stack[handlerIndex]?.handle;
  assert.equal(typeof handler, 'function', `Route ${method.toUpperCase()} ${path} handler ${handlerIndex} not found`);
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
    handler({
      headers: {},
      query: {},
      body: {},
      params: {},
      ...req,
    }, response, (error) => {
      if (error) reject(error);
      else resolve({ statusCode: 404, headers: {}, body: null });
    });
  });
}

function jsonFetchRecorder({ status = 200, body = {}, headers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (key) => headers[String(key).toLowerCase()] || null },
      async text() {
        return JSON.stringify(body);
      },
      async json() {
        return body;
      },
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('migration is additive and creates canonical communication tables without dropping legacy queues', () => {
  for (const table of ['message_threads', 'message_participants', 'messages', 'channel_identities', 'webhook_logs', 'communication_preferences', 'communication_escalations']) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migrationSql, /ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS/);
  for (const column of ['type', 'title', 'message', 'read']) {
    assert.match(migrationSql, new RegExp(`ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
  assert.match(migrationSql, /ALTER TABLE notification_queue ALTER COLUMN recipient_id DROP NOT NULL/);
  assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS idx_notification_queue_status_due\s+ON notification_queue \(status, next_attempt_at, scheduled_at, created_at\)/);
  assert.equal(/idx_notification_queue_status_due\s+ON notification_queue \(status, COALESCE\(next_attempt_at, scheduled_at::timestamptz/i.test(migrationSql), false);
  assert.match(migrationSql, /ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS/);
  assert.equal(/DROP TABLE IF EXISTS notification_queue/i.test(migrationSql), false);
  assert.equal(/DROP TABLE IF EXISTS outbox_events/i.test(migrationSql), false);
  assert.match(migrationSql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migrationSql, /ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY/);
  assert.match(migrationSql, /CREATE POLICY "notification_queue_user_read"/);
  assert.match(migrationSql, /CREATE POLICY "message_delivery_attempts_admin_read"/);
  assert.match(migrationSql, /CREATE POLICY "webhook_logs_admin_read"/);
  for (const indexName of [
    'idx_messages_sender_participant',
    'idx_messages_in_reply_to',
    'idx_notification_queue_recipient_id',
    'idx_notification_queue_recipient_identity',
    'idx_notification_queue_message',
  ]) {
    assert.match(migrationSql, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}`));
  }
});

test('provider runtime migration adds SKIP LOCKED claim function without changing queue primary key', () => {
  assert.match(providerRuntimeMigrationSql, /CREATE OR REPLACE FUNCTION claim_due_communication_notifications/);
  assert.match(providerRuntimeMigrationSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(providerRuntimeMigrationSql, /RETURNS SETOF notification_queue/);
  assert.match(providerRuntimeMigrationSql, /scheduled_at::timestamptz/);
  assert.match(providerRuntimeMigrationSql, /ALTER TABLE notification_queue ALTER COLUMN id SET DEFAULT gen_random_uuid\(\)::text/);
  assert.match(providerRuntimeMigrationSql, /REVOKE EXECUTE ON FUNCTION claim_due_communication_notifications\(TEXT, INTEGER, INTEGER\) FROM anon/);
  assert.match(providerRuntimeMigrationSql, /REVOKE EXECUTE ON FUNCTION claim_due_communication_notifications\(TEXT, INTEGER, INTEGER\) FROM authenticated/);
  assert.match(providerRuntimeMigrationSql, /GRANT EXECUTE ON FUNCTION claim_due_communication_notifications\(TEXT, INTEGER, INTEGER\) TO service_role/);
  assert.equal(/DROP TABLE IF EXISTS notification_queue/i.test(providerRuntimeMigrationSql), false);
});

test('runtime hardening migration guards claim RPC grants for fresh databases', () => {
  assert.match(runtimeHardeningMigrationSql, /to_regprocedure\('claim_due_communication_notifications\(text, integer, integer\)'\)/);
  assert.match(runtimeHardeningMigrationSql, /GRANT EXECUTE ON FUNCTION claim_due_communication_notifications\(TEXT, INTEGER, INTEGER\) TO service_role/);
});

test('legacy queue compatibility migration removes immutable cast index and external recipient blocker', () => {
  assert.match(legacyQueueCompatibilityMigrationSql, /ALTER TABLE notification_queue ALTER COLUMN recipient_id DROP NOT NULL/);
  assert.match(legacyQueueCompatibilityMigrationSql, /DROP INDEX IF EXISTS idx_notification_queue_status_due/);
  assert.match(legacyQueueCompatibilityMigrationSql, /ON notification_queue \(status, next_attempt_at, scheduled_at, created_at\)/);
  assert.equal(/scheduled_at::timestamptz|created_at::timestamptz/.test(legacyQueueCompatibilityMigrationSql), false);
});

test('communication domain listener skips missing Agent 8 schema until engine is explicitly enabled', async () => {
  const subscriptions = new Map();
  const fakeWorker = {
    subscribe(eventType, handler) {
      subscriptions.set(eventType, handler);
    },
  };
  const services = {
    orchestrator: {
      async handleDomainEvent() {
        throw new Error("message_threads lookup failed: Could not find the table 'public.message_threads' in the schema cache");
      },
    },
  };
  delete process.env.COMMUNICATION_ENGINE_ENABLED;
  registerCommunicationListeners(fakeWorker, services);
  await subscriptions.get('ESCROW_CREATED')({ escrowId: 'escrow-missing-schema' }, null, 'tenant-1');
  process.env.COMMUNICATION_ENGINE_ENABLED = 'true';
  await assert.rejects(() => subscriptions.get('ESCROW_CREATED')({ escrowId: 'escrow-strict-schema' }, null, 'tenant-1'), /message_threads lookup failed/);
  delete process.env.COMMUNICATION_ENGINE_ENABLED;
});

test('default adapter registry uses deterministic fakes in test and real fail-closed adapters in production', () => {
  const testRegistry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'test' } });
  assert.equal(testRegistry.get('email').validateConfiguration().mode, 'fake');
  const productionRegistry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'production' } });
  const emailHealth = productionRegistry.get('email').validateConfiguration();
  assert.equal(emailHealth.provider, 'sendgrid');
  assert.equal(emailHealth.available, false);
  assert.deepEqual(emailHealth.missing, ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL']);
  const cloudflareRegistry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'production', EMAIL_PROVIDER: 'cloudflare', EMAIL_PROVIDER_FALLBACK: 'sendgrid' } });
  const cloudflareHealth = cloudflareRegistry.get('email').validateConfiguration();
  assert.equal(cloudflareHealth.provider, 'cloudflare_email');
  assert.equal(cloudflareHealth.available, false);
  assert.equal(cloudflareHealth.fallback_provider, 'sendgrid');
  assert.deepEqual(cloudflareHealth.missing, ['CLOUDFLARE_EMAIL_FROM', 'CLOUDFLARE_EMAIL_WORKER_URL_OR_REST_API']);
});

test('real SendGrid email adapter posts mail send request and maps accepted response', async () => {
  const fetchImpl = jsonFetchRecorder({ status: 202, body: {}, headers: { 'x-message-id': 'sg-req-1' } });
  const adapter = new SendGridEmailAdapter({
    env: { SENDGRID_API_KEY: 'sg-test-key', SENDGRID_FROM_EMAIL: 'noreply@example.test' },
    fetchImpl,
  });
  const result = await adapter.send({
    notificationId: 'notif-1',
    messageId: 'msg-1',
    recipient: { email: 'buyer@example.test' },
    content: { subject: 'CarUp update', body: 'Your update is ready.', data: {} },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.providerRequestId, 'sg-req-1');
  assert.equal(fetchImpl.calls[0].url, 'https://api.sendgrid.com/v3/mail/send');
  assert.equal(JSON.parse(fetchImpl.calls[0].options.body).personalizations[0].to[0].email, 'buyer@example.test');
  assert.equal(fetchImpl.calls[0].options.headers.authorization, 'Bearer sg-test-key');
});

test('Cloudflare email adapter posts authenticated Worker request and maps accepted response', async () => {
  const fetchImpl = jsonFetchRecorder({ status: 200, body: { accepted: true, providerMessageId: 'cf-worker-msg-1', providerStatus: 'accepted' }, headers: { 'cf-ray': 'ray-1' } });
  const adapter = new CloudflareEmailAdapter({
    env: {
      CLOUDFLARE_EMAIL_FROM: 'noreply@example.test',
      CLOUDFLARE_EMAIL_FROM_NAME: 'CarUp',
      CLOUDFLARE_EMAIL_WORKER_URL: 'https://communications-edge.example.test',
      CLOUDFLARE_EMAIL_WORKER_SECRET: 'worker-secret',
    },
    fetchImpl,
  });
  const result = await adapter.send({
    notificationId: 'notif-cf-1',
    messageId: 'msg-cf-1',
    recipient: { email: 'buyer@example.test' },
    content: { subject: 'CarUp update', body: 'Your update is ready.', data: { headers: { 'X-CarUp-Test': 'yes' } } },
    idempotencyKey: 'dedupe-cf-1',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.providerMessageId, 'cf-worker-msg-1');
  assert.equal(fetchImpl.calls[0].url, 'https://communications-edge.example.test/email/send');
  assert.equal(fetchImpl.calls[0].options.headers.authorization, 'Bearer worker-secret');
  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.to, 'buyer@example.test');
  assert.equal(body.from.address, 'noreply@example.test');
  assert.equal(body.metadata.notification_id, 'notif-cf-1');
  assert.equal(body.headers['X-CarUp-Test'], 'yes');
});

test('Cloudflare email adapter uses official REST fallback when Worker credentials are incomplete', async () => {
  const fetchImpl = jsonFetchRecorder({ status: 200, body: { success: true, result: { delivered: [], queued: ['buyer@example.test'] } }, headers: { 'cf-ray': 'ray-rest-1' } });
  const adapter = new CloudflareEmailAdapter({
    env: {
      CLOUDFLARE_EMAIL_FROM: 'noreply@example.test',
      CLOUDFLARE_EMAIL_WORKER_URL: 'https://communications-edge.example.test',
      CLOUDFLARE_ACCOUNT_ID: 'account-1',
      CLOUDFLARE_EMAIL_API_TOKEN: 'cf-api-token',
    },
    fetchImpl,
  });
  const result = await adapter.send({
    notificationId: 'notif-cf-rest',
    recipient: { email: 'buyer@example.test' },
    content: { subject: 'REST update', body: 'REST body', data: {} },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.providerRequestId, 'ray-rest-1');
  assert.equal(fetchImpl.calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send');
  assert.equal(fetchImpl.calls[0].options.headers.authorization, 'Bearer cf-api-token');
});

test('real Twilio SMS adapter sends one form-encoded message request and maps SID', async () => {
  const fetchImpl = jsonFetchRecorder({ status: 201, body: { sid: 'SM123', status: 'queued' } });
  const adapter = new TwilioSmsAdapter({
    env: {
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'twilio-token',
      TWILIO_MESSAGING_SERVICE_SID: 'MG123',
      TWILIO_STATUS_CALLBACK_URL: 'https://api.example.test/api/communications/webhooks/twilio/sms',
    },
    fetchImpl,
  });
  const result = await adapter.send({
    notificationId: 'notif-2',
    messageId: 'msg-2',
    recipient: { phoneNumber: '+263771234567' },
    content: { body: 'SMS update', data: {} },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.providerMessageId, 'SM123');
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].options.body, /MessagingServiceSid=MG123/);
  assert.match(fetchImpl.calls[0].options.body, /To=%2B263771234567/);
});

test('real Meta, Telegram, and Expo adapters validate recipient/config and map provider IDs', async () => {
  const metaFetch = jsonFetchRecorder({ status: 200, body: { messages: [{ id: 'wamid.test' }] } });
  const meta = new MetaWhatsAppAdapter({
    env: { CARUP_META_ACCESS_TOKEN: 'meta-token', CARUP_META_PHONE_NUMBER_ID: 'phone-id' },
    fetchImpl: metaFetch,
  });
  assert.equal((await meta.send({
    notificationId: 'n3',
    messageId: 'm3',
    recipient: { phoneNumber: '263771234567' },
    content: { body: 'WhatsApp update', data: {} },
  })).providerMessageId, 'wamid.test');

  const telegramFetch = jsonFetchRecorder({ status: 200, body: { ok: true, result: { message_id: 77 } } });
  const telegram = new TelegramBotAdapter({ env: { CARUP_TELEGRAM_BOT_TOKEN: 'telegram-token' }, fetchImpl: telegramFetch });
  assert.equal((await telegram.send({
    notificationId: 'n4',
    messageId: 'm4',
    recipient: { telegramChatId: 'chat-1' },
    content: { body: 'Telegram update', data: {} },
  })).providerMessageId, '77');

  const expoFetch = jsonFetchRecorder({ status: 200, body: { data: [{ status: 'ok', id: 'expo-ticket-1' }] } });
  const expo = new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'expo-token' }, fetchImpl: expoFetch });
  assert.equal((await expo.send({
    notificationId: 'n5',
    messageId: 'm5',
    recipient: { expoPushToken: 'ExponentPushToken[test]' },
    content: { subject: 'Push', body: 'Push update', data: {} },
  })).providerMessageId, 'expo-ticket-1');

  assert.equal((await new MetaWhatsAppAdapter({ env: {}, fetchImpl: metaFetch }).send({})).errorCode, 'provider_not_configured');
});

test('real Facebook and Instagram adapters send Meta messaging requests with scoped recipient IDs', async () => {
  const facebookFetch = jsonFetchRecorder({ status: 200, body: { message_id: 'fb-mid-1' } });
  const facebook = new FacebookMessengerAdapter({
    env: { CARUP_META_ACCESS_TOKEN: 'meta-token', CARUP_META_PAGE_ID: 'page-id' },
    fetchImpl: facebookFetch,
  });
  const fbResult = await facebook.send({
    notificationId: 'n-fb',
    messageId: 'm-fb',
    recipient: { externalId: 'fb-psid-1' },
    content: { body: 'Facebook reply', data: {} },
  });
  assert.equal(fbResult.providerMessageId, 'fb-mid-1');
  assert.equal(JSON.parse(facebookFetch.calls[0].options.body).recipient.id, 'fb-psid-1');

  const instagramFetch = jsonFetchRecorder({ status: 200, body: { message_id: 'ig-mid-1' } });
  const instagram = new InstagramMessagingAdapter({
    env: { CARUP_META_ACCESS_TOKEN: 'meta-token', CARUP_META_PAGE_ID: 'page-id' },
    fetchImpl: instagramFetch,
  });
  const igResult = await instagram.send({
    notificationId: 'n-ig',
    messageId: 'm-ig',
    recipient: { externalId: 'ig-scoped-1' },
    content: { body: 'Instagram reply', data: {} },
  });
  assert.equal(igResult.providerMessageId, 'ig-mid-1');
  assert.match(instagramFetch.calls[0].url, /graph\.facebook\.com\/v20\.0\/page-id\/messages/);
  assert.equal(JSON.parse(instagramFetch.calls[0].options.body).recipient.id, 'ig-scoped-1');
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

test('external admin reply to requester identity queues canonical notification and delivery worker sends it', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'telegram', provider: 'telegram' });
  const { repository, identityService, threadService, notificationService, deliveryWorker } = createHarness({ adapter });
  const identity = await identityService.resolveOrCreateIdentity({
    channel: 'telegram',
    provider: 'telegram',
    external_id: 'tg-chat-99',
    display_name: 'Telegram Guest',
  });
  const thread = (await threadService.resolveOrCreateThread({
    thread_type: 'support',
    primary_channel: 'telegram',
    external_identity_id: identity.id,
  })).thread;
  const result = await recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-1' },
    body: { message: 'Thanks, we can help from here.', channel: 'telegram' },
  });

  assert.equal(result.message.direction, 'outbound');
  assert.equal(result.notification.message_id, result.message.id);
  assert.equal(result.notification.recipient_id, null);
  assert.equal(result.notification.recipient_user_id, null);
  assert.equal(result.notification.recipient_identity_id, identity.id);
  assert.equal(result.notification.payload.telegram_chat_id, 'tg-chat-99');
  assert.equal(result.notification.payload.external_identity_id, identity.id);
  assert.equal((await repository.list('messages')).length, 1);
  assert.equal((await repository.list('notification_queue')).length, 1);

  const delivered = await deliveryWorker.deliverNotification(result.notification);
  assert.equal(delivered.status, 'sent');
  assert.equal((await repository.findOne('messages', { id: result.message.id })).status, 'delivered');
  assert.equal((await repository.list('message_delivery_attempts')).length, 1);
});

test('Telegram admin reply uses migrated queue schema and creates one message plus one queue row', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'telegram', provider: 'telegram' });
  const repository = new MemoryCommunicationRepository({}, {
    strictNotificationQueueColumns: true,
    legacyNotificationQueueIds: true,
  });
  const { identityService, threadService, notificationService, deliveryWorker } = createHarness({ adapter, repository });
  const identity = await identityService.resolveOrCreateIdentity({
    channel: 'telegram',
    provider: 'telegram',
    external_id: 'tg-issue-108',
    normalized_address: 'tg-issue-108',
  });
  const thread = (await threadService.resolveOrCreateThread({
    thread_type: 'support',
    primary_channel: 'telegram',
    external_identity_id: identity.id,
  })).thread;

  const result = await recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-issue-108' },
    body: {
      message: 'Telegram reply from admin.',
      channel: 'telegram',
      client_message_id: 'issue-108-telegram-reply',
    },
  });

  const messages = await repository.list('messages');
  const queueRows = await repository.list('notification_queue');
  assert.equal(messages.length, 1);
  assert.equal(queueRows.length, 1);
  assert.equal(queueRows[0].recipient_identity_id, identity.id);
  assert.equal(queueRows[0].channel, 'telegram');
  assert.equal(queueRows[0].provider, 'telegram');
  assert.equal(queueRows[0].message_id, result.message.id);
  assert.equal(queueRows[0].payload.telegram_chat_id, 'tg-issue-108');
  assert.equal(Object.hasOwn(queueRows[0], 'message_content'), false);
  assert.equal(typeof queueRows[0].id, 'number');

  const delivered = await deliveryWorker.deliverNotification(result.notification);
  assert.equal(delivered.status, 'sent');
  assert.equal((await repository.findOne('messages', { id: result.message.id })).status, 'delivered');
});

test('admin reply queue insertion failure leaves no orphan outbound message', async () => {
  class FailingQueueRepository extends MemoryCommunicationRepository {
    async insert(table, row) {
      if (table === 'notification_queue') throw new Error('simulated notification_queue insert failure');
      return super.insert(table, row);
    }
  }

  const repository = new FailingQueueRepository();
  const { threadService, notificationService } = createHarness({ repository });
  const thread = (await threadService.resolveOrCreateThread({
    primary_user_id: 'issue-108-user',
    thread_type: 'support',
    primary_channel: 'in_app',
  })).thread;

  await assert.rejects(() => recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-issue-108' },
    body: {
      message: 'This should roll back.',
      channel: 'in_app',
      client_message_id: 'issue-108-failing-reply',
    },
  }), /simulated notification_queue insert failure/);

  assert.equal((await repository.list('messages')).length, 0);
  assert.equal((await repository.list('notification_queue')).length, 0);
  const restoredThread = await repository.findOne('message_threads', { id: thread.id });
  assert.equal(restoredThread.status, thread.status);
  assert.equal(restoredThread.last_message_at, null);
});

test('duplicate admin reply client_message_id returns original records without duplicates', async () => {
  const repository = new MemoryCommunicationRepository();
  const { threadService, notificationService } = createHarness({ repository });
  const thread = (await threadService.resolveOrCreateThread({
    primary_user_id: 'issue-108-idempotent-user',
    thread_type: 'support',
    primary_channel: 'in_app',
  })).thread;
  const body = {
    message: 'Please retry safely.',
    channel: 'in_app',
    client_message_id: 'issue-108-idempotent-reply',
  };

  const first = await recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-issue-108' },
    body,
  });
  const second = await recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-issue-108' },
    body,
  });

  assert.equal(second.duplicate, true);
  assert.equal(second.message.id, first.message.id);
  assert.equal(second.notification.id, first.notification.id);
  assert.equal((await repository.list('messages')).length, 1);
  assert.equal((await repository.list('notification_queue')).length, 1);
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
  }), (error) => error.statusCode === 403 && /Meta webhook verification failed/.test(error.message));
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

test('user-visible thread message route records inbound message on the authorized target thread', async () => {
  const services = createHarness();
  const thread = (await services.threadService.resolveOrCreateThread({
    primary_user_id: 'route-user',
    thread_type: 'support',
    primary_channel: 'web_chat',
  })).thread;
  const router = createCommunicationRouter({ services });
  const response = await invokeRouteHandler(router, 'post', '/api/communications/threads/:id/messages', 1, {
    params: { id: thread.id },
    userContext: { id: 'route-user', tenantId: null },
    headers: { 'x-user-id': 'route-user' },
    body: {
      channel: 'web_chat',
      message: 'Is the marketplace listing price still available?',
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.thread.id, thread.id);
  assert.equal(response.body.thread.thread_type, 'support');
  assert.equal(response.body.created_thread, false);
  assert.equal(response.body.message.thread_id, thread.id);
  assert.equal(response.body.classification.intent, 'marketplace_inquiry');
  assert.equal((await services.repository.list('message_threads')).length, 1);
  assert.equal((await services.repository.list('messages', { thread_id: thread.id })).length, 2);
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
  }), (error) => error.statusCode === 403 && /Webhook verification failed/.test(error.message));
});

test('Cloudflare email webhook accepts valid raw-body HMAC and stores canonical inbound message', async () => {
  const { repository, identityService, threadService, notificationService } = createHarness();
  const inboundService = new CommunicationInboundService({
    repository,
    identityService,
    threadService,
    notificationService,
    referralChannelGateway: {
      async processInbound(channel, input) {
        return { success: true, channel, validation: null, reply: 'ok', input };
      },
    },
  });
  const webhookService = new CommunicationWebhookService({
    repository,
    inboundService,
    env: {
      CLOUDFLARE_EMAIL_INBOUND_SECRET: 'cloudflare-inbound-secret',
      CLOUDFLARE_EMAIL_ALLOWED_RECIPIENTS: 'support@example.test',
    },
  });
  const payload = createCloudflareEmailPayload({
    attachments: [{ filename: 'inspection.pdf', content_type: 'application/pdf', size: 1234, sha256: 'abc123', r2_key: 'email/message/inspection.pdf' }],
  });
  const signed = signCloudflarePayload(payload);
  const accepted = await webhookService.handleWebhook('cloudflare', 'email', payload, {
    rawBody: signed.rawBody,
    headers: signed.headers,
    actor: { actor_tenant_id: 'platform' },
  });
  assert.equal(accepted.success, true);
  assert.equal(accepted.count, 1);
  const messages = await repository.list('messages');
  assert.equal(messages[0].provider, 'cloudflare_email');
  assert.equal(messages[0].provider_message_id, '<cf-message-1@example.test>');
  assert.equal(messages[0].attachment_metadata[0].filename, 'inspection.pdf');
  assert.equal((await repository.list('channel_identities'))[0].external_id, 'buyer@example.test');
});

test('Cloudflare email webhook rejects modified raw payload signature and unsupported recipients', async () => {
  const { webhookService } = createHarness();
  webhookService.env = {
    CLOUDFLARE_EMAIL_INBOUND_SECRET: 'cloudflare-inbound-secret',
    CLOUDFLARE_EMAIL_ALLOWED_RECIPIENTS: 'support@example.test',
  };
  const payload = createCloudflareEmailPayload();
  const signed = signCloudflarePayload(payload);
  const modified = createCloudflareEmailPayload({ text: 'tampered body' });
  await assert.rejects(() => webhookService.handleWebhook('cloudflare', 'email', modified, {
    rawBody: JSON.stringify(modified),
    headers: signed.headers,
  }), (error) => error.statusCode === 403 && /Webhook verification failed/.test(error.message));

  const unsupported = createCloudflareEmailPayload({ message_id: '<cf-message-2@example.test>', recipient: 'sales@example.test' });
  const unsupportedSigned = signCloudflarePayload(unsupported, 'cloudflare-inbound-secret', { nonce: 'nonce-2' });
  await assert.rejects(() => webhookService.handleWebhook('cloudflare', 'email', unsupported, {
    rawBody: unsupportedSigned.rawBody,
    headers: unsupportedSigned.headers,
  }), /recipient is not supported/);
});

test('Cloudflare email webhook rejects expired timestamps and unsafe attachments', async () => {
  const { webhookService } = createHarness();
  webhookService.env = {
    CLOUDFLARE_EMAIL_INBOUND_SECRET: 'cloudflare-inbound-secret',
    CLOUDFLARE_EMAIL_ALLOWED_RECIPIENTS: 'support@example.test',
  };
  const payload = createCloudflareEmailPayload();
  const expired = signCloudflarePayload(payload, 'cloudflare-inbound-secret', { timestamp: Math.floor(Date.now() / 1000) - 1000, nonce: 'nonce-expired' });
  await assert.rejects(() => webhookService.handleWebhook('cloudflare', 'email', payload, {
    rawBody: expired.rawBody,
    headers: expired.headers,
  }), (error) => error.statusCode === 403 && /Webhook verification failed/.test(error.message));

  const unsafe = createCloudflareEmailPayload({ message_id: '<cf-message-3@example.test>', attachments: [{ filename: 'payload.js', size: 1 }] });
  const unsafeSigned = signCloudflarePayload(unsafe, 'cloudflare-inbound-secret', { nonce: 'nonce-unsafe' });
  await assert.rejects(() => webhookService.handleWebhook('cloudflare', 'email', unsafe, {
    rawBody: unsafeSigned.rawBody,
    headers: unsafeSigned.headers,
  }), /attachment type is not allowed/);
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

test('notification insert retries with generated id for legacy TEXT queue shape without a database default', async () => {
  const insertedRows = [];
  const fakeClient = {
    from(table) {
      return {
        insert(row) {
          insertedRows.push({ table, row });
          return {
            select() {
              return {
                async single() {
                  if (table === 'notification_queue' && row.id === undefined) {
                    return {
                      data: null,
                      error: {
                        message: 'null value in column "id" of relation "notification_queue" violates not-null constraint',
                      },
                    };
                  }
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const repository = new CommunicationRepository({ client: fakeClient });
  const inserted = await repository.insert('notification_queue', {
    recipient_id: 'legacy-text-user',
    recipient_user_id: 'legacy-text-user',
    channel: 'in_app',
    status: 'queued',
    dedupe_key: 'legacy-text-dedupe',
  });

  assert.equal(insertedRows.length, 2);
  assert.equal(insertedRows[0].row.id, undefined);
  assert.match(inserted.id, /^[0-9a-f-]{36}$/);
  assert.equal(inserted.dedupe_key, 'legacy-text-dedupe');
  assert.equal(insertedRows[1].row.id, inserted.id);
});

test('event worker prefers pooler connection strings and skips interval polling in Vercel by default', () => {
  assert.match(eventWorkerFile, /process\.env\.EVENT_WORKER_DATABASE_URL/);
  assert.match(eventWorkerFile, /process\.env\.SUPABASE_POOLER_DB_URL/);
  assert.match(eventWorkerFile, /process\.env\.SUPABASE_TRANSACTION_POOLER_URL/);
  assert.match(eventWorkerFile, /process\.env\.DATABASE_URL/);
  assert.match(eventWorkerFile, /process\.env\.SUPABASE_DB_URL/);
  assert.match(eventWorkerFile, /VERCEL/);
  assert.match(eventWorkerFile, /EVENT_WORKER_INTERVAL_ENABLED/);
  assert.match(eventWorkerFile, /shouldStartInterval\(\)/);
});

test('memory repository atomically claims due notifications and recovers stale processing locks', async () => {
  const { repository, notificationService, threadService } = createHarness();
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'claim-user', thread_type: 'support' })).thread;
  const first = (await notificationService.queueNotification({
    recipientUserId: 'claim-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'claim one' },
    dedupeParts: ['claim', 'one'],
  })).notification;
  const stale = (await notificationService.queueNotification({
    recipientUserId: 'claim-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'claim stale' },
    dedupeParts: ['claim', 'stale'],
  })).notification;
  await repository.updateById('notification_queue', stale.id, {
    status: 'processing',
    locked_at: new Date(Date.now() - 60_000).toISOString(),
    locked_by: 'old-worker',
  });

  const claimed = await repository.claimDueNotifications({ workerId: 'worker-a', limit: 5, staleAfterSeconds: 1 });
  assert.equal(claimed.length, 2);
  const claimedFirst = await repository.findOne('notification_queue', { id: first.id });
  const claimedStale = await repository.findOne('notification_queue', { id: stale.id });
  assert.equal(claimedFirst.status, 'processing');
  assert.equal(claimedFirst.locked_by, 'worker-a');
  assert.equal(claimedFirst.attempt_count, 1);
  assert.equal(claimedStale.locked_by, 'worker-a');
});

test('processDueNotifications uses claimed rows without double-incrementing attempts', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'in_app' });
  const { repository, notificationService, deliveryWorker, threadService } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'claim-send-user', thread_type: 'support' })).thread;
  const { notification } = await notificationService.queueNotification({
    recipientUserId: 'claim-send-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'claim send' },
  });
  const processed = await deliveryWorker.processDueNotifications({ limit: 1 });
  const row = await repository.findOne('notification_queue', { id: notification.id });
  assert.equal(processed.length, 1);
  assert.equal(row.status, 'delivered');
  assert.equal(row.attempt_count, 1);
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

test('provider delivery receipt updates attempt, notification, and message status', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'push' });
  const { repository, notificationService, deliveryWorker, threadService, webhookService } = createHarness({ adapter });
  webhookService.env.CARUP_CHANNEL_WEBHOOK_SECRET = 'receipt-secret';
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'receipt-user', thread_type: 'support' })).thread;
  const { notification } = await notificationService.queueNotification({
    recipientUserId: 'receipt-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'push',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'receipt' },
    payload: { expo_push_token: 'ExponentPushToken[test]' },
  });
  await deliveryWorker.deliverNotification(notification);
  const attempt = (await repository.list('message_delivery_attempts'))[0];
  const receipt = await webhookService.handleWebhook('expo', 'push', {
    data: { [attempt.provider_message_id]: { status: 'ok' } },
  }, {
    headers: { 'x-channel-webhook-secret': 'receipt-secret' },
  });
  const queueRow = await repository.findOne('notification_queue', { id: notification.id });
  const messageRow = await repository.findOne('messages', { id: notification.message_id });
  assert.equal(receipt.receipt_count, 1);
  assert.equal(queueRow.status, 'delivered');
  assert.equal(messageRow.status, 'delivered');
});

test('valid SendGrid signed event webhook is accepted and tampered payload is rejected', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const { repository, webhookService } = createHarness();
  webhookService.env = { SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY: publicPem };
  await repository.insert('message_delivery_attempts', {
    notification_id: 'sendgrid-notification-1',
    message_id: null,
    attempt_number: 1,
    provider: 'sendgrid',
    channel: 'email',
    provider_message_id: 'sg-message-1',
    status: 'sent',
    started_at: new Date().toISOString(),
  });
  await repository.insert('notification_queue', {
    id: 'sendgrid-notification-1',
    recipient_user_id: 'sendgrid-user',
    notification_type: 'email',
    channel: 'email',
    status: 'sent',
    dedupe_key: 'sendgrid-notification-1',
    scheduled_at: new Date().toISOString(),
    max_attempts: 5,
  });
  const payload = [{ event: 'delivered', sg_message_id: 'sg-message-1', custom_args: { notification_id: 'sendgrid-notification-1' } }];
  const rawBody = JSON.stringify(payload);
  const timestamp = '1782240000';
  const signature = crypto.sign('sha256', Buffer.from(`${timestamp}${rawBody}`), privateKey).toString('base64');
  const result = await webhookService.handleWebhook('sendgrid', 'email', payload, {
    rawBody,
    headers: {
      'x-twilio-email-event-webhook-timestamp': timestamp,
      'x-twilio-email-event-webhook-signature': signature,
    },
  });
  assert.equal(result.receipt_count, 1);
  assert.equal((await repository.findOne('notification_queue', { id: 'sendgrid-notification-1' })).status, 'delivered');
  await assert.rejects(() => webhookService.handleWebhook('sendgrid', 'email', [{ event: 'bounce', sg_message_id: 'sg-message-1' }], {
    rawBody: JSON.stringify([{ event: 'bounce', sg_message_id: 'sg-message-1' }]),
    headers: {
      'x-twilio-email-event-webhook-timestamp': timestamp,
      'x-twilio-email-event-webhook-signature': signature,
    },
  }), (error) => error.statusCode === 403 && /Webhook verification failed/.test(error.message));
});

test('valid Twilio status callback signature updates receipt and invalid signature is rejected', async () => {
  const { repository, webhookService } = createHarness();
  webhookService.env = {
    TWILIO_AUTH_TOKEN: 'twilio-auth-token',
    TWILIO_STATUS_CALLBACK_URL: 'https://api.example.test/api/communications/webhooks/twilio/sms',
  };
  await repository.insert('message_delivery_attempts', {
    notification_id: 'twilio-notification-1',
    message_id: null,
    attempt_number: 1,
    provider: 'twilio',
    channel: 'sms',
    provider_message_id: 'SM123',
    status: 'sent',
    started_at: new Date().toISOString(),
  });
  await repository.insert('notification_queue', {
    id: 'twilio-notification-1',
    recipient_user_id: 'twilio-user',
    notification_type: 'sms',
    channel: 'sms',
    status: 'sent',
    dedupe_key: 'twilio-notification-1',
    scheduled_at: new Date().toISOString(),
    max_attempts: 5,
  });
  const body = { MessageSid: 'SM123', MessageStatus: 'delivered' };
  const signatureBase = `${webhookService.env.TWILIO_STATUS_CALLBACK_URL}MessageSidSM123MessageStatusdelivered`;
  const signature = crypto.createHmac('sha1', webhookService.env.TWILIO_AUTH_TOKEN).update(signatureBase).digest('base64');
  const result = await webhookService.handleWebhook('twilio', 'sms', body, {
    headers: { 'x-twilio-signature': signature },
  });
  assert.equal(result.receipt_count, 1);
  assert.equal((await repository.findOne('notification_queue', { id: 'twilio-notification-1' })).status, 'delivered');
  await assert.rejects(() => webhookService.handleWebhook('twilio', 'sms', { MessageSid: 'SM999', MessageStatus: 'failed' }, {
    headers: { 'x-twilio-signature': signature },
  }), (error) => error.statusCode === 403 && /Webhook verification failed/.test(error.message));
});

test('internal communication processor requires worker secret and processes bounded batch', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'in_app' });
  const { repository, notificationService, deliveryWorker, threadService } = createHarness({ adapter });
  const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'worker-user', thread_type: 'support' })).thread;
  await notificationService.queueNotification({
    recipientUserId: 'worker-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'worker route' },
  });
  process.env.COMMUNICATION_WORKER_SECRET = 'worker-secret';
  const router = createCommunicationRouter({
    services: {
      deliveryWorker,
      adapterRegistry: { health: () => [] },
    },
  });
  const rejected = await invokeRouter(router, {
    method: 'POST',
    url: '/api/internal/communications/process',
    originalUrl: '/api/internal/communications/process',
    headers: { 'x-communication-worker-secret': 'wrong-secret' },
    body: { limit: 1 },
    query: {},
  });
  const accepted = await invokeRouter(router, {
    method: 'POST',
    url: '/api/internal/communications/process',
    originalUrl: '/api/internal/communications/process',
    headers: { 'x-communication-worker-secret': 'worker-secret' },
    body: { limit: 1 },
    query: {},
  });
  await notificationService.queueNotification({
    recipientUserId: 'worker-user',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'in_app',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'worker route get' },
    dedupeParts: ['worker-route-get'],
  });
  const acceptedGet = await invokeRouter(router, {
    method: 'GET',
    url: '/api/internal/communications/process',
    originalUrl: '/api/internal/communications/process?limit=1',
    headers: { authorization: 'Bearer worker-secret' },
    body: {},
    query: { limit: '1' },
  });
  delete process.env.COMMUNICATION_WORKER_SECRET;
  assert.equal(rejected.statusCode, 401);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.processed, 1);
  assert.equal(acceptedGet.statusCode, 200);
  assert.equal(acceptedGet.body.processed, 1);
  assert.equal((await repository.list('notification_queue')).every((row) => row.status === 'delivered'), true);
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
  await preferenceService.updatePreferences('user-1', {
    user_id: 'attacker-user',
    tenant_id: 'attacker-tenant',
    marketing_enabled: false,
    whatsapp_enabled: true,
    in_app_enabled: true,
  }, 'tenant-1');
  const prefs = await preferenceService.getPreferences('user-1', 'tenant-1');
  assert.equal(prefs.user_id, 'user-1');
  assert.equal(prefs.tenant_id, 'tenant-1');
  assert.equal(await preferenceService.repository.findOne('communication_preferences', { user_id: 'attacker-user', tenant_id: 'attacker-tenant' }), null);
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
  assert.equal(securityFile.includes('/api\\/internal\\/communications\\/process'), true);
});

test('communication router registers Meta GET webhook verification endpoint and raw body handoff', () => {
  assert.equal(communicationRouteFile.includes("router.get('/api/communications/webhooks/:provider/:channel'"), true);
  assert.equal(communicationRouteFile.includes('verifyMetaCallback'), true);
  assert.equal(communicationRouteFile.includes('rawBody: req.rawBody'), true);
  assert.equal(serverFile.includes('verify: (req, _res, buf)'), true);
  assert.equal(serverFile.includes('communications\\/webhooks\\/[^/]+\\/[^/]+'), true);
});

test('Cloudflare Worker project exposes fetch, email, queue, and scheduled handlers', () => {
  assert.equal(cloudflareWorkerFile.includes('async email(message, env, ctx)'), true);
  assert.equal(cloudflareWorkerFile.includes('async queue(batch, env)'), true);
  assert.equal(cloudflareWorkerFile.includes('async scheduled(controller, env, ctx)'), true);
  assert.equal(cloudflareWorkerFile.includes('/api/internal/communications/process'), true);
  assert.equal(cloudflareWorkerFile.includes('/api/communications/webhooks/cloudflare/email'), true);
  assert.equal(cloudflareWorkerFile.includes('x-carup-cloudflare-signature'), true);
});

// ── Issue #110: Automatic Telegram delivery ────────────────────────────────────

test('Vercel cron does not use per-minute schedule and Supabase pg_cron handles every-minute delivery', () => {
  // Vercel Hobby plan does not support sub-daily cron schedules. The per-minute
  // schedule MUST live in Supabase pg_cron, not vercel.json — otherwise the
  // backend deployment fails on the Hobby plan.
  const crons = backendVercelConfig?.crons || [];
  const minuteCron = crons.find((c) => c.schedule === '* * * * *');
  assert.equal(minuteCron, undefined, 'backend/vercel.json must not have a per-minute cron (breaks Vercel Hobby plan)');

  // Supabase cron migration must carry the every-minute schedule
  assert.ok(supabaseCronMigrationSql.includes('carup-communication-worker-every-minute'), 'migration must define the named cron job');
  assert.ok(supabaseCronMigrationSql.includes("'* * * * *'"), 'migration must use every-minute schedule');
  assert.ok(supabaseCronMigrationSql.includes('pg_cron'), 'migration must reference pg_cron extension');
  assert.ok(supabaseCronMigrationSql.includes('pg_net'), 'migration must reference pg_net extension');
  assert.ok(supabaseCronMigrationSql.includes('CARUP_WORKER_ENDPOINT_URL'), 'must read endpoint URL from Vault');
  assert.ok(supabaseCronMigrationSql.includes('CARUP_WORKER_SECRET'), 'must read secret from Vault');
  assert.ok(supabaseCronMigrationSql.includes('cron.unschedule'), 'must include idempotent unschedule step');
  assert.ok(supabaseCronMigrationSql.includes('+migrate Down') || supabaseCronMigrationSql.includes('migrate Down'), 'must have rollback section');
  assert.ok(supabaseCronMigrationSql.includes('get_communication_scheduler_health'), 'must include scheduler health RPC function');
});

test('staging and production environments use real Telegram adapter when CARUP_TELEGRAM_BOT_TOKEN is set', () => {
  const stagingRegistry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'staging', CARUP_TELEGRAM_BOT_TOKEN: 'test-token' } });
  const stagingAdapter = stagingRegistry.get('telegram');
  assert.equal(stagingAdapter.provider, 'telegram_bot_api', 'staging must use real Telegram adapter');
  assert.equal(stagingAdapter.validateConfiguration?.({ CARUP_TELEGRAM_BOT_TOKEN: 'test-token' }).mode, 'real');

  const productionRegistry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'production', CARUP_TELEGRAM_BOT_TOKEN: 'test-token' } });
  assert.equal(productionRegistry.get('telegram').provider, 'telegram_bot_api');

  const testRegistry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'test' } });
  assert.equal(testRegistry.get('telegram').validateConfiguration?.().mode, 'fake', 'test env still uses fake');
});

test('assertRealTelegramAdapter throws when Telegram bot token set but fake adapter active in staging', () => {
  const fakeRegistryWithToken = {
    get: () => new FakeCommunicationAdapter({ channel: 'telegram', provider: 'fake' }),
  };
  assert.throws(
    () => assertRealTelegramAdapter(fakeRegistryWithToken, { NODE_ENV: 'staging', CARUP_TELEGRAM_BOT_TOKEN: 'test-token' }),
    /FATAL.*fake/i,
    'must throw when staging uses fake adapter with bot token configured'
  );
});

test('assertRealTelegramAdapter is a no-op in test environment regardless of bot token', () => {
  const fakeRegistry = { get: () => new FakeCommunicationAdapter({ channel: 'telegram' }) };
  assert.doesNotThrow(
    () => assertRealTelegramAdapter(fakeRegistry, { NODE_ENV: 'test', CARUP_TELEGRAM_BOT_TOKEN: 'test-token' }),
    'must not throw in test environment'
  );
  assert.doesNotThrow(
    () => assertRealTelegramAdapter(fakeRegistry, { NODE_ENV: 'staging' }),
    'must not throw when CARUP_TELEGRAM_BOT_TOKEN is not set'
  );
  assert.doesNotThrow(
    () => assertRealTelegramAdapter(fakeRegistry, { NODE_ENV: 'staging', COMMUNICATION_FAKE_ADAPTERS_ENABLED: 'true', CARUP_TELEGRAM_BOT_TOKEN: 'tk' }),
    'must not throw when COMMUNICATION_FAKE_ADAPTERS_ENABLED=true'
  );
});

test('COMMUNICATION_REAL_ADAPTERS=true forces real adapters regardless of NODE_ENV', () => {
  const registry = createDefaultAdapterRegistry({ env: { NODE_ENV: 'development', COMMUNICATION_REAL_ADAPTERS: 'true', CARUP_TELEGRAM_BOT_TOKEN: 'tk' } });
  assert.equal(registry.get('telegram').provider, 'telegram_bot_api');
});

test('worker health endpoint is registered in admin communication routes and reports supabase_cron', () => {
  assert.ok(adminCommunicationRouteFile.includes('/api/admin/communications/worker/health'), 'health endpoint must be registered');
  assert.ok(adminCommunicationRouteFile.includes('sla_threshold_seconds'), 'must include SLA threshold field');
  assert.ok(adminCommunicationRouteFile.includes('oldest_queued_seconds'), 'must include oldest queued age');
  assert.ok(adminCommunicationRouteFile.includes('telegram'), 'must include telegram adapter status');
  assert.ok(adminCommunicationRouteFile.includes('supabase_cron'), 'must report scheduler_type=supabase_cron');
  assert.ok(adminCommunicationRouteFile.includes('get_communication_scheduler_health'), 'must call pg_cron health RPC');
  assert.ok(adminCommunicationRouteFile.includes('stale_lock_count'), 'must include stale lock count from RPC');
  assert.ok(adminCommunicationRouteFile.includes('inspect'), 'must include observability table references');
  assert.ok(adminCommunicationRouteFile.includes('cron.job'), 'must reference cron.job inspection table');
  assert.ok(adminCommunicationRouteFile.includes('net._http_response'), 'must reference pg_net response table');
});

test('communication worker endpoint includes correlation_id and timestamps in response', () => {
  assert.ok(communicationRouteFile.includes('correlation_id'), 'response must include correlation_id');
  assert.ok(communicationRouteFile.includes('invoked_at'), 'response must include invoked_at timestamp');
  assert.ok(communicationRouteFile.includes('completed_at'), 'response must include completed_at timestamp');
  assert.ok(communicationRouteFile.includes('JSON.stringify'), 'must emit structured JSON logs');
  assert.ok(communicationRouteFile.includes('communication_worker_invoked'), 'must log invocation event');
  assert.ok(communicationRouteFile.includes('communication_worker_completed'), 'must log completion event');
});

test('worker health endpoint returns queue depth and adapter status from memory repository', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'telegram', provider: 'telegram' });
  const repository = new MemoryCommunicationRepository();
  const { threadService, notificationService } = createHarness({ adapter, repository });
  const thread = (await threadService.resolveOrCreateThread({
    primary_user_id: 'health-user',
    thread_type: 'support',
    primary_channel: 'telegram',
  })).thread;

  // Queue two notifications
  await notificationService.queueExistingMessage({
    recipientUserId: 'health-user',
    thread,
    message: { id: 'msg-health-1', content_text: 'hi', channel: 'telegram', direction: 'outbound' },
    channel: 'telegram',
    notificationType: 'admin_reply',
    templateKey: 'admin_reply_v1',
    dedupeParts: ['health', '1'],
  });
  await notificationService.queueExistingMessage({
    recipientUserId: 'health-user',
    thread,
    message: { id: 'msg-health-2', content_text: 'hi2', channel: 'telegram', direction: 'outbound' },
    channel: 'telegram',
    notificationType: 'admin_reply',
    templateKey: 'admin_reply_v1',
    dedupeParts: ['health', '2'],
  });

  const queued = await repository.list('notification_queue', { status: 'queued' });
  assert.equal(queued.length, 2, 'both notifications must be queued');

  // Simulate the health endpoint logic inline
  const processing = await repository.list('notification_queue', { status: 'processing' });
  const retryScheduled = await repository.list('notification_queue', { status: 'retry_scheduled' });
  const deadLetter = await repository.list('notification_queue', { status: 'dead_letter' });
  const health = {
    queue: {
      queued: queued.length,
      processing: processing.length,
      retry_scheduled: retryScheduled.length,
      dead_letter: deadLetter.length,
      depth: queued.length + processing.length + retryScheduled.length,
    },
  };
  assert.equal(health.queue.queued, 2);
  assert.equal(health.queue.depth, 2);
  assert.equal(health.queue.processing, 0);
  assert.equal(health.queue.dead_letter, 0);
});

test('automatic delivery processes a queued Telegram notification without manual command', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'telegram', provider: 'telegram' });
  const repository = new MemoryCommunicationRepository({}, { strictNotificationQueueColumns: true, legacyNotificationQueueIds: true });
  const { identityService, threadService, notificationService, deliveryWorker } = createHarness({ adapter, repository });

  const identity = await identityService.resolveOrCreateIdentity({
    channel: 'telegram',
    provider: 'telegram',
    external_id: 'auto-tg-110',
    normalized_address: 'auto-tg-110',
  });
  const thread = (await threadService.resolveOrCreateThread({
    thread_type: 'support',
    primary_channel: 'telegram',
    external_identity_id: identity.id,
  })).thread;

  const { message, notification } = await recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-110' },
    body: { message: 'Automatic Telegram delivery test.', channel: 'telegram', client_message_id: 'issue-110-auto' },
  });

  // Confirm message is queued — has NOT been sent yet
  assert.equal(notification.status, 'queued');
  assert.equal(message.status, 'queued');

  // Simulate what the Vercel cron calls: processDueNotifications
  const results = await deliveryWorker.processDueNotifications({ limit: 10 });

  assert.equal(results.length, 1, 'exactly one notification must be processed');
  assert.equal(results[0].status, 'sent', 'processDueNotifications must return sent');

  const updatedNotif = await repository.findOne('notification_queue', { id: notification.id });
  const updatedMsg = await repository.findOne('messages', { id: message.id });
  // Fake adapter returns providerStatus=delivered so the row may be 'sent' or 'delivered'
  assert.ok(['sent', 'delivered'].includes(updatedNotif.status), `notification must be sent or delivered, got ${updatedNotif.status}`);
  assert.ok(['sent', 'delivered'].includes(updatedMsg.status), `message must be sent or delivered, got ${updatedMsg.status}`);

  // Exactly one delivery attempt recorded
  const attempts = await repository.list('message_delivery_attempts');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].provider, 'telegram');
  assert.ok(attempts[0].provider_message_id, 'provider_message_id must be populated');
  assert.equal(attempts[0].status, 'sent');
});

test('overlapping cron calls do not duplicate Telegram delivery', async () => {
  const adapter = new FakeCommunicationAdapter({ channel: 'telegram', provider: 'telegram' });
  const repository = new MemoryCommunicationRepository({}, { legacyNotificationQueueIds: true });
  const { identityService, threadService, notificationService, deliveryWorker } = createHarness({ adapter, repository });

  const identity = await identityService.resolveOrCreateIdentity({
    channel: 'telegram',
    provider: 'telegram',
    external_id: 'overlap-tg-110',
    normalized_address: 'overlap-tg-110',
  });
  const thread = (await threadService.resolveOrCreateThread({
    thread_type: 'support',
    primary_channel: 'telegram',
    external_identity_id: identity.id,
  })).thread;

  const { notification } = await recordAdminThreadReply({
    services: { repository, threadService, notificationService },
    thread,
    actor: { id: 'admin-110-overlap' },
    body: { message: 'Only send once.', channel: 'telegram', client_message_id: 'issue-110-overlap' },
  });

  // Two concurrent cron invocations — only one should send
  const [r1, r2] = await Promise.all([
    deliveryWorker.processDueNotifications({ limit: 5 }),
    deliveryWorker.processDueNotifications({ limit: 5 }),
  ]);

  const allResults = [...r1, ...r2];
  const sentResults = allResults.filter((r) => r.notificationId === notification.id && r.status === 'sent');
  assert.equal(sentResults.length, 1, 'notification must be sent exactly once despite concurrent cron calls');

  const attempts = await repository.list('message_delivery_attempts');
  const telegramAttempts = attempts.filter((a) => String(a.notification_id) === String(notification.id));
  assert.equal(telegramAttempts.length, 1, 'exactly one delivery attempt must exist');
});
