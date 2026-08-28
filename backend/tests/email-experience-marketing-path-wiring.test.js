import assert from 'node:assert/strict';
import test from 'node:test';

import { CommunicationCampaignService } from '../services/communication/communicationCampaignService.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';

/**
 * G3 wiring — does the governed marketing path actually REACH the marketing controls?
 *
 * Every marketing safeguard CarUp has is keyed on one field: `payload.classification === 'marketing'`.
 * The transport router reads it to choose Brevo over Resend. The send-time consent gate reads it to
 * decide whether to consult canonical suppression state. The unsubscribe presentation step reads it
 * to decide whether a control is required. E7's fail-closed refusal lives inside the adapter that
 * only that field can select.
 *
 * If the real campaign path never writes that field, every one of those controls is dead by
 * construction — present in the code, exercised by unit tests that hand-build the payload, and never
 * reached by an actual campaign. That is not a hypothetical failure mode here: it is exactly how the
 * inbound reply path failed earlier in this programme, and how the E7 unsubscribe defect reached a
 * real human inbox.
 *
 * These tests drive the REAL `executeCampaign` and assert on the payload it queues, so the wiring is
 * proven rather than assumed.
 */

const CAMPAIGN = {
  id: 'camp-1',
  tenant_id: 'platform',
  campaign_code: 'weekly-2026-08',
  classification: 'marketing',
  channel: 'email',
  status: 'approved',
  template_key: 'carup_weekly_v1',
  language: 'en',
  business_workflow: 'growth',
  segment_definition: { user_ids: ['u-1'] },
  experiment_variants: [],
  frequency_cap_count: 5,
  frequency_cap_window_hours: 168,
  attribution: {},
  promotion_id: null,
};

const USER = { id: 'u-1', email: 'reader@example.test', role: 'buyer' };

function campaignHarness() {
  const queued = [];
  const inserted = [];
  const repository = {
    findOne: async (table) => {
      if (table === 'communication_campaigns') return { ...CAMPAIGN };
      return null; // no prior delivery — nothing is idempotency-skipped
    },
    list: async (table) => {
      if (table === 'users') return [USER];
      if (table === 'channel_identities') {
        return [{ id: 'ci-1', user_id: 'u-1', channel: 'email', verified: true, normalized_address: 'reader@example.test', consent_status: 'granted', provider: 'resend' }];
      }
      return [];
    },
    insert: async (table, row) => { inserted.push({ table, row }); return row; },
    updateById: async (table, id, patch) => (table === 'communication_campaigns'
      ? { ...CAMPAIGN, ...patch, id }
      : { id, ...patch }),
  };

  const service = new CommunicationCampaignService({
    repository,
    threadService: { resolveOrCreateThread: async () => ({ thread: { id: 'th-1', tenant_id: 'platform', metadata: {} } }) },
    conversationService: {
      ensureParticipant: async () => ({ id: 'p-1' }),
      participantForUser: async () => ({ id: 'p-1' }),
      recordAnalytics: async () => ({}),
    },
    preferenceService: { getPreferences: async () => ({}), isChannelAllowed: () => true },
    templateService: { render: () => ({ subject: 'CarUp Weekly', body: 'Weekly picks.', text: 'Weekly picks.' }) },
    notificationService: {
      queueNotification: async (input) => {
        queued.push(input);
        return { notification: { id: 'n-1', status: 'queued' }, message: { id: 'm-1' } };
      },
    },
    unsubscribeService: {
      issue: async () => ({ url: 'https://carup.dev/api/communications/unsubscribe?token=tok', mailto: 'unsubscribe+tok@mail.carup.dev' }),
    },
  });

  return { service, queued, inserted };
}

test('WIRING: a real campaign stamps classification=marketing onto the notification payload', async () => {
  const { service, queued } = campaignHarness();
  await service.executeCampaign('camp-1', { id: 'admin-1' });

  assert.equal(queued.length, 1, 'the campaign queued one notification');
  const payload = queued[0].payload;
  assert.equal(
    payload.classification, 'marketing',
    'THE DEFECT: without this field the transport router sends marketing down the TRANSACTIONAL '
    + 'path, the send-time consent gate never consults suppression state, and no unsubscribe '
    + 'control is ever required — every marketing safeguard is bypassed at once.',
  );
});

test('WIRING: a real campaign carries the canonical delivery id the marketing adapter requires', async () => {
  const { service, queued, inserted } = campaignHarness();
  await service.executeCampaign('camp-1', { id: 'admin-1' });

  const payload = queued[0].payload;
  assert.ok(payload.campaign_id, 'campaign id');
  assert.ok(
    payload.campaign_delivery_id,
    'the Brevo adapter refuses campaign_context_missing without it, so a marketing send that '
    + 'reached the right transport would still be refused',
  );

  // And it must be the SAME id as the delivery row, or provider-side reconciliation points at nothing.
  const delivery = inserted.find((i) => i.table === 'communication_campaign_deliveries');
  assert.equal(payload.campaign_delivery_id, delivery.row.id, 'payload and delivery row must agree');
});

test('WIRING: the queued payload routes to the MARKETING transport, not the transactional one', () => {
  const router = new EmailTransportRouter({
    env: { RESEND_API_KEY: 'r', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev', BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev' },
  });
  // G2: a payload with no classification used to default to 'transactional' and pick Resend.
  // Absence no longer chooses a provider.
  assert.equal(router.selectAdapter({ content: { data: {} } }).adapter, null);
  assert.equal(router.selectAdapter({ content: { data: { classification: 'marketing' } } }).adapter.provider, 'brevo');
});

test('WIRING: end to end — a real campaign payload reaches the consent gate and the unsubscribe composer', async () => {
  const { service, queued } = campaignHarness();
  await service.executeCampaign('camp-1', { id: 'admin-1' });
  const payload = queued[0].payload;

  // Replay that exact payload through the worker, as the queue would.
  const suppressionQueries = [];
  const sent = [];
  const repository = {
    list: async (table, filters) => {
      if (table === 'communication_suppressions') { suppressionQueries.push(filters); return []; }
      return [];
    },
    findOne: async () => null,
    insert: async () => ({ id: 'a' }),
    updateById: async (_t, id) => ({ id }),
  };
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: { get: () => ({ provider: 'brevo', send: async (input) => { sent.push(input); return { accepted: true }; } }) },
  });
  await worker.deliverNotification({ id: 'n-1', channel: 'email', message: 'Weekly picks.', payload });

  assert.deepEqual(
    suppressionQueries, [{ channel: 'email', address: 'reader@example.test' }],
    'the send-time consent gate must actually run for a real campaign',
  );
  assert.ok(sent[0].content.html, 'the unsubscribe presentation must actually be composed for a real campaign');
  assert.ok(sent[0].content.html.includes('data-carup-unsubscribe'), 'and it must be the canonical control');
  assert.ok(sent[0].content.body.includes(payload.unsubscribe_url), 'the text part carries the same URL');
});
