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
import { CommunicationCanonicalConversationService } from '../services/communication/communicationCanonicalConversationService.js';
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
  assert.equal(h.repository.rows('messages').at(-1).content_text, 'Canonical seller message remains in CarUp even though delivery is suppressed');
  assert.equal(h.repository.rows('notification_queue').every((row) => row.status === 'suppressed'), true);
});
