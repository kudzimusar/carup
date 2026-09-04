import assert from 'node:assert/strict';
import test from 'node:test';

import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { CommunicationProductNotificationService } from '../services/communication/communicationProductNotificationService.js';
import { CommunicationCampaignService } from '../services/communication/communicationCampaignService.js';
import {
  EMAIL_CLASSIFICATIONS,
  EMAIL_CLASSIFICATION_ERRORS,
  normalizeEmailClassification,
  resolveEmailClassification,
} from '../services/communication/emailExperience/emailClassification.js';

/**
 * G2 — the canonical Email classification contract.
 *
 * G3 exposed that four of the five non-marketing families were "not marketing" by ABSENCE rather
 * than assertion: `String(undefined) !== 'marketing'` happened to reach the right answer. Two
 * components defaulted the same missing field differently — the router to `'transactional'`, the
 * worker to `''` — so absence silently CHOSE A PROVIDER.
 *
 * These tests drive the REAL producers wherever a producer exists. A hand-built adapter payload can
 * prove the router is correct; only the producer can prove anything actually reaches it. That
 * distinction is not academic here: the same class of gap made the entire marketing path dead by
 * construction, and it was found by driving the real campaign service rather than a fixture.
 */

const ROUTER_ENV = {
  RESEND_API_KEY: 'r', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev',
};

// ============================================================================
// O1–O5. every canonical classification reaches its governed transport
// ============================================================================

test('O1-O5 each of the five canonical classifications routes to its governed transport', () => {
  const router = new EmailTransportRouter({ env: ROUTER_ENV });
  const expected = {
    security: 'resend', transactional: 'resend', conversational: 'resend',
    service: 'resend', marketing: 'brevo',
  };
  assert.deepEqual(EMAIL_CLASSIFICATIONS.slice().sort(), Object.keys(expected).sort(),
    'the vocabulary is exactly these five — no sixth value, and no `auth`');
  for (const [classification, provider] of Object.entries(expected)) {
    assert.equal(router.selectAdapter({ content: { data: { classification } } }).adapter.provider, provider, classification);
  }
});

// ============================================================================
// O6–O8. missing, invalid and conflicting all fail closed
// ============================================================================

/** A worker whose adapter counts calls, so "zero provider calls" is measured, not asserted. */
function countingWorker() {
  let providerCalls = 0;
  const updates = [];
  const worker = new CommunicationDeliveryWorker({
    repository: {
      list: async () => [],
      findOne: async () => null,
      insert: async () => ({ id: 'a' }),
      updateById: async (_t, id, patch) => { updates.push(patch); return { id }; },
    },
    adapterRegistry: { get: () => ({ provider: 'resend', send: async () => { providerCalls += 1; return { accepted: true }; } }) },
  });
  return { worker, updates, providerCalls: () => providerCalls };
}

test('O6 a canonical Email with NO classification is refused, with zero provider calls', async () => {
  const { worker, updates, providerCalls } = countingWorker();
  await worker.deliverNotification({
    id: 'o6', channel: 'email', title: 'Something', message: 'Body.',
    payload: { email: 'a@example.test' },
  });
  assert.equal(providerCalls(), 0, 'THE DEFECT: absence used to choose a provider');
  assert.equal(updates.find((u) => u.last_error_code)?.last_error_code, EMAIL_CLASSIFICATION_ERRORS.MISSING);
});

test('O7 an INVALID classification is refused, with zero provider calls', async () => {
  const { worker, updates, providerCalls } = countingWorker();
  await worker.deliverNotification({
    id: 'o7', channel: 'email', title: 'x', message: 'y',
    payload: { email: 'a@example.test', classification: 'promotional' },
  });
  assert.equal(providerCalls(), 0);
  assert.equal(updates.find((u) => u.last_error_code)?.last_error_code, EMAIL_CLASSIFICATION_ERRORS.INVALID);
});

test('O7b `auth` is not a sixth classification — account protection is `security`', () => {
  assert.equal(normalizeEmailClassification('auth'), null);
  const router = new EmailTransportRouter({ env: ROUTER_ENV });
  const selected = router.selectAdapter({ content: { data: { classification: 'auth' } } });
  assert.equal(selected.adapter, null, 'it used to reach Resend by falling through the marketing check');
  assert.equal(selected.errorCode, EMAIL_CLASSIFICATION_ERRORS.INVALID);
});

test('O8 CONFLICTING stored classifications are refused rather than resolved', async () => {
  // Two stored values disagreeing is the state where a message is rendered as one family and
  // transported as another. Picking a winner would make that silent; refusing makes it visible.
  const { worker, updates, providerCalls } = countingWorker();
  await worker.deliverNotification({
    id: 'o8', channel: 'email', title: 'x', message: 'y',
    payload: { email: 'a@example.test', classification: 'marketing' },
    metadata: { classification: 'transactional' },
  });
  assert.equal(providerCalls(), 0);
  assert.equal(updates.find((u) => u.last_error_code)?.last_error_code, EMAIL_CLASSIFICATION_ERRORS.CONFLICT);
});

test('O6b the ROUTER refuses independently of the worker — defence in depth', async () => {
  // The worker refuses first, so without this the router's own guard would be unreachable from any
  // test and could regress silently. Two layers, and each must be able to say no on its own.
  let providerCalls = 0;
  const router = new EmailTransportRouter({
    env: ROUTER_ENV,
    fetchImpl: async () => { providerCalls += 1; return { ok: true, status: 200, text: async () => '{}', headers: new Map() }; },
  });
  const missing = await router.send({ content: { subject: 'S', body: 'B', data: { email: 'a@example.test' } } });
  assert.equal(missing.accepted, false);
  assert.equal(missing.errorCode, EMAIL_CLASSIFICATION_ERRORS.MISSING);

  const invalid = await router.send({ content: { subject: 'S', body: 'B', data: { email: 'a@example.test', classification: 'newsletter' } } });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.errorCode, EMAIL_CLASSIFICATION_ERRORS.INVALID);

  assert.equal(providerCalls, 0, 'zero provider calls');
});

test('O8b a non-email channel is untouched by the Email classification contract', async () => {
  const { worker, providerCalls } = countingWorker();
  for (const channel of ['in_app', 'push']) {
    await worker.deliverNotification({ id: `o8b-${channel}`, channel, title: 'x', message: 'y', payload: {} });
  }
  assert.equal(providerCalls(), 2, 'in_app and push have no presentation to classify and must not regress');
});

// ============================================================================
// O9–O12. the REAL producers stamp an explicit classification
// ============================================================================

/**
 * The live notification service, with the storage layer stubbed.
 *
 * `CommunicationProductNotificationService` is what the factory actually wires, and it inherits a
 * `queueNotification` that REIMPLEMENTS rather than delegates. Testing the base class would have
 * proven nothing about the code that runs — which is exactly the trap this file exists to avoid.
 */
function liveNotificationService() {
  const rows = [];
  const repository = {
    findOne: async () => null,
    list: async () => [],
    insert: async (table, row) => { if (table === 'notification_queue') rows.push(row); return { id: `n-${rows.length}`, ...row }; },
    updateById: async (_t, id, patch) => ({ id, ...patch }),
    deleteById: async () => null,
  };
  const service = new CommunicationProductNotificationService({
    repository,
    threadService: {
      resolveOrCreateThread: async () => ({ thread: { id: 'th-1', tenant_id: null, status: 'open', metadata: {} } }),
      recordMessage: async (_t, m) => ({ id: 'msg-1', ...m }),
    },
    preferenceService: {
      getPreferences: async () => ({}),
      selectChannels: () => ['email'],
      isChannelAllowed: () => true,
      isInQuietHours: () => false,
    },
    templateService: { render: async () => ({ subject: 'S', body: 'B', templateKey: 't', data: {} }) },
  });
  return { service, rows };
}

test('O9 the REAL auth producer stamps `security`', async () => {
  const { service, rows } = liveNotificationService();
  // The exact call `authRecoveryRoutes.queueAuthEmail` makes.
  await service.queueNotification({
    recipientUserId: 'u-1', notificationType: 'reset_password', channel: 'email',
    templateKey: 'reset_password', priority: 'high', transactional: true,
    classification: 'security', fallbackChannels: [],
    variables: {}, dedupeParts: ['auth', 'reset_password', 'u-1', 'nonce'],
    payload: { email: 'u@example.test', classification: 'security', auth_template_key: 'reset_password' },
  });
  assert.equal(rows[0].payload.classification, 'security');
  assert.equal(rows[0].metadata.classification, 'security');
  assert.equal(resolveEmailClassification(rows[0]).classification, 'security');
});

test('O10 the REAL campaign producer stamps `marketing`', async () => {
  const queued = [];
  const CAMPAIGN = {
    id: 'c1', tenant_id: 'platform', campaign_code: 'w', classification: 'marketing',
    channel: 'email', status: 'approved', template_key: 't', language: 'en',
    business_workflow: 'growth', segment_definition: { user_ids: ['u-1'] },
    experiment_variants: [], frequency_cap_count: 5, frequency_cap_window_hours: 168,
    attribution: {}, promotion_id: null,
  };
  const service = new CommunicationCampaignService({
    repository: {
      findOne: async (t) => (t === 'communication_campaigns' ? { ...CAMPAIGN } : null),
      list: async (t) => (t === 'users' ? [{ id: 'u-1', email: 'r@example.test', role: 'buyer' }]
        : t === 'channel_identities' ? [{ id: 'ci', user_id: 'u-1', channel: 'email', verified: true, normalized_address: 'r@example.test', consent_status: 'granted' }] : []),
      insert: async (_t, row) => row,
      updateById: async (t, id, patch) => (t === 'communication_campaigns' ? { ...CAMPAIGN, ...patch, id } : { id, ...patch }),
    },
    threadService: { resolveOrCreateThread: async () => ({ thread: { id: 'th', tenant_id: 'platform', metadata: {} } }) },
    conversationService: { ensureParticipant: async () => ({ id: 'p' }), participantForUser: async () => ({ id: 'p' }), recordAnalytics: async () => ({}) },
    preferenceService: { getPreferences: async () => ({}), isChannelAllowed: () => true },
    templateService: { render: () => ({ subject: 's', body: 'b', text: 'b' }) },
    notificationService: { queueNotification: async (i) => { queued.push(i); return { notification: { id: 'n', status: 'queued' }, message: { id: 'm' } }; } },
    unsubscribeService: { issue: async () => ({ url: 'https://carup.dev/u?token=t', mailto: 'u+t@mail.carup.dev' }) },
  });
  await service.executeCampaign('c1', { id: 'admin' });
  assert.equal(queued[0].payload.classification, 'marketing');
  assert.equal(queued[0].classification, 'marketing');
});

test('O11 the REAL policy producer stamps an explicit `transactional`', async () => {
  const { service, rows } = liveNotificationService();
  await service.queueFromDomainEvent({
    id: 'evt-1', event_type: 'finance.application.status_changed',
    payload: { recipientUserId: 'u-1', applicationId: 'app-1', status: 'approved' },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.classification, 'transactional', 'the policy declares it explicitly');
  assert.equal(rows[0].metadata.classification_source, 'policy');
  assert.equal(resolveEmailClassification(rows[0]).classification, 'transactional');
});

test('O11b an UNRECOGNISED domain event gets no classification and is refused at the boundary', async () => {
  // The default policy deliberately carries none. `missing => transactional` is the exact
  // absence-as-semantics defect this gate removes, and it would silently pick a provider.
  const { service, rows } = liveNotificationService();
  await service.queueFromDomainEvent({
    id: 'evt-2', event_type: 'something.nobody.declared',
    payload: { recipientUserId: 'u-1' },
  });
  assert.equal(rows[0].payload.classification, undefined);
  assert.equal(resolveEmailClassification(rows[0]).errorCode, EMAIL_CLASSIFICATION_ERRORS.MISSING);
});

test('O12 the REAL conversation path stamps `conversational`', async () => {
  const { service, rows } = liveNotificationService();
  // The exact call `communicationCanonicalConversationService` makes for a human thread message.
  await service.queueExistingMessage({
    recipientUserId: 'u-1',
    thread: { id: 'th-1', tenant_id: null, priority: 'normal' },
    message: { id: 'msg-1', content_text: 'Is the car still available?' },
    channel: 'email',
    notificationType: 'conversation_message',
    classification: 'conversational',
    transactional: true,
    dedupeParts: ['conversation-message', 'msg-1', 'p-1', 'email'],
    payload: { email: 'buyer@example.test' },
  });
  assert.equal(rows[0].payload.classification, 'conversational');
  assert.equal(resolveEmailClassification(rows[0]).classification, 'conversational');
});

// ============================================================================
// A4. legacy rows — derived deterministically or quarantined, never guessed
// ============================================================================

test('A4 a legacy row is classified ONLY from a one-to-one canonical signal', () => {
  const auth = resolveEmailClassification({ payload: { auth_template_key: 'reset_password' } });
  assert.equal(auth.classification, 'security');
  assert.equal(auth.source, 'legacy_deterministic');

  const campaign = resolveEmailClassification({ payload: { campaign_id: 'c1', campaign_delivery_id: 'd1' } });
  assert.equal(campaign.classification, 'marketing');

  const byTemplate = resolveEmailClassification({ template_key: 'auth_password_reset_v1', payload: {} });
  assert.equal(byTemplate.classification, 'security');
});

test('A4b an unprovable legacy row is QUARANTINED, never inferred as transactional', () => {
  for (const row of [
    { payload: { event_type: 'marketplace.inquiry.created', safe_payload: {} } },
    { notification_type: 'admin_reply', payload: { thread_id: 't' } },
    { template_key: 'message_acknowledgement_v1', payload: {} },
    { metadata: { transactional: true }, payload: {} },
  ]) {
    const verdict = resolveEmailClassification(row);
    assert.equal(verdict.ok, false, `must not guess: ${JSON.stringify(row)}`);
    assert.equal(verdict.errorCode, EMAIL_CLASSIFICATION_ERRORS.MISSING);
  }
  // `metadata.transactional: true` is the most tempting signal in the set and the most wrong:
  // it is true of security, transactional, conversational AND service, so it identifies nothing.
});
