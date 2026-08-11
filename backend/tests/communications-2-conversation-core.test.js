import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationConversationService } from '../services/communication/communicationConversationService.js';
import { CommunicationInboundService } from '../services/communication/communicationInboundService.js';

function createHarness() {
  const repository = new MemoryCommunicationRepository({
    marketplace_inquiries: [{
      id: 'inquiry-c2c-1',
      listing_id: 'VIN-C2C-001',
      seller_id: 'seller-1',
      buyer_id: null,
      guest_name: 'Physical Buyer',
      guest_email: 'buyer@example.test',
      guest_phone: '+263 77 123 4567',
      inquiry_type: 'vehicle_purchase_interest',
      message: 'C2C exact buyer inquiry 2026-08-11',
      source_channel: 'web',
      referral_code: 'REF-C2C',
      campaign_code: 'CMP-C2C',
      metadata: { preferred_contact: 'whatsapp', utm_source: 'owner-uat' },
    }],
  });
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const conversationService = new CommunicationConversationService({
    repository,
    threadService,
    identityService,
    notificationService,
  });
  const inboundService = new CommunicationInboundService({
    repository,
    identityService,
    threadService,
    notificationService,
    conversationService,
    referralChannelGateway: {
      async processInbound() {
        return { success: true, validation: null, reply: null };
      },
    },
  });
  return { repository, identityService, threadService, notificationService, conversationService, inboundService };
}

test('Marketplace inquiry becomes one canonical buyer↔seller conversation with exact text', async () => {
  const h = createHarness();
  const [result] = await h.conversationService.canonicalizeMarketplaceInquiry({
    id: 'event-c2c-1',
    event_type: 'marketplace.inquiry.created',
    payload: { inquiryId: 'inquiry-c2c-1', sellerId: 'seller-1', listingId: 'VIN-C2C-001' },
  });

  assert.equal(result.canonical, true);
  assert.equal(result.thread.thread_type, 'marketplace_inquiry');
  assert.equal(result.thread.business_workflow, 'marketplace');
  assert.equal(result.thread.subject_id, 'inquiry-c2c-1');
  assert.equal(result.thread.marketplace_listing_id, 'VIN-C2C-001');
  assert.equal(result.message.content_text, 'C2C exact buyer inquiry 2026-08-11');
  assert.equal(result.message.content_json.original_authoritative, true);

  const participants = h.repository.rows('message_participants').filter((row) => row.thread_id === result.thread.id && !row.left_at);
  assert.equal(participants.length, 2);
  assert.equal(participants.find((row) => row.user_id === 'seller-1')?.stakeholder_role, 'seller');
  const buyer = participants.find((row) => row.stakeholder_role === 'buyer');
  assert.ok(buyer?.external_identity_id);

  const identity = h.repository.rows('channel_identities').find((row) => row.id === buyer.external_identity_id);
  assert.equal(identity.normalized_address, '+263771234567');
  assert.equal(identity.external_id, '+263 77 123 4567');
  assert.equal(identity.consent_status, 'implied_transactional');

  const binding = h.repository.rows('conversation_channel_bindings')[0];
  assert.equal(binding.thread_id, result.thread.id);
  assert.equal(binding.channel, 'whatsapp');
  assert.equal(binding.transactional_consent, true);
  assert.equal(binding.marketing_consent, false);
});

test('seller reply queues exact WhatsApp delivery and physical-style WhatsApp reply returns to same conversation', async () => {
  const h = createHarness();
  const [created] = await h.conversationService.canonicalizeMarketplaceInquiry({
    id: 'event-c2c-2',
    event_type: 'marketplace.inquiry.created',
    payload: { inquiryId: 'inquiry-c2c-1', sellerId: 'seller-1', listingId: 'VIN-C2C-001' },
  });

  const sellerText = 'C2C exact seller reply 2026-08-11';
  const sent = await h.conversationService.sendParticipantMessage(created.thread.id, { id: 'seller-1' }, { message: sellerText });
  assert.equal(sent.message.content_text, sellerText);
  const whatsappDelivery = sent.deliveries.find((row) => row.channel === 'whatsapp');
  assert.ok(whatsappDelivery, 'seller reply must queue the buyer WhatsApp binding');

  const queued = h.repository.rows('notification_queue').find((row) => row.id === whatsappDelivery.notification_id);
  assert.equal(queued.channel, 'whatsapp');
  assert.equal(queued.message, sellerText);
  assert.equal(queued.payload.phone_number, '+263771234567');
  assert.equal(queued.metadata.transactional, true);

  const physicalReply = 'C2C exact physical WhatsApp return 2026-08-11';
  const inbound = await h.inboundService.ingest({
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    externalSenderId: '263771234567',
    providerMessageId: 'wamid.c2c-return-1',
    text: physicalReply,
  }, { gateway_trusted: true });

  assert.equal(inbound.same_thread_return, true);
  assert.equal(inbound.thread.id, created.thread.id);
  assert.equal(inbound.message.thread_id, created.thread.id);
  assert.equal(inbound.message.content_text, physicalReply);
  assert.equal(inbound.message.content_json.original_authoritative, true);
  assert.equal(h.repository.rows('message_threads').length, 1, 'no shadow provider thread may be created');

  const binding = h.repository.rows('conversation_channel_bindings')[0];
  assert.equal(binding.last_outbound_message_id, sent.message.id);
  assert.equal(binding.last_inbound_message_id, inbound.message.id);
});

test('participant authorization fails closed for non-participants', async () => {
  const h = createHarness();
  const [created] = await h.conversationService.canonicalizeMarketplaceInquiry({
    event_type: 'marketplace.inquiry.created',
    payload: { inquiryId: 'inquiry-c2c-1', sellerId: 'seller-1', listingId: 'VIN-C2C-001' },
  });

  await assert.rejects(
    () => h.conversationService.getConversation(created.thread.id, { id: 'attacker-user' }),
    (error) => error?.statusCode === 404 && /not found/i.test(error.message),
  );

  const sellerView = await h.conversationService.getConversation(created.thread.id, { id: 'seller-1' });
  assert.equal(sellerView.messages[0].text, 'C2C exact buyer inquiry 2026-08-11');
  assert.equal(sellerView.participants.some((participant) => Object.hasOwn(participant, 'external_identity_id')), false);
});

test('identity normalization resolves +263 and 263 to one stored identity', async () => {
  const h = createHarness();
  const first = await h.identityService.resolveOrCreateIdentity({
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    external_id: '+263 77 123 4567',
  });
  const second = await h.identityService.resolveOrCreateIdentity({
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    external_id: '263771234567',
  });
  assert.equal(second.id, first.id);
  assert.equal(h.repository.rows('channel_identities').length, 1);
  assert.equal(second.normalized_address, '+263771234567');
});
