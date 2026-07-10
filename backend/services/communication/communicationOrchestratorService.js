import { CommunicationNotificationService } from './communicationNotificationService.js';

export class CommunicationOrchestratorService {
  constructor({ notificationService } = {}) {
    this.notificationService = notificationService;
  }

  async handleDomainEvent(eventPayload, _pgClient = null, tenantId = null) {
    const event = {
      ...eventPayload,
      event_type: eventPayload.event_type || eventPayload.eventType || eventPayload.type,
      tenant_id: tenantId || eventPayload.tenant_id || eventPayload.tenantId || null,
      payload: eventPayload.payload || eventPayload,
    };
    return this.notificationService.queueFromDomainEvent(event);
  }
}

export function createCommunicationOrchestrator(deps) {
  const notificationService = deps.notificationService || new CommunicationNotificationService(deps);
  return new CommunicationOrchestratorService({ notificationService });
}

