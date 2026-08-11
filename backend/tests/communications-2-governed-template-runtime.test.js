import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationGovernedTemplateService } from '../services/communication/communicationGovernedTemplateService.js';
import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';
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

test('compatibility fallback remains available only when no governed row exists', async () => {
  const repository = new MemoryCommunicationRepository();
  const service = new CommunicationGovernedTemplateService({ repository });
  const rendered = await service.render('marketplace_inquiry_received_v1', { listing_id: 'VIN-PRE-MIGRATION' }, { channel: 'in_app', language: 'en' });
  assert.notEqual(rendered.governed, true);
  assert.equal(rendered.body, 'Your marketplace inquiry for VIN-PRE-MIGRATION was received. CarUp will notify the relevant seller or team.');
});

test('normal runtime factory uses governed template and canonical notification services', () => {
  const services = createCommunicationServices({ repository: governedRepository() });
  assert.equal(services.templateService.constructor.name, 'CommunicationGovernedTemplateService');
  assert.equal(services.notificationService.constructor.name, 'CommunicationCanonicalNotificationService');
});
