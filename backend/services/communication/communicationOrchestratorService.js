import { CommunicationNotificationService } from './communicationNotificationService.js';
import { normalizeSafeTradeDomainEvent } from './adapters/safeTradeDomainEventAdapter.js';
import { EMAIL_VERIFIED_EVENT, queueLeadershipWelcome } from './producers/leadershipWelcomeProducer.js';

export class CommunicationOrchestratorService {
  constructor({ notificationService, conversationService = null, repository = null } = {}) {
    this.notificationService = notificationService;
    this.conversationService = conversationService;
    // C1 — the SafeTrade adapter resolves canonical participants from the transaction session, so
    // this seam needs read access. The factory already passed it; it was simply discarded.
    this.repository = repository;
  }

  async handleDomainEvent(eventPayload, _pgClient = null, tenantId = null) {
    const event = {
      ...eventPayload,
      event_type: eventPayload.event_type || eventPayload.eventType || eventPayload.type,
      tenant_id: tenantId || eventPayload.tenant_id || eventPayload.tenantId || null,
      payload: eventPayload.payload || eventPayload,
    };

    // Communications 2.0 reference path: Marketplace inquiry events become a
    // canonical buyer↔seller conversation with the exact inquiry as the first
    // message. Provider transports remain downstream of that conversation.
    if (event.event_type === 'marketplace.inquiry.created' && this.conversationService) {
      return this.conversationService.canonicalizeMarketplaceInquiry(event);
    }

    // R1 — the durable post-verification welcome.
    //
    // The event IS the work item. If the producer below throws, this handler throws, eventWorker
    // marks the outbox row `pending` again and retries it, and dead-letters only after MAX_ATTEMPTS.
    // The welcome can therefore no longer be lost by a transient fault, and the notification's own
    // dedupe_key keeps it to exactly one however many times the event is replayed.
    if (event.event_type === EMAIL_VERIFIED_EVENT) {
      const queued = await queueLeadershipWelcome({
        userId: event.payload?.recipientUserId || event.payload?.recipient_user_id || null,
        repository: this.repository,
        notificationService: this.notificationService,
      });
      return queued ? [queued] : [];
    }

    // C1 — the SINGLE SafeTrade normalization boundary.
    //
    // The ten SafeTrade emitters carry no recipient and speak their own field dialect, so without
    // this the notification layer resolves nobody and returns [] — silently, because the event
    // worker then marks the event processed. Everything downstream keeps speaking one dialect.
    //
    // A non-SafeTrade event returns null here and is passed through completely untouched.
    const adapted = await normalizeSafeTradeDomainEvent({
      eventType: event.event_type,
      payload: event.payload,
      repository: this.repository,
    });
    if (adapted) {
      // One durable domain event may legitimately address two principals. The persisted event is
      // NOT mutated into an ambiguous multi-recipient object; each recipient gets its own canonical
      // input, and `queueFromDomainEvent` already folds recipientUserId into the dedupe key, so the
      // two notifications carry independent deterministic identities.
      const queued = [];
      for (const recipientEvent of adapted.events) {
        const result = await this.notificationService.queueFromDomainEvent({
          ...event,
          tenant_id: event.tenant_id || recipientEvent.tenantId || null,
          payload: recipientEvent.payload,
        });
        queued.push(...(Array.isArray(result) ? result : [result].filter(Boolean)));
      }
      return queued;
    }

    return this.notificationService.queueFromDomainEvent(event);
  }
}

export function createCommunicationOrchestrator(deps) {
  const notificationService = deps.notificationService || new CommunicationNotificationService(deps);
  return new CommunicationOrchestratorService({
    notificationService,
    conversationService: deps.conversationService || null,
    repository: deps.repository || null,
  });
}
