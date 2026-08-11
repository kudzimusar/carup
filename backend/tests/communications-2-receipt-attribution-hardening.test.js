import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationPreferenceService } from '../services/communication/communicationPreferenceService.js';
import { CommunicationCanonicalNotificationService } from '../services/communication/communicationCanonicalNotificationService.js';
import { CommunicationCanonicalWebhookService } from '../services/communication/communicationCanonicalWebhookService.js';

test('ambiguous provider receipt never mutates an arbitrary CarUp message', async () => {
  const repository = new MemoryCommunicationRepository({
    message_threads: [
      { id: 'thread-r1', thread_key: 'receipt-r1', thread_type: 'support', status: 'open', primary_channel: 'whatsapp' },
      { id: 'thread-r2', thread_key: 'receipt-r2', thread_type: 'support', status: 'open', primary_channel: 'whatsapp' },
    ],
    messages: [
      { id: 'msg-r1', thread_id: 'thread-r1', direction: 'outbound', channel: 'whatsapp', status: 'sent', content_text: 'First' },
      { id: 'msg-r2', thread_id: 'thread-r2', direction: 'outbound', channel: 'whatsapp', status: 'sent', content_text: 'Second' },
    ],
    notification_queue: [
      { id: 'notif-r1', thread_id: 'thread-r1', message_id: 'msg-r1', channel: 'whatsapp', status: 'sent' },
      { id: 'notif-r2', thread_id: 'thread-r2', message_id: 'msg-r2', channel: 'whatsapp', status: 'sent' },
    ],
    message_delivery_attempts: [
      { id: 'attempt-r1', notification_id: 'notif-r1', message_id: 'msg-r1', provider: 'meta_whatsapp_cloud_api', channel: 'whatsapp', provider_message_id: 'wamid.same-provider-id', status: 'sent' },
      { id: 'attempt-r2', notification_id: 'notif-r2', message_id: 'msg-r2', provider: 'meta_whatsapp_cloud_api', channel: 'whatsapp', provider_message_id: 'wamid.same-provider-id', status: 'sent' },
    ],
  });
  const service = new CommunicationCanonicalWebhookService({ repository, inboundService: {} });
  const result = await service.applyDeliveryReceipt({
    provider: 'meta_whatsapp_cloud_api',
    channel: 'whatsapp',
    providerMessageId: 'wamid.same-provider-id',
    status: 'delivered',
    rawStatus: 'delivered',
  });

  assert.equal(result.ambiguous, true);
  assert.equal(result.status, 'unattributed');
  assert.equal(repository.rows('messages').find((row) => row.id === 'msg-r1').status, 'sent');
  assert.equal(repository.rows('messages').find((row) => row.id === 'msg-r2').status, 'sent');
  assert.equal(repository.rows('notification_queue').find((row) => row.id === 'notif-r1').status, 'sent');
  assert.equal(repository.rows('notification_queue').find((row) => row.id === 'notif-r2').status, 'sent');
});

test('unique provider receipt updates only its exact canonical delivery', async () => {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{ id: 'thread-unique', thread_key: 'receipt-unique', thread_type: 'support', status: 'open', primary_channel: 'whatsapp' }],
    messages: [{ id: 'msg-unique', thread_id: 'thread-unique', direction: 'outbound', channel: 'whatsapp', status: 'sent', content_text: 'Unique' }],
    notification_queue: [{ id: 'notif-unique', thread_id: 'thread-unique', message_id: 'msg-unique', channel: 'whatsapp', status: 'sent' }],
    message_delivery_attempts: [{ id: 'attempt-unique', notification_id: 'notif-unique', message_id: 'msg-unique', provider: 'meta_whatsapp_cloud_api', channel: 'whatsapp', provider_message_id: 'wamid.unique', status: 'sent', response_metadata: {} }],
  });
  const service = new CommunicationCanonicalWebhookService({ repository, inboundService: {} });
  const result = await service.applyDeliveryReceipt({
    provider: 'meta_whatsapp_cloud_api',
    channel: 'whatsapp',
    providerMessageId: 'wamid.unique',
    status: 'delivered',
    rawStatus: 'delivered',
  });

  assert.equal(result.messageId, 'msg-unique');
  assert.equal(result.notificationId, 'notif-unique');
  assert.equal(repository.rows('messages')[0].status, 'delivered');
  assert.equal(repository.rows('notification_queue')[0].status, 'delivered');
  assert.equal(repository.rows('message_delivery_attempts')[0].status, 'delivered');
});

test('terminal failed provider receipt advances to ordered fallback without creating a second semantic message', async () => {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: 'thread-receipt-fallback', thread_key: 'receipt-fallback', thread_type: 'marketplace_inquiry',
      status: 'open', primary_channel: 'whatsapp', priority: 'normal',
    }],
    messages: [{
      id: 'msg-receipt-fallback', thread_id: 'thread-receipt-fallback', direction: 'outbound',
      channel: 'whatsapp', status: 'sent', content_text: 'Exact seller reply', content_json: {},
    }],
    users: [{
      id: 'buyer-receipt-fallback', name: 'Buyer', email: 'receipt@example.com', phone: '+263771111111',
    }],
    communication_preferences: [{
      id: 'pref-receipt-fallback', user_id: 'buyer-receipt-fallback', tenant_id: null,
      transactional_enabled: true, in_app_enabled: true, email_enabled: true, whatsapp_enabled: true,
    }],
    notification_queue: [{
      id: 'notif-receipt-fallback', recipient_id: 'buyer-receipt-fallback', recipient_user_id: 'buyer-receipt-fallback',
      thread_id: 'thread-receipt-fallback', message_id: 'msg-receipt-fallback', channel: 'whatsapp',
      status: 'sent', title: 'CarUp conversation', message: 'Exact seller reply',
      metadata: { transactional: true, fallback_channels: ['email'], attempted_channels: ['whatsapp'] },
      payload: { phone_number: '263771111111' },
    }],
    message_delivery_attempts: [{
      id: 'attempt-receipt-fallback', notification_id: 'notif-receipt-fallback',
      message_id: 'msg-receipt-fallback', provider: 'meta_whatsapp_cloud_api',
      channel: 'whatsapp', provider_message_id: 'wamid.failed-fallback', status: 'sent', response_metadata: {},
    }],
  });
  const threadService = new CommunicationThreadService({ repository });
  const preferenceService = new CommunicationPreferenceService({ repository });
  const notificationService = new CommunicationCanonicalNotificationService({
    repository,
    threadService,
    preferenceService,
    templateService: { render: async () => ({}) },
  });
  const service = new CommunicationCanonicalWebhookService({
    repository,
    inboundService: {},
    notificationService,
  });

  const result = await service.applyDeliveryReceipt({
    provider: 'meta_whatsapp_cloud_api',
    channel: 'whatsapp',
    providerMessageId: 'wamid.failed-fallback',
    status: 'failed',
    rawStatus: 'failed',
    errorCode: '131026',
    errorMessage: 'Undeliverable',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.fallbackQueued, true);
  assert.equal(result.fallbackChannel, 'email');
  assert.equal(repository.rows('messages').length, 1);
  assert.equal(repository.rows('messages')[0].status, 'queued');
  const fallback = repository.rows('notification_queue').find((row) => row.id !== 'notif-receipt-fallback');
  assert.equal(fallback.channel, 'email');
  assert.equal(fallback.message_id, 'msg-receipt-fallback');
  assert.equal(fallback.payload.email, 'receipt@example.com');
});
