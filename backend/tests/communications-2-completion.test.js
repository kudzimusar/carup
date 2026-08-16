import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { createDefaultAdapterRegistry } from '../services/communication/adapters/providerAdapters.js';

function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    storage: {
      from(bucket) {
        return {
          async createSignedUploadUrl(path) {
            objects.set(`${bucket}:${path}`, { path, name: path.split('/').at(-1), bytes: Buffer.from('carup-media'), metadata: { size: 11, mimetype: 'image/jpeg' } });
            return { data: { token: 'signed-upload-token', signedUrl: `https://storage.test/upload/${encodeURIComponent(path)}` }, error: null };
          },
          async list(prefix, { search } = {}) {
            const rows = [...objects.values()]
              .filter((row) => row.path.startsWith(`${prefix}/`))
              .filter((row) => !search || row.name === search)
              .map((row) => ({ name: row.name, metadata: row.metadata }));
            return { data: rows, error: null };
          },
          async createSignedUrl(path, expiresIn) {
            return { data: { signedUrl: `https://storage.test/private/${encodeURIComponent(path)}?ttl=${expiresIn}` }, error: null };
          },
          async download(path) {
            const row = [...objects.values()].find((item) => item.path === path);
            if (!row) return { data: null, error: new Error('not found') };
            return { data: new Blob([row.bytes], { type: 'image/jpeg' }), error: null };
          },
        };
      },
    },
  };
}

function mediaSeed() {
  const now = new Date().toISOString();
  return {
    message_threads: [{ id: 'thread-media', tenant_id: 'tenant-a', thread_key: 'media-thread', thread_type: 'marketplace_inquiry', business_workflow: 'marketplace', conversation_type: 'marketplace', status: 'open', priority: 'normal', primary_channel: 'in_app', created_at: now, updated_at: now }],
    message_participants: [{ id: 'p-media', thread_id: 'thread-media', participant_type: 'user', user_id: 'u-media', role: 'buyer', stakeholder_role: 'buyer', permissions: { read: true, send: true }, joined_at: now }],
    messages: [], message_parts: [], conversation_events: [], message_derivations: [], notification_queue: [], channel_identities: [], conversation_channel_bindings: [], communication_preferences: [],
  };
}

function servicesFor(repository, extra = {}) {
  return createCommunicationServices({
    repository,
    adapterRegistry: createDefaultAdapterRegistry({ env: { NODE_ENV: 'test' } }),
    aiProvider: extra.aiProvider || { health: () => ({ available: true, multimodal: true }), generate: async () => ({ text: 'derived', provider: 'test', model: 'test' }) },
    storageClient: extra.storageClient || null,
  });
}

test('Phase 5 private media commits a canonical message part and authorizes short-lived access by participant', async () => {
  const repo = new MemoryCommunicationRepository(mediaSeed());
  const storage = fakeStorage();
  const services = servicesFor(repo, { storageClient: storage });
  const upload = await services.mediaService.prepareUpload('thread-media', { id: 'u-media' }, { file_name: 'Toyota front.jpg', mime_type: 'image/jpeg', size_bytes: 11 });
  assert.equal(upload.private, true);
  assert.equal(upload.bucket, 'carup-communication-media');
  const committed = await services.mediaService.commitUpload('thread-media', { id: 'u-media' }, {
    artifact_id: upload.artifact_id, file_name: upload.file_name, mime_type: upload.mime_type, size_bytes: upload.size_bytes, caption: 'Front-left view', sha256: 'abc123',
  });
  assert.equal(committed.parts.length, 1);
  assert.equal(committed.parts[0].part_type, 'image');
  assert.equal(committed.parts[0].source_url, null);
  const detail = await services.conversationService.getConversation('thread-media', { id: 'u-media' });
  assert.equal(detail.messages[0].parts[0].id, committed.parts[0].id);
  const signed = await services.mediaService.createSignedPartUrl(committed.parts[0].id, { id: 'u-media' });
  assert.equal(signed.private, true);
  await assert.rejects(services.mediaService.createSignedPartUrl(committed.parts[0].id, { id: 'intruder' }), (error) => error.statusCode === 404);
});

test('Phase 5 structured location and multimodal AI preserve the original artifact and never auto-execute', async () => {
  const repo = new MemoryCommunicationRepository(mediaSeed());
  const storage = fakeStorage();
  const calls = [];
  const services = servicesFor(repo, {
    storageClient: storage,
    aiProvider: {
      health: () => ({ available: true, provider: 'test', model: 'multimodal-test', multimodal: true }),
      generate: async (input) => { calls.push(input); return { text: 'Image shows a vehicle; exact model uncertain.', provider: 'test', model: 'multimodal-test' }; },
    },
  });
  const location = await services.mediaService.sendMessage('thread-media', { id: 'u-media' }, { parts: [{ part_type: 'location', metadata: { latitude: -17.8292, longitude: 31.0522, label: 'Harare' } }] });
  assert.equal(location.parts[0].metadata.label, 'Harare');
  const upload = await services.mediaService.prepareUpload('thread-media', { id: 'u-media' }, { file_name: 'vehicle.jpg', mime_type: 'image/jpeg', size_bytes: 11 });
  const committed = await services.mediaService.commitUpload('thread-media', { id: 'u-media' }, { artifact_id: upload.artifact_id, file_name: upload.file_name, mime_type: upload.mime_type, size_bytes: upload.size_bytes });
  const derivation = await services.aiRuntimeService.analyzeMedia('thread-media', { id: 'u-media' }, { part_id: committed.parts[0].id });
  assert.equal(derivation.derivation_type, 'image_classification');
  assert.equal(derivation.provenance.source_artifact_unchanged, true);
  assert.equal(calls[0].media.length, 1);
  assert.equal('send' in services.aiRuntimeService, false);
});

test('Phase 6 minimum stakeholder reference flows reuse one canonical conversation contract and regulated paths are draft-only', async () => {
  const repo = new MemoryCommunicationRepository();
  const services = servicesFor(repo);
  const required = [
    ['marketplace', ['buyer', 'seller']],
    ['dealer', ['buyer', 'dealer']],
    ['garage', ['vehicle_owner', 'garage']],
    ['insurance', ['vehicle_owner', 'insurer']],
    ['finance', ['applicant', 'lender']],
    ['diaspora_import', ['customer', 'import_coordinator']],
    ['container_logistics', ['customer', 'logistics_provider']],
  ];
  for (const [workflow, roles] of required) {
    const result = await services.stakeholderService.ensureReferenceFlow({
      workflow, tenant_id: 'tenant-a', subject_id: `subject-${workflow}`,
      participants: roles.map((role, index) => ({ participant_type: 'user', user_id: `${workflow}-u${index + 1}`, role, stakeholder_role: role, permissions: { read: true, send: true } })),
      initial_message: { sender_role: roles[0], text: `Exact ${workflow} reference message`, source_id: `source-${workflow}` },
    });
    assert.equal(result.thread.business_workflow, workflow);
    assert.equal(result.participants.length, 2);
    assert.equal(result.thread.metadata.communications_2_stakeholder_contract, true);
    const messages = repo.rows('messages').filter((row) => row.thread_id === result.thread.id);
    assert.equal(messages[0].content_text, `Exact ${workflow} reference message`);
    if (['insurance', 'finance'].includes(workflow)) assert.equal(result.thread.ai_mode, 'draft_only');
  }
  await assert.rejects(
    services.stakeholderService.ensureReferenceFlow({ workflow: 'finance', subject_id: 'bad-finance', participants: [{ participant_type: 'user', user_id: 'u1', role: 'applicant' }, { participant_type: 'user', user_id: 'u2', role: 'support_agent' }] }),
    /requires participant role\(s\): lender/,
  );
});

function campaignSeed() {
  const now = new Date().toISOString();
  return {
    users: [{ id: 'u1', name: 'Buyer One', role: 'buyer', email: 'buyer1@example.test' }, { id: 'u2', name: 'Buyer Two', role: 'buyer', email: 'buyer2@example.test' }],
    communication_preferences: [{ id: 'pref1', user_id: 'u1', tenant_id: null, marketing_enabled: true, in_app_enabled: true, transactional_enabled: true }, { id: 'pref2', user_id: 'u2', tenant_id: null, marketing_enabled: false, in_app_enabled: true, transactional_enabled: true }],
    communication_templates: [{ id: 'tpl-growth', template_key: 'carup_reengagement_v1', business_workflow: 'growth', stakeholder_audience: 'consented_user', classification: 'marketing', status: 'active' }],
    communication_template_versions: [{ id: 'tplv-growth', template_id: 'tpl-growth', version: 1, channel: 'in_app', language: 'en', subject_template: 'CarUp update', body_template: 'A relevant CarUp update.', required_variables: [], optional_variables: [], approval_status: 'approved', created_at: now }],
    communication_campaigns: [], communication_campaign_deliveries: [], message_threads: [], message_participants: [], messages: [], notification_queue: [], channel_identities: [], conversation_events: [], message_derivations: [],
  };
}

test('Phase 7 campaigns enforce marketing consent, deterministic idempotency, frequency caps and conversion ROI', async () => {
  const repo = new MemoryCommunicationRepository(campaignSeed());
  const services = servicesFor(repo);
  const actor = { id: 'admin-1' };
  const first = await services.campaignService.createCampaign({ campaign_code: 'reengage-a', name: 'Re-engagement A', template_key: 'carup_reengagement_v1', channel: 'in_app', segment_definition: { user_ids: ['u1', 'u2'] }, frequency_cap_count: 1, frequency_cap_window_hours: 168, experiment_variants: [{ key: 'control', weight: 1, cost_amount: 2, cost_currency: 'USD' }] }, actor);
  await services.campaignService.approveCampaign(first.id, actor);
  const run = await services.campaignService.executeCampaign(first.id, actor);
  assert.equal(run.targeted, 2);
  assert.equal(run.queued, 1);
  assert.equal(run.suppressed, 1);
  assert.equal(repo.rows('communication_campaign_deliveries').find((row) => row.user_id === 'u2').suppression_reason, 'marketing_or_channel_consent_disabled');
  const replay = await services.campaignService.executeCampaign(first.id, actor);
  assert.equal(replay.existing, 2);
  const second = await services.campaignService.createCampaign({ campaign_code: 'reengage-b', name: 'Re-engagement B', template_key: 'carup_reengagement_v1', channel: 'in_app', segment_definition: { user_ids: ['u1'] }, frequency_cap_count: 1, frequency_cap_window_hours: 168 }, actor);
  await services.campaignService.approveCampaign(second.id, actor);
  const secondRun = await services.campaignService.executeCampaign(second.id, actor);
  assert.equal(secondRun.queued, 0);
  assert.equal(secondRun.suppressed, 1);
  assert.equal(repo.rows('communication_campaign_deliveries').find((row) => row.campaign_id === second.id).suppression_reason, 'frequency_cap');
  await services.campaignService.recordConversion(first.id, { user_id: 'u1', value: 10, currency: 'USD', reference: 'sale-1' });
  const report = await services.campaignService.report(first.id);
  assert.equal(report.converted, 1);
  assert.equal(report.conversion_value, 10);
  assert.equal(report.cost, 2);
  assert.equal(report.roi_pct, 400);
});

test('Phase 7 campaigns cannot use a transactional template to bypass marketing consent', async () => {
  const seed = campaignSeed();
  seed.communication_templates.push({ id: 'tpl-tx', template_key: 'transactional-test', business_workflow: 'marketplace', stakeholder_audience: 'buyer', classification: 'transactional', status: 'active' });
  const services = servicesFor(new MemoryCommunicationRepository(seed));
  await assert.rejects(services.campaignService.createCampaign({ campaign_code: 'bad', name: 'Bad', template_key: 'transactional-test', channel: 'in_app', segment_definition: { user_ids: ['u1'] } }, { id: 'admin-1' }), (error) => error.code === 'communication_campaign_template_not_marketing');
});

test('Phase 6 stakeholder creation is exposed only through the worker-secret internal bridge', () => {
  const source = readFileSync(new URL('../services/communication/communicationCompletionRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /\/api\/internal\/communications\/workflows\/:workflow\/ensure/);
  assert.match(source, /requireWorkerSecret\(req, res\)/);
  assert.doesNotMatch(source, /router\.post\('\/api\/communications\/workflows\/:workflow\/ensure/);
});
