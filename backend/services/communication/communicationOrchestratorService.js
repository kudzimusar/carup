import { CommunicationNotificationService } from './communicationNotificationService.js';

export class CommunicationOrchestratorService {
  constructor({ notificationService, conversationService = null } = {}) {
    this.notificationService = notificationService;
    this.conversationService = conversationService;
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

    return this.notificationService.queueFromDomainEvent(event);
  }
}

export function createCommunicationOrchestrator(deps) {
  const notificationService = deps.notificationService || new CommunicationNotificationService(deps);
  return new CommunicationOrchestratorService({
    notificationService,
    conversationService: deps.conversationService || null,
  });
}
