import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommunicationCampaignService,
  deterministicCampaignDeliveryId,
} from '../services/communication/communicationCampaignService.js';

/**
 * C5 — the campaign delivery id must survive a retry.
 *
 * THE DEFECT. `idempotencyKey` is deterministic (`campaign:<id>:<user>:<variant>`) and
 * `queueNotification` dedupes deterministically, but `deliveryId` was `randomUUID()`. So:
 *
 *   attempt 1  mint id A -> queueNotification stores payload.campaign_delivery_id = A
 *              -> the delivery-row insert FAILS -> the per-recipient catch swallows it and continues
 *   retry      no delivery row exists, so the idempotency skip does not fire
 *              -> mint id B -> queueNotification DEDUPES and returns the attempt-1 notification,
 *                 whose payload still says A
 *              -> insert the delivery row with id = B
 *
 * Brevo is handed A. The deliveries table records B. Reconciliation joins on the delivery id and
 * finds nothing, so the send is permanently unattributable. No customer harm — which is why this is
 * P2 and not a blocker — but the marketing ledger is wrong and cannot self-correct.
 *
 * The previous suite could not catch it: it only ever ran a campaign once, and a single clean attempt
 * has nothing to disagree with.
 */

const CAMPAIGN = {
  id: 'camp-1', tenant_id: 'platform', campaign_code: 'weekly-2026-08', classification: 'marketing',
  channel: 'email', status: 'approved', template_key: 'carup_weekly_v1', language: 'en',
  business_workflow: 'growth', segment_definition: { user_ids: ['u-1'] }, experiment_variants: [],
  frequency_cap_count: 5, frequency_cap_window_hours: 168, attribution: {}, promotion_id: null,
};
const USER = { id: 'u-1', email: 'reader@example.test', role: 'buyer' };

/**
 * A harness whose notification store DEDUPES like the real one, and whose delivery-row insert can be
 * made to fail exactly once — reproducing the partial failure that creates the divergence.
 */
function harness({ failDeliveryInsertTimes = 0 } = {}) {
  const notifications = new Map(); // dedupe_key -> the notification returned to the caller
  const deliveries = [];
  const wireIds = [];             // what the provider would be told, per queued notification
  let deliveryInsertFailures = 0;

  const repository = {
    findOne: async (table, filters) => {
      if (table === 'communication_campaigns') return { ...CAMPAIGN };
      if (table === 'communication_campaign_deliveries') {
        return deliveries.find((d) => d.idempotency_key === filters.idempotency_key) || null;
      }
      return null;
    },
    list: async (table) => {
      if (table === 'users') return [USER];
      if (table === 'channel_identities') {
        return [{ id: 'ci-1', user_id: 'u-1', channel: 'email', verified: true, normalized_address: 'reader@example.test', consent_status: 'granted', provider: 'resend' }];
      }
      return [];
    },
    insert: async (table, row) => {
      if (table === 'communication_campaign_deliveries') {
        if (deliveryInsertFailures < failDeliveryInsertTimes) {
          deliveryInsertFailures += 1;
          throw new Error('simulated delivery-row persistence failure');
        }
        deliveries.push(row);
      }
      return row;
    },
    updateById: async (table, id, patch) => (table === 'communication_campaigns' ? { ...CAMPAIGN, ...patch, id } : { id, ...patch }),
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
      // Deterministic dedupe, exactly like CommunicationCanonicalNotificationService: a repeat of the
      // same logical send returns the ORIGINAL notification, payload and all.
      queueNotification: async (input) => {
        const key = (input.dedupeParts || []).join(':');
        if (notifications.has(key)) return notifications.get(key);
        const notification = {
          notification: { id: `n-${notifications.size + 1}`, status: 'queued', payload: input.payload, metadata: {} },
          message: { id: `m-${notifications.size + 1}` },
        };
        notifications.set(key, notification);
        wireIds.push(input.payload.campaign_delivery_id);
        return notification;
      },
    },
    unsubscribeService: { issue: async () => ({ url: 'https://carup.dev/u/x', mailto: 'mailto:unsubscribe@carup.dev' }) },
  });

  return { service, repository, deliveries, notifications, wireIds };
}

test('C5-1 the derived id is deterministic, valid, and distinct per logical delivery', () => {
  const a = deterministicCampaignDeliveryId('campaign:camp-1:u-1:control');
  const again = deterministicCampaignDeliveryId('campaign:camp-1:u-1:control');
  assert.equal(a, again, 'the same logical delivery must always derive the same id');
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'the column is uuid NOT NULL, so this must be a real RFC 4122 UUID');

  for (const other of ['campaign:camp-2:u-1:control', 'campaign:camp-1:u-2:control', 'campaign:camp-1:u-1:variant-b']) {
    assert.notEqual(deterministicCampaignDeliveryId(other), a, `a different logical delivery must not collide: ${other}`);
  }
});

test('C5-2 THE FAILURE SEQUENCE: a retry after a failed delivery-row insert reuses the SAME id', async () => {
  const h = harness({ failDeliveryInsertTimes: 1 });

  // Attempt 1 — the notification persists; the delivery row does not.
  const first = await h.service.executeCampaign('camp-1');
  assert.equal(h.notifications.size, 1, 'the notification was queued');
  assert.equal(h.deliveries.length, 0, 'the delivery row failed to persist');
  assert.equal(first.errors.length, 1, 'and the failure was recorded rather than hidden');

  // Retry — no delivery row exists, so the idempotency skip does not fire and the recipient is
  // processed again. The notification dedupes and comes back with attempt 1's payload.
  await h.service.executeCampaign('camp-1');
  assert.equal(h.notifications.size, 1, 'no second notification — it deduped, exactly as in production');
  assert.equal(h.deliveries.length, 1, 'the delivery row persisted on the retry');

  // The whole point: the id on the wire and the id in the table are the same value.
  const wireId = h.wireIds[0];
  const rowId = h.deliveries[0].id;
  assert.equal(rowId, wireId,
    'Brevo would be told one id while the ledger recorded another — the reconciliation join would fail');
  assert.equal(rowId, deterministicCampaignDeliveryId('campaign:camp-1:u-1:control'));
});

test('C5-3 one canonical delivery attribution — a third run adds nothing', async () => {
  const h = harness({ failDeliveryInsertTimes: 1 });
  await h.service.executeCampaign('camp-1');
  await h.service.executeCampaign('camp-1');
  const third = await h.service.executeCampaign('camp-1');
  assert.equal(h.deliveries.length, 1, 'exactly one delivery row for one logical delivery');
  assert.equal(h.notifications.size, 1);
  assert.equal(third.existing, 1, 'the third run is skipped by the delivery idempotency key');
});

test('C5-4 the clean path is unchanged — wire id and row id agree on the first attempt', async () => {
  const h = harness();
  await h.service.executeCampaign('camp-1');
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.deliveries[0].id, h.wireIds[0]);
  assert.equal(h.deliveries[0].idempotency_key, 'campaign:camp-1:u-1:control');
});

test('C5-5 the delivery row still carries the notification join as a second recovery path', async () => {
  const h = harness();
  await h.service.executeCampaign('camp-1');
  assert.ok(h.deliveries[0].notification_id, 'notification_id remains available for reconciliation');
  assert.equal(h.deliveries[0].campaign_id, 'camp-1');
});
