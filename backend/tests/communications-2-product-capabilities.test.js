import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { CommunicationMetaWhatsAppGovernedAdapter } from '../services/communication/communicationMetaWhatsAppGovernedAdapter.js';
import { CommunicationAnalyticsService } from '../services/communication/communicationAnalyticsService.js';
import { CommunicationAiRuntimeService } from '../services/communication/communicationAiRuntimeService.js';
import { CommunicationGeminiProvider } from '../services/communication/communicationGeminiProvider.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { createDefaultAdapterRegistry } from '../services/communication/adapters/providerAdapters.js';

function whatsappSeed({ recentInbound = false } = {}) {
  const now = new Date().toISOString();
  return {
    message_threads: [{ id: 'thread-1', thread_type: 'marketplace_inquiry', business_workflow: 'marketplace', status: 'open', primary_channel: 'in_app', created_at: now }],
    message_participants: [{ id: 'buyer-p', thread_id: 'thread-1', participant_type: 'external_contact', external_identity_id: 'wa-1', permissions: { read: true, send: true } }],
    channel_identities: [{ id: 'wa-1', channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', external_id: '263771234567', normalized_address: '263771234567' }],
    messages: [
      ...(recentInbound ? [{ id: 'in-1', thread_id: 'thread-1', direction: 'inbound', channel: 'whatsapp', content_text: 'Buyer reply', created_at: now }] : []),
      { id: 'out-1', thread_id: 'thread-1', direction: 'outbound', channel: 'in_app', content_text: 'Exact seller reply', created_at: now, content_json: {}, status: 'queued' },
    ],
    conversation_channel_bindings: [{
      id: 'binding-1',
      thread_id: 'thread-1',
      participant_id: 'buyer-p',
      channel_identity_id: 'wa-1',
      channel: 'whatsapp',
      provider: 'meta_whatsapp_cloud_api',
      transactional_consent: true,
      can_send: true,
      last_inbound_message_id: recentInbound ? 'in-1' : null,
      updated_at: now,
    }],
    notification_queue: [],
  };
}

function notificationService(repo, providerTemplateReference) {
  return new CommunicationProductNotificationService({
    repository: repo,
    threadService: {},
    preferenceService: { getPreferences: async () => ({}), isInQuietHours: () => false },
    templateService: {
      render: async (_key, variables) => ({
        templateId: 'tpl-1',
        templateVersionId: 'tplv-1',
        templateKey: 'conversation_reply_whatsapp_v1',
        subject: null,
        body: variables.message,
        data: variables,
        providerTemplateReference,
      }),
    },
  });
}

test('business-initiated WhatsApp fails closed when the 24h session is unproven and Meta template reference is not configured', async () => {
  const repo = new MemoryCommunicationRepository(whatsappSeed());
  const service = notificationService(repo, null);
  const result = await service.queueExistingMessage({
    thread: repo.rows('message_threads')[0],
    message: repo.rows('messages').find((row) => row.id === 'out-1'),
    recipientIdentityId: 'wa-1',
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    metadata: { recipient_participant_id: 'buyer-p' },
    payload: { phone_number: '263771234567' },
  });
  assert.equal(result.suppressed, true);
  assert.equal(result.suppression_reason, 'whatsapp_template_not_configured');
  assert.equal(result.notification.status, 'suppressed');
  assert.equal(result.notification.payload.whatsapp_delivery_mode, 'template');
});

test('business-initiated WhatsApp queues governed Meta template mode with the exact authoritative reply as a parameter', async () => {
  const repo = new MemoryCommunicationRepository(whatsappSeed());
  const service = notificationService(repo, 'carup_conversation_reply|en_US');
  const result = await service.queueExistingMessage({
    thread: repo.rows('message_threads')[0],
    message: repo.rows('messages').find((row) => row.id === 'out-1'),
    recipientIdentityId: 'wa-1',
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    metadata: { recipient_participant_id: 'buyer-p' },
    payload: { phone_number: '263771234567' },
  });
  assert.equal(result.suppressed, false);
  assert.equal(result.notification.status, 'queued');
  assert.equal(result.notification.payload.whatsapp_delivery_mode, 'template');
  assert.equal(result.notification.payload.provider_template_reference, 'carup_conversation_reply|en_US');
  assert.deepEqual(result.notification.payload.provider_template_parameters, ['Exact seller reply']);
});

test('recent physical WhatsApp inbound opens the customer-service window and keeps free-form session delivery', async () => {
  const repo = new MemoryCommunicationRepository(whatsappSeed({ recentInbound: true }));
  const service = notificationService(repo, null);
  const result = await service.queueExistingMessage({
    thread: repo.rows('message_threads')[0],
    message: repo.rows('messages').find((row) => row.id === 'out-1'),
    recipientIdentityId: 'wa-1',
    channel: 'whatsapp',
    provider: 'meta_whatsapp_cloud_api',
    metadata: { recipient_participant_id: 'buyer-p' },
    payload: { phone_number: '263771234567' },
  });
  assert.equal(result.suppressed, false);
  assert.equal(result.notification.payload.whatsapp_delivery_mode, 'session');
});

test('governed Meta adapter sends template payload and never converts it to free-form text', async () => {
  let captured = null;
  const adapter = new CommunicationMetaWhatsAppGovernedAdapter({
    env: { CARUP_META_ACCESS_TOKEN: ' token ', CARUP_META_PHONE_NUMBER_ID: ' phone-id ' },
    fetchImpl: async (_url, options) => {
      captured = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: 'wamid.template.1' }] }),
        headers: { get: () => null },
      };
    },
  });
  const result = await adapter.send({
    recipient: { phoneNumber: '263771234567' },
    content: {
      body: 'Exact seller reply',
      data: {
        whatsapp_delivery_mode: 'template',
        provider_template_reference: 'carup_conversation_reply|en_US',
        provider_template_parameters: ['Exact seller reply'],
      },
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(captured.type, 'template');
  assert.equal(captured.template.name, 'carup_conversation_reply');
  assert.equal(captured.template.language.code, 'en_US');
  assert.equal(captured.template.components[0].parameters[0].text, 'Exact seller reply');
  assert.equal(captured.text, undefined);
});

test('governed Meta adapter refuses business-initiated delivery without an approved provider reference', async () => {
  const adapter = new CommunicationMetaWhatsAppGovernedAdapter({
    env: { CARUP_META_ACCESS_TOKEN: 'token', CARUP_META_PHONE_NUMBER_ID: 'phone-id' },
    fetchImpl: async () => { throw new Error('must not call provider'); },
  });
  const result = await adapter.send({
    recipient: { phoneNumber: '263771234567' },
    content: { data: { whatsapp_delivery_mode: 'template' } },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, 'whatsapp_template_not_configured');
});

test('communication analytics productizes canonical conversation, delivery, attribution and AI events without PII projection', async () => {
  const repo = new MemoryCommunicationRepository({
    message_participants: [{ id: 'p1', thread_id: 't1', user_id: 'u1' }, { id: 'p2', thread_id: 't2', user_id: 'u2' }],
    message_threads: [
      { id: 't1', tenant_id: 'tenant-a', status: 'open', business_workflow: 'marketplace', funnel_stage: 'conversation', conversion_status: 'converted' },
      { id: 't2', tenant_id: 'tenant-b', status: 'open', business_workflow: 'support', funnel_stage: 'support', conversion_status: 'open' },
    ],
    conversation_events: [
      { id: 'e1', thread_id: 't1', event_type: 'marketplace_inquiry_created', acquisition_source: 'whatsapp', referral_code: 'REF1', campaign_code: 'CMP1' },
    ],
    notification_queue: [
      { id: 'n1', thread_id: 't1', channel: 'whatsapp', status: 'delivered' },
      { id: 'n2', thread_id: 't1', channel: 'in_app', status: 'sent' },
    ],
    message_derivations: [{ id: 'd1', thread_id: 't1', derivation_type: 'suggested_reply', human_reviewed: false }],
  });
  const analytics = await new CommunicationAnalyticsService({ repository: repo }).getUserAnalytics('u1', { tenantId: 'tenant-a' });
  assert.equal(analytics.conversations.total, 1);
  assert.equal(analytics.conversations.converted, 1);
  assert.equal(analytics.conversations.conversion_rate_pct, 100);
  assert.equal(analytics.delivery.successful, 2);
  assert.equal(analytics.delivery.success_rate_pct, 100);
  assert.equal(analytics.attribution.by_source.whatsapp, 1);
  assert.equal(analytics.ai.by_type.suggested_reply, 1);
  assert.equal(JSON.stringify(analytics).includes('263'), false, 'analytics projection must not expose communication addresses');
});

test('AI runtime stores a derived suggestion for human review and never mutates or sends the authoritative message', async () => {
  const canonical = {
    id: 'm1',
    text: 'Is the Toyota still available?',
    author: { is_self: false, stakeholder_role: 'buyer' },
  };
  const detail = { messages: [canonical] };
  const calls = [];
  const runtime = new CommunicationAiRuntimeService({
    conversationService: { getConversation: async () => detail },
    provider: {
      health: () => ({ available: true, provider: 'test', model: 'test-model' }),
      generate: async () => ({ text: 'Yes, it is available. Would Saturday work?', provider: 'test', model: 'test-model' }),
    },
    intelligenceService: {
      recordDerivation: async (input) => {
        calls.push(input);
        return { id: 'd1', ...input, human_reviewed: false };
      },
    },
  });
  const result = await runtime.suggestReply('t1', { id: 'seller-1' });
  assert.equal(result.output_text, 'Yes, it is available. Would Saturday work?');
  assert.equal(calls[0].derivation_type, 'suggested_reply');
  assert.equal(calls[0].human_approved_for_send, false);
  assert.equal(canonical.text, 'Is the Toyota still available?');
  assert.equal('send' in runtime, false, 'AI runtime has no send primitive');
});

test('Communications Gemini provider fails closed when no real provider credential is configured', async () => {
  const provider = new CommunicationGeminiProvider({ apiKey: null, fetchImpl: async () => ({}) });
  assert.equal(provider.health().available, false);
  await assert.rejects(
    provider.generate({ systemPrompt: 'x', userPrompt: 'y' }),
    (error) => error.code === 'communication_ai_provider_unavailable' && error.statusCode === 503,
  );
});

test('normal factory exposes product notification, analytics and AI runtime services without creating a second conversation stack', () => {
  const repo = new MemoryCommunicationRepository();
  const services = createCommunicationServices({
    repository: repo,
    adapterRegistry: createDefaultAdapterRegistry({ env: { NODE_ENV: 'test' } }),
    aiProvider: { health: () => ({ available: true }), generate: async () => ({ text: 'x', provider: 'test', model: 'test' }) },
  });
  assert.equal(services.notificationService.constructor.name, 'CommunicationProductNotificationService');
  assert.equal(services.analyticsService.constructor.name, 'CommunicationAnalyticsService');
  assert.equal(services.aiRuntimeService.constructor.name, 'CommunicationAiRuntimeService');
  assert.equal(services.conversationService.constructor.name, 'CommunicationCanonicalConversationService');
});
