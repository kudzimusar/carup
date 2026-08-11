import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
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
