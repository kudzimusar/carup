/**
 * Outbox forwarding + dedupe discrimination (database-contract audit, seam-E).
 *
 * The eventWorker invokes every subscriber as handler(payload, pgClient, tenantId, event)
 * where the 4th argument is the RAW domain_events outbox record (see
 * backend/services/eventBus/eventWorker.js processEvent). The communication listener must
 * forward that record so the notification layer can:
 *   (a) stamp notification_queue.event_id from event.id, and
 *   (b) build a PER-EVENT dedupe key instead of a per-user/per-type one that silently
 *       swallows every repeat event for the same recipient.
 * Additionally, when no outbox id is available the payload fallback chain must
 * discriminate on sessionId/evidenceId/vin so verification / evidence-review /
 * listing-moderation events for the same user never collapse into one notification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { createCommunicationOrchestrator } from '../services/communication/communicationOrchestratorService.js';
import { registerCommunicationListeners } from '../services/communication/communicationEventListeners.js';

function createServices() {
  const repository = new MemoryCommunicationRepository();
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const orchestrator = createCommunicationOrchestrator({ notificationService });
  return { repository, threadService, notificationService, orchestrator };
}

test('listener forwards the raw outbox record: event_id lands on the queue row and dedupe is per-event', async () => {
  const services = createServices();
  const subscriptions = new Map();
  const fakeWorker = {
    subscribe(eventType, handler) {
      subscriptions.set(eventType, handler);
    },
  };
  registerCommunicationListeners(fakeWorker, services);
  const handler = subscriptions.get('identity.verification.decided');
  assert.ok(handler, 'identity.verification.decided must be subscribed');

  // Two decisions for the SAME user on DIFFERENT sessions, invoked exactly the way
  // eventWorker.processEvent invokes handlers: (payload, pgClient, tenantId, rawOutboxEvent).
  const outboxA = { id: 'evt-outbox-1', event_type: 'identity.verification.decided', tenant_id: null, created_at: '2026-08-09T00:00:00.000Z' };
  const outboxB = { id: 'evt-outbox-2', event_type: 'identity.verification.decided', tenant_id: null, created_at: '2026-08-09T00:05:00.000Z' };
  await handler({ sessionId: 'sess-1', userId: 'user-1', recipientUserId: 'user-1', decision: 'approve' }, null, null, outboxA);
  await handler({ sessionId: 'sess-2', userId: 'user-1', recipientUserId: 'user-1', decision: 'request_resubmission' }, null, null, outboxB);

  const queueRows = await services.repository.list('notification_queue');
  assert.equal(queueRows.length, 2, 'two distinct decisions for the same user must queue two notifications');
  assert.deepEqual(
    queueRows.map((row) => row.event_id).sort(),
    ['evt-outbox-1', 'evt-outbox-2'],
    'notification_queue.event_id must be populated from the raw outbox record id'
  );
  assert.notEqual(queueRows[0].dedupe_key, queueRows[1].dedupe_key, 'dedupe keys must discriminate per event, not per user/type');
});

test('payload sessionId keeps verification decisions discriminated even without an outbox id', async () => {
  const { repository, notificationService } = createServices();
  await notificationService.queueFromDomainEvent({
    event_type: 'identity.verification.decided',
    payload: { sessionId: 'sess-A', recipientUserId: 'user-9', decision: 'approve' },
  });
  await notificationService.queueFromDomainEvent({
    event_type: 'identity.verification.decided',
    payload: { sessionId: 'sess-B', recipientUserId: 'user-9', decision: 'decline' },
  });

  const queueRows = await repository.list('notification_queue');
  assert.equal(queueRows.length, 2, 'different sessionIds must not collapse into one dedupe key');
  assert.notEqual(queueRows[0].dedupe_key, queueRows[1].dedupe_key);

  // Identical event (same session) is still deduped — the second call replays the first row.
  await notificationService.queueFromDomainEvent({
    event_type: 'identity.verification.decided',
    payload: { sessionId: 'sess-A', recipientUserId: 'user-9', decision: 'approve' },
  });
  assert.equal((await repository.list('notification_queue')).length, 2, 'a retried identical event must stay deduped');
});

test('payload vin discriminates listing-moderation events without an outbox id', async () => {
  const { repository, notificationService } = createServices();
  for (const vin of ['VIN-AAA', 'VIN-BBB']) {
    await notificationService.queueFromDomainEvent({
      event_type: 'marketplace.listing.moderated',
      payload: { vin, listingId: vin, action: 'approve', status: 'Available', recipientUserId: 'owner-1' },
    });
  }
  assert.equal((await repository.list('notification_queue')).length, 2, 'moderation events for different VINs must queue separately');
});
