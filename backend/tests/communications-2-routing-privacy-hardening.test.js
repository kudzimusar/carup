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
import { CommunicationConversationService } from '../services/communication/communicationConversationService.js';
import { CommunicationInboundService } from '../services/communication/communicationInboundService.js';

function harness() {
  const repository = new MemoryCommunicationRepository({
    marketplace_inquiries: [
      {
        id: 'inq-context-a', listing_id: 'VIN-A', seller_id: 'seller-a', buyer_id: null,
        guest_name: 'Same Physical Buyer', guest_phone: '+263 77 123 4567',
        inquiry_type: 'vehicle_purchase_interest', message: 'Inquiry A', source_channel: 'web',
        metadata: { preferred_contact: 'whatsapp' },
      },
      {
        id: 'inq-context-b', listing_id: 'VIN-B', seller_id: 'seller-b', buyer_id: null,
        guest_name: 'Same Physical Buyer', guest_phone: '263771234567',
        inquiry_type: 'vehicle_purchase_interest', message: 'Inquiry B', source_channel: 'web',
        metadata: { preferred_contact: 'whatsapp' },
      },
    ],
  });
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const preferenceService = new CommunicationPreferenceService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService, preferenceService });
  const conversationService = new CommunicationConversationService({ repository, threadService, identityService, notificationService });
  const inboundService = new CommunicationInboundService({
    repository, identityService, threadService, notificationService, conversationService,
    referralChannelGateway: { async processInbound() { return { success: true, validation: null, reply: null }; } },
  });
  return { repository, identityService, threadService, preferenceService, notificationService, conversationService, inboundService };
}

test('provider reply context beats recency when one WhatsApp identity has multiple active CarUp conversations', async () => {
  const h = harness();
  const [a] = await h.conversationService.canonicalizeMarketplaceInquiry({
    event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-context-a', sellerId: 'seller-a', listingId: 'VIN-A' },
  });
  const sentA = await h.conversationService.sendParticipantMessage(a.thread.id, { id: 'seller-a' }, { message: 'Seller A outbound' });

  // Simulate the provider receipt that the real worker records after Meta accepts the
  // outbound message. WhatsApp message.context.id will contain this value on reply.
  await h.repository.insert('message_delivery_attempts', {
    notification_id: 'notif-a', message_id: sentA.message.id, attempt_number: 1,
    provider: 'meta_whatsapp_cloud_api', channel: 'whatsapp',
    provider_message_id: 'wamid.provider-outbound-A', status: 'sent',
  });

  const [b] = await h.conversationService.canonicalizeMarketplaceInquiry({
    event_type: 'marketplace.inquiry.created', payload: { inquiryId: 'inq-context-b', sellerId: 'seller-b', listingId: 'VIN-B' },
  });
  await h.conversationService.sendParticipantMessage(b.thread.id, { id: 'seller-b' }, { message: 'Seller B newer outbound' });

  const inbound = await h.inboundService.ingest({
    channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
    externalSenderId: '263771234567',
    externalConversationId: 'wamid.provider-outbound-A',
    providerMessageId: 'wamid.physical-reply-A',
    text: 'I am replying specifically to Seller A',
  }, { gateway_trusted: true });

  assert.equal(inbound.same_thread_return, true);
  assert.equal(inbound.conversation_resolution, 'provider_reply_context');
  assert.equal(inbound.replied_to_message_id, sentA.message.id);
  assert.equal(inbound.thread.id, a.thread.id, 'provider reply context must win over the newer conversation binding');
  assert.notEqual(inbound.thread.id, b.thread.id);
  assert.equal(h.repository.rows('message_threads').length, 2, 'no shadow thread is created');
});

test('canonical existing-message delivery is suppressed when the participant mutes the conversation', async () => {
  const h = harness();
  const thread = await h.repository.insert('message_threads', {
    thread_key: 'mute-thread', thread_type: 'support', status: 'open', priority: 'normal', primary_channel: 'in_app',
  });
  await h.repository.insert('message_participants', {
    thread_id: thread.id, participant_type: 'user', user_id: 'muted-user', role: 'customer',
    stakeholder_role: 'customer', notification_muted: true,
  });
  const message = await h.repository.insert('messages', {
    thread_id: thread.id, direction: 'outbound', channel: 'in_app', content_text: 'Canonical message still exists', status: 'queued',
  });

  const result = await h.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'muted-user', channel: 'in_app', transactional: true,
  });
  assert.equal(result.suppressed, true);
  assert.equal(result.suppression_reason, 'participant_muted');
  assert.equal(result.notification.status, 'suppressed');
  assert.equal(message.content_text, 'Canonical message still exists', 'mute suppresses delivery, never the canonical message');
});

test('global transactional opt-out suppresses routine existing-message delivery', async () => {
  const h = harness();
  const thread = await h.repository.insert('message_threads', {
    tenant_id: null, thread_key: 'optout-thread', thread_type: 'support', status: 'open', priority: 'normal', primary_channel: 'in_app',
  });
  await h.repository.insert('message_participants', {
    thread_id: thread.id, participant_type: 'user', user_id: 'optout-user', role: 'customer', stakeholder_role: 'customer',
  });
  await h.repository.insert('communication_preferences', {
    user_id: 'optout-user', tenant_id: null, transactional_enabled: false, marketing_enabled: false,
    in_app_enabled: true, email_enabled: true, fallback_channels: ['in_app'],
  });
  const message = await h.repository.insert('messages', {
    thread_id: thread.id, direction: 'outbound', channel: 'in_app', content_text: 'Routine transactional message', status: 'queued',
  });

  const result = await h.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'optout-user', channel: 'in_app', transactional: true,
  });
  assert.equal(result.notification.status, 'suppressed');
  assert.equal(result.suppression_reason, 'transactional_disabled');
});

test('quiet hours are timezone-aware and keep in-app available while suppressing external interruption', () => {
  const h = harness();
  const prefs = {
    transactional_enabled: true,
    marketing_enabled: false,
    in_app_enabled: true,
    whatsapp_enabled: true,
    quiet_hours_start: '22:00:00',
    quiet_hours_end: '07:00:00',
    timezone: 'Asia/Tokyo',
  };
  // 2026-08-11T14:00Z = 23:00 JST.
  const at = new Date('2026-08-11T14:00:00Z');
  assert.equal(h.preferenceService.isInQuietHours(prefs, at), true);
  assert.equal(h.preferenceService.isChannelAllowed(prefs, 'in_app', { at }), true);
  assert.equal(h.preferenceService.isChannelAllowed(prefs, 'whatsapp', { at }), false);
  assert.equal(h.preferenceService.isChannelAllowed(prefs, 'whatsapp', { at, quietHoursBypass: true }), true);
});
