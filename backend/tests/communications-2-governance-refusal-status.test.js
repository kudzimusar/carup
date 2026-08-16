/**
 * Governed-template refusals must answer as refusals, not as server faults.
 *
 * Phase 7 staging UAT caught this: creating a campaign on a channel the governed marketing
 * template has no approved version for returned HTTP 500 INTERNAL_SERVER_ERROR. The refusal
 * itself was correct and fail-closed — no campaign row, no provider contacted — but an
 * operator asking for an ungoverned channel could not tell governance from an outage, and
 * 5xx alerting counted it as downtime.
 *
 * governanceError() carried `code` and `details` but no `statusCode`, so errorHandler left
 * it 500. These are caller-correctable conditions and now answer 409.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationGovernedTemplateService } from '../services/communication/communicationGovernedTemplateService.js';

const TEMPLATE_ID = 'tmpl-1';

function repositoryWith({ status = 'active', versions = [] } = {}) {
  return {
    async findOne(table) {
      if (table !== 'communication_templates') return null;
      return { id: TEMPLATE_ID, template_key: 'carup_reengagement_v1', status, classification: 'marketing' };
    },
    async list(table) {
      if (table !== 'communication_template_versions') return [];
      return versions;
    },
  };
}

const approvedInApp = {
  id: 'ver-1', template_id: TEMPLATE_ID, version: 1, channel: 'in_app',
  language: 'en', approval_status: 'approved', body_template: 'hello',
};

test('no approved version for the requested channel refuses 409, not 500', async () => {
  const service = new CommunicationGovernedTemplateService({ repository: repositoryWith({ versions: [approvedInApp] }) });
  await assert.rejects(
    () => service.resolveGovernedVersion('carup_reengagement_v1', { channel: 'whatsapp', language: 'en' }),
    (error) => {
      assert.equal(error.code, 'template_not_approved');
      assert.equal(error.statusCode, 409, 'a governance refusal must not surface as a server fault');
      assert.match(error.message, /no approved en\/whatsapp/);
      return true;
    },
  );
});

test('an inactive governed template refuses 409, not 500', async () => {
  const service = new CommunicationGovernedTemplateService({ repository: repositoryWith({ status: 'archived', versions: [approvedInApp] }) });
  await assert.rejects(
    () => service.resolveGovernedVersion('carup_reengagement_v1', { channel: 'in_app', language: 'en' }),
    (error) => {
      assert.equal(error.code, 'template_not_active');
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
});

test('a governed channel that IS approved still resolves normally', async () => {
  const service = new CommunicationGovernedTemplateService({ repository: repositoryWith({ versions: [approvedInApp] }) });
  const resolved = await service.resolveGovernedVersion('carup_reengagement_v1', { channel: 'in_app', language: 'en' });
  assert.equal(resolved.registryAvailable, true);
  assert.equal(resolved.version.id, 'ver-1');
});

test('an unknown template key is reported as absent rather than refused', async () => {
  const service = new CommunicationGovernedTemplateService({ repository: { async findOne() { return null; }, async list() { return []; } } });
  const resolved = await service.resolveGovernedVersion('does_not_exist', { channel: 'in_app', language: 'en' });
  assert.equal(resolved.template, null);
  assert.equal(resolved.version, null);
});
