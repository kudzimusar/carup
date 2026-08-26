import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationPreferenceService } from '../services/communication/communicationPreferenceService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationCanonicalNotificationService } from '../services/communication/communicationCanonicalNotificationService.js';
import { CommunicationCanonicalConversationService } from '../services/communication/communicationCanonicalConversationService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';

function canonicalHarness(seed = {}) {
  const repository = new MemoryCommunicationRepository(seed);
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const preferenceService = new CommunicationPreferenceService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService, preferenceService });
  const conversationService = new CommunicationCanonicalConversationService({
    repository, threadService, identityService, notificationService,
  });
  return { repository, threadService, preferenceService, notificationService, conversationService };
}

test('normal service factory activates the canonical conversation + receipt hardening implementations', () => {
  const repository = new MemoryCommunicationRepository();
  const services = createCommunicationServices({ repository });
  assert.equal(services.conversationService.constructor.name, 'CommunicationCanonicalConversationService');
  assert.equal(services.webhookService.constructor.name, 'CommunicationCanonicalWebhookService');
  assert.equal(services.deliveryWorker.notificationService, services.notificationService);
});

test('opening a conversation advances only that participant read cursor and preserves actual conversation_type', async () => {
  const h = canonicalHarness({
    message_threads: [{
      id: 'thread-read', thread_key: 'thread-read', thread_type: 'marketplace_inquiry',
      conversation_type: 'marketplace', business_workflow: 'marketplace', status: 'open', primary_channel: 'in_app',
    }],
    message_participants: [
      { id: 'p-seller', thread_id: 'thread-read', participant_type: 'user', user_id: 'seller-read', role: 'seller', stakeholder_role: 'seller', permissions: { read: true, send: true }, last_read_at: null },
      { id: 'p-buyer', thread_id: 'thread-read', participant_type: 'user', user_id: 'buyer-read', role: 'buyer', stakeholder_role: 'buyer', permissions: { read: true, send: true }, last_read_at: null },
    ],
    messages: [{
      id: 'msg-read', thread_id: 'thread-read', direction: 'inbound', sender_participant_id: 'p-buyer',
      channel: 'in_app', content_text: 'Unread inquiry', status: 'received', created_at: '2026-08-11T04:00:00.000Z',
    }],
  });

  const detail = await h.conversationService.getConversation('thread-read', { id: 'seller-read' });
  assert.equal(detail.thread.conversation_type, 'marketplace');
  assert.ok(h.repository.rows('message_participants').find((row) => row.id === 'p-seller').last_read_at);
  assert.equal(h.repository.rows('message_participants').find((row) => row.id === 'p-buyer').last_read_at, null);
});

test('suppressed external delivery is not counted as a delivery and does not advance channel binding recency', async () => {
  const h = canonicalHarness({
    message_threads: [{
      id: 'thread-suppress', thread_key: 'thread-suppress', thread_type: 'marketplace_inquiry',
      conversation_type: 'marketplace', business_workflow: 'marketplace', status: 'open', primary_channel: 'in_app', priority: 'normal',
    }],
    message_participants: [
      { id: 'p-seller-s', thread_id: 'thread-suppress', participant_type: 'user', user_id: 'seller-s', role: 'seller', stakeholder_role: 'seller', permissions: { read: true, send: true } },
      { id: 'p-buyer-s', thread_id: 'thread-suppress', participant_type: 'user', user_id: 'buyer-s', external_identity_id: 'id-wa-s', role: 'buyer', stakeholder_role: 'buyer', permissions: { read: true, send: true } },
    ],
    channel_identities: [{
      id: 'id-wa-s', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '263771234567', normalized_address: '263771234567', consent_status: 'implied_transactional',
    }],
    conversation_channel_bindings: [{
      id: 'bind-wa-s', thread_id: 'thread-suppress', participant_id: 'p-buyer-s', channel_identity_id: 'id-wa-s',
      channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', transactional_consent: true, marketing_consent: false,
      can_send: true, can_receive: true, is_primary: true, last_outbound_message_id: null, last_used_at: null,
    }],
    communication_preferences: [{
      id: 'pref-s', user_id: 'buyer-s', tenant_id: null, transactional_enabled: false, marketing_enabled: false,
      in_app_enabled: true, whatsapp_enabled: true, fallback_channels: ['in_app'],
    }],
  });

  const result = await h.conversationService.sendParticipantMessage('thread-suppress', { id: 'seller-s' }, {
    message: 'Canonical seller message remains in CarUp even though delivery is suppressed',
  });

  assert.equal(result.deliveries.length, 0, 'suppressed queues are not successful delivery routes');
  assert.equal(result.deliveries.suppressions.length, 2, 'in-app and WhatsApp suppression evidence is retained');
  assert.equal(h.repository.rows('conversation_channel_bindings')[0].last_outbound_message_id, null);
  assert.equal(h.repository.rows('conversation_channel_bindings')[0].last_used_at, null);
  const canonicalMessage = h.repository.rows('messages').at(-1);
  assert.equal(canonicalMessage.content_text, 'Canonical seller message remains in CarUp even though delivery is suppressed');
  assert.equal(canonicalMessage.status, 'suppressed');
  assert.deepEqual(canonicalMessage.content_json.suppression_reasons, ['transactional_disabled']);
  assert.equal(h.repository.rows('notification_queue').every((row) => row.status === 'suppressed'), true);
});

test('domain-event routing queues one primary channel and records ordered fallback instead of broadcasting', async () => {
  const repository = new MemoryCommunicationRepository({
    communication_templates: [{
      id: 'tpl-escrow-runtime', template_key: 'escrow_status_v1', business_workflow: 'safepay',
      stakeholder_audience: 'customer', classification: 'transactional', status: 'active',
    }],
    communication_template_versions: [{
      id: 'tpl-escrow-runtime-v1', template_id: 'tpl-escrow-runtime', version: 1, channel: 'default', language: 'en',
      subject_template: 'SafePay escrow update',
      body_template: 'SafePay escrow {{escrow_id}} is now {{status}}. This status comes from CarUp backend records.',
      required_variables: ['escrow_id', 'status'], optional_variables: [], approval_status: 'approved',
    }],
  });
  const services = createCommunicationServices({ repository });

  const queued = await services.notificationService.queueFromDomainEvent({
    id: 'event-no-broadcast',
    event_type: 'ESCROW_UPDATED',
    payload: {
      escrowId: 'escrow-no-broadcast',
      currentStatus: 'Escrowed',
      recipientUserId: 'buyer-no-broadcast',
    },
  });

  assert.equal(queued.length, 1, 'a single semantic event must have one initial delivery route');
  const rows = repository.rows('notification_queue');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, 'in_app');
  assert.equal(rows[0].metadata.routing_mode, 'single_primary_with_ordered_fallback');
  assert.deepEqual(rows[0].metadata.fallback_channels, ['push', 'email']);
  assert.equal(repository.rows('messages').length, 1, 'one semantic event creates one canonical outbound message');
  assert.equal(repository.rows('messages')[0].content_json.governed_template, true);
});

test('terminal provider failure advances exactly one canonical message to the next ordered fallback route', async () => {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: 'thread-fallback', thread_key: 'thread-fallback', thread_type: 'marketplace_inquiry',
      business_workflow: 'marketplace', status: 'open', primary_channel: 'whatsapp', priority: 'normal',
    }],
    messages: [{
      id: 'msg-fallback', thread_id: 'thread-fallback', direction: 'outbound', channel: 'whatsapp',
      content_text: 'Same semantic seller reply', content_json: {}, status: 'queued',
    }],
    users: [{
      id: 'buyer-fallback', name: 'Fallback Buyer', email: 'buyer@example.com', phone: '+263771234567',
    }],
    communication_preferences: [{
      id: 'pref-fallback', user_id: 'buyer-fallback', tenant_id: null,
      transactional_enabled: true, in_app_enabled: true, email_enabled: true,
      whatsapp_enabled: true, fallback_channels: ['email', 'in_app'],
    }],
    notification_queue: [{
      id: 'notif-primary', recipient_id: 'buyer-fallback', recipient_user_id: 'buyer-fallback',
      thread_id: 'thread-fallback', message_id: 'msg-fallback', event_id: 'event-fallback',
      type: 'conversation_message', notification_type: 'conversation_message',
      title: 'CarUp conversation', message: 'Same semantic seller reply', channel: 'whatsapp',
      status: 'queued', dedupe_key: 'primary-fallback', priority: 'normal', max_attempts: 1,
      // G2: a conversation_message is `conversational`. The fallback row inherits it by spreading
      // the parent payload, which is how the email fallback below gets a canonical family.
      payload: { phone_number: '263771234567', classification: 'conversational' },
      metadata: {
        transactional: true,
        fallback_channels: ['email', 'in_app'],
        attempted_channels: ['whatsapp'],
        routing_mode: 'single_primary_with_ordered_fallback',
        // G5: a real conversational producer attaches the exact recipient participant. The email
        // fallback row inherits this metadata, which is how the fallback Email gets an
        // authenticated Reply-To bound to the same person the WhatsApp message was for.
        recipient_participant_id: 'participant-fallback',
      },
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
  const registry = {
    get(channel) {
      if (channel === 'whatsapp') {
        return {
          provider: 'meta_whatsapp_cloud_api',
          async send() {
            return { accepted: false, retryable: false, errorCode: 'provider_rejected', errorMessage: 'simulated terminal rejection' };
          },
        };
      }
      if (channel === 'email') {
        return {
          provider: 'cloudflare_email',
          async send(input) {
            assert.equal(input.recipient.email, 'buyer@example.com');
            return { accepted: true, providerStatus: 'accepted', providerMessageId: 'email-fallback-1' };
          },
        };
      }
      return null;
    },
  };
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: registry,
    notificationService,
    replyTokenService: { issue: async () => ({ address: 'conversation+FALLBACKTOKEN0000000@mail.carup.dev', record: { id: 'tok-fallback' } }) },
    workerId: 'fallback-test-worker',
  });

  const first = await worker.deliverNotification(repository.rows('notification_queue')[0]);
  assert.equal(first.status, 'fallback_queued');
  assert.equal(first.fallbackChannel, 'email');

  const queues = repository.rows('notification_queue');
  assert.equal(queues.length, 2, 'fallback creates one additional delivery row, not a new semantic message');
  assert.equal(queues[0].status, 'dead_letter');
  assert.equal(queues[1].channel, 'email');
  assert.equal(queues[1].message_id, 'msg-fallback');
  assert.deepEqual(queues[1].metadata.fallback_channels, ['in_app']);
  assert.equal(repository.rows('messages').length, 1);
  assert.equal(repository.rows('messages')[0].status, 'queued', 'canonical message is not dead-lettered while fallback remains');

  const second = await worker.deliverNotification(queues[1]);
  assert.equal(second.status, 'sent');
  assert.equal(repository.rows('messages')[0].status, 'sent');
  assert.equal(repository.rows('message_delivery_attempts').length, 2);
});

test('canonical message dead-letters only after the ordered fallback sequence is exhausted and replay cannot resurrect it', async () => {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{
      id: 'thread-exhaust', thread_key: 'fallback-exhaust', thread_type: 'support',
      status: 'open', primary_channel: 'whatsapp', priority: 'normal',
    }],
    messages: [{
      id: 'msg-exhaust', thread_id: 'thread-exhaust', direction: 'outbound', channel: 'whatsapp',
      status: 'queued', content_text: 'One semantic message across exhausted routes', content_json: {},
    }],
    users: [{ id: 'buyer-exhaust', name: 'Fallback Buyer', email: 'exhaust@example.com', phone: '+263772222222' }],
    communication_preferences: [{
      id: 'pref-exhaust', user_id: 'buyer-exhaust', tenant_id: null,
      transactional_enabled: true, email_enabled: true, whatsapp_enabled: true, in_app_enabled: false,
    }],
    notification_queue: [{
      id: 'notif-exhaust-primary', recipient_id: 'buyer-exhaust', recipient_user_id: 'buyer-exhaust',
      thread_id: 'thread-exhaust', message_id: 'msg-exhaust', type: 'conversation_message',
      notification_type: 'conversation_message', title: 'CarUp conversation',
      message: 'One semantic message across exhausted routes', channel: 'whatsapp', status: 'queued',
      dedupe_key: 'exhaust-primary', priority: 'normal', max_attempts: 1,
      payload: { phone_number: '263772222222' },
      metadata: {
        transactional: true,
        fallback_channels: ['email'],
        attempted_channels: ['whatsapp'],
        routing_mode: 'single_primary_with_ordered_fallback',
      },
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
  const registry = {
    get(channel) {
      if (!['whatsapp', 'email'].includes(channel)) return null;
      return {
        provider: channel === 'whatsapp' ? 'meta_whatsapp_cloud_api' : 'cloudflare_email',
        async send() {
          return { accepted: false, retryable: false, errorCode: 'provider_rejected', errorMessage: `${channel} terminal rejection` };
        },
      };
    },
  };
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: registry,
    notificationService,
    workerId: 'fallback-exhaust-worker',
  });

  const primary = repository.rows('notification_queue')[0];
  const first = await worker.deliverNotification(primary);
  assert.equal(first.status, 'fallback_queued');
  assert.equal(repository.rows('messages')[0].status, 'queued');

  const emailFallback = repository.rows('notification_queue').find((row) => row.id !== primary.id);
  const second = await worker.deliverNotification(emailFallback);
  assert.equal(second.status, 'dead_letter');
  assert.equal(repository.rows('messages')[0].status, 'dead_letter', 'canonical message becomes terminal only after all governed routes fail');
  assert.equal(repository.rows('notification_queue').length, 2);

  const replay = await worker.markDeadLetter(primary, { errorCode: 'duplicate_failure_receipt', errorMessage: 'replayed primary failure' });
  assert.equal(replay.status, 'dead_letter');
  assert.equal(repository.rows('notification_queue').length, 2, 'failure replay cannot create duplicate fallback rows');
  assert.equal(repository.rows('messages')[0].status, 'dead_letter', 'failure replay cannot resurrect an exhausted message');
});
