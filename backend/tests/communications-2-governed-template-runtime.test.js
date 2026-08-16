import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationGovernedTemplateService } from '../services/communication/communicationGovernedTemplateService.js';
import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';
import { CommunicationCanonicalNotificationService } from '../services/communication/communicationCanonicalNotificationService.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';

function governedRepository() {
  return new MemoryCommunicationRepository({
    communication_templates: [{
      id: 'tpl-market', template_key: 'marketplace_inquiry_received_v1', business_workflow: 'marketplace',
      stakeholder_audience: 'buyer', classification: 'transactional', status: 'active',
    }],
    communication_template_versions: [{
      id: 'tpl-market-v2', template_id: 'tpl-market', version: 2, channel: 'default', language: 'en',
      subject_template: 'Governed subject {{listing_id}}',
      body_template: 'Governed body for {{listing_id}}',
      required_variables: ['listing_id'], optional_variables: [], approval_status: 'approved',
      provider_template_reference: null,
    }],
  });
}

test('governed approved DB template overrides the compatibility map after migration', async () => {
  const repository = governedRepository();
  const service = new CommunicationGovernedTemplateService({
    repository,
    fallbackService: new CommunicationTemplateService(),
  });
  const rendered = await service.render('marketplace_inquiry_received_v1', { listing_id: 'VIN-GOVERNED' }, { channel: 'whatsapp', language: 'en' });
  assert.equal(rendered.governed, true);
  assert.equal(rendered.version, 2);
  assert.equal(rendered.subject, 'Governed subject VIN-GOVERNED');
  assert.equal(rendered.body, 'Governed body for VIN-GOVERNED');
});

test('governed template refuses missing required personalization variables', async () => {
  const repository = governedRepository();
  const service = new CommunicationGovernedTemplateService({ repository });
  await assert.rejects(
    () => service.render('marketplace_inquiry_received_v1', {}, { channel: 'in_app', language: 'en' }),
    (error) => error?.code === 'template_variables_missing',
  );
});

test('an existing governed template with no approved version fails closed instead of bypassing to legacy copy', async () => {
  const repository = governedRepository();
  repository.rows('communication_template_versions')[0].approval_status = 'draft';
  const service = new CommunicationGovernedTemplateService({ repository });
  await assert.rejects(
    () => service.render('marketplace_inquiry_received_v1', { listing_id: 'VIN-NOT-APPROVED' }, { channel: 'in_app', language: 'en' }),
    (error) => error?.code === 'template_not_approved',
  );
});

test('retired governed template fails closed instead of reviving compatibility copy', async () => {
  const repository = governedRepository();
  repository.rows('communication_templates')[0].status = 'retired';
  const service = new CommunicationGovernedTemplateService({ repository });
  await assert.rejects(
    () => service.render('marketplace_inquiry_received_v1', { listing_id: 'VIN-RETIRED' }, { channel: 'in_app', language: 'en' }),
    (error) => error?.code === 'template_not_active',
  );
});

test('an unregistered key fails closed once the governed registry exists', async () => {
  const repository = governedRepository();
  const service = new CommunicationGovernedTemplateService({ repository });
  await assert.rejects(
    () => service.render('unknown_runtime_key', {}, { channel: 'in_app', language: 'en' }),
    (error) => error?.code === 'template_not_registered',
  );
});

test('pre-migration compatibility fallback is used only when the registry relation is genuinely absent', async () => {
  const repository = {
    async findOne() { throw new Error('communication_templates lookup failed: relation "communication_templates" does not exist'); },
    async list() { return []; },
  };
  const service = new CommunicationGovernedTemplateService({ repository });
  const rendered = await service.render('marketplace_inquiry_received_v1', { listing_id: 'VIN-PRE-MIGRATION' }, { channel: 'in_app', language: 'en' });
  assert.notEqual(rendered.governed, true);
  assert.equal(rendered.body, 'Your marketplace inquiry for VIN-PRE-MIGRATION was received. CarUp will notify the relevant seller or team.');
});

test('operational registry failure surfaces instead of bypassing governance through fallback', async () => {
  const repository = {
    async findOne() { throw new Error('communication_templates lookup failed: connection refused'); },
    async list() { return []; },
  };
  const service = new CommunicationGovernedTemplateService({ repository });
  await assert.rejects(
    () => service.render('marketplace_inquiry_received_v1', { listing_id: 'VIN-DB-OUTAGE' }, { channel: 'in_app', language: 'en' }),
    /connection refused/,
  );
});

test('normal runtime factory uses governed templates and the product notification layer preserves canonical routing semantics', () => {
  const services = createCommunicationServices({ repository: governedRepository() });
  assert.equal(services.templateService.constructor.name, 'CommunicationGovernedTemplateService');
  assert.equal(services.notificationService.constructor.name, 'CommunicationProductNotificationService');
  assert.equal(services.notificationService instanceof CommunicationCanonicalNotificationService, true);
});

test('event-driven WhatsApp never infers a free-form session from a missing Meta template reference', async () => {
  const repository = new MemoryCommunicationRepository({
    message_threads: [{ id: 'thread-event-wa', status: 'open', primary_channel: 'whatsapp' }],
  });
  const threadService = {
    async recordMessage(thread, input) {
      return repository.insert('messages', { thread_id: thread.id, ...input });
    },
  };
  const service = new CommunicationProductNotificationService({
    repository,
    threadService,
    preferenceService: {},
    templateService: {
      async render() {
        return {
          templateKey: 'marketplace_inquiry_received_v1',
          templateId: 'tpl-event',
          templateVersionId: 'tpl-event-v1',
          version: 1,
          subject: 'Marketplace inquiry',
          body: 'A buyer contacted you.',
          data: {},
          governed: true,
          providerTemplateReference: null,
        };
      },
    },
  });
  const result = await service.queueNotification({
    recipientUserId: 'seller-1',
    thread: repository.rows('message_threads')[0],
    channel: 'whatsapp',
    templateKey: 'marketplace_inquiry_received_v1',
    notificationType: 'marketplace_inquiry',
    dedupeParts: ['event-wa-policy'],
    payload: { event_type: 'marketplace.inquiry.created', phone_number: '263771234567' },
  });
  assert.equal(result.notification.payload.whatsapp_delivery_mode, 'template');
  assert.equal(result.notification.payload.provider_template_reference, null);
  assert.equal(result.notification.metadata.provider_template_configured, false);
  assert.equal(result.notification.metadata.whatsapp_policy_reason, 'business_template_required_but_not_configured');
});
