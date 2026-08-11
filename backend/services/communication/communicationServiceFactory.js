import { CommunicationRepository } from './communicationRepository.js';
import { CommunicationIdentityService } from './communicationIdentityService.js';
import { CommunicationThreadService } from './communicationThreadService.js';
import { CommunicationNotificationService } from './communicationNotificationService.js';
import { CommunicationCanonicalConversationService } from './communicationCanonicalConversationService.js';
import { CommunicationWorkflowService } from './communicationWorkflowService.js';
import { CommunicationIntelligenceService } from './communicationIntelligenceService.js';
import { CommunicationInboundService } from './communicationInboundService.js';
import { CommunicationCanonicalWebhookService } from './communicationCanonicalWebhookService.js';
import { CommunicationDeliveryWorker } from './communicationDeliveryWorker.js';
import { CommunicationPreferenceService } from './communicationPreferenceService.js';
import { createDefaultAdapterRegistry, assertRealTelegramAdapter } from './adapters/providerAdapters.js';
import { createCommunicationOrchestrator } from './communicationOrchestratorService.js';
import { createCommunicationConfigurationValidator } from './communicationConfigurationValidator.js';

export function createCommunicationServices({ repository = null, adapterRegistry = null } = {}) {
  const repo = repository || new CommunicationRepository();
  const registry = adapterRegistry || createDefaultAdapterRegistry();
  assertRealTelegramAdapter(registry);
  const identityService = new CommunicationIdentityService({ repository: repo });
  const threadService = new CommunicationThreadService({ repository: repo });
  const preferenceService = new CommunicationPreferenceService({ repository: repo });
  const notificationService = new CommunicationNotificationService({ repository: repo, threadService, preferenceService });
  const conversationService = new CommunicationCanonicalConversationService({
    repository: repo,
    threadService,
    identityService,
    notificationService,
  });
  const workflowService = new CommunicationWorkflowService({
    repository: repo,
    threadService,
    conversationService,
  });
  const intelligenceService = new CommunicationIntelligenceService({
    repository: repo,
    conversationService,
  });
  const inboundService = new CommunicationInboundService({
    repository: repo,
    identityService,
    threadService,
    notificationService,
    conversationService,
  });
  // Keep the proven webhook verification/parsing surface, but use the Communications
  // 2.0 subclass that fails closed when a provider receipt cannot be mapped to exactly
  // one canonical delivery attempt. This is one webhook path, not a second transport.
  const webhookService = new CommunicationCanonicalWebhookService({ repository: repo, inboundService });
  const deliveryWorker = new CommunicationDeliveryWorker({ repository: repo, adapterRegistry: registry });
  const orchestrator = createCommunicationOrchestrator({ repository: repo, threadService, notificationService, conversationService });
  const configurationValidator = createCommunicationConfigurationValidator({ adapterRegistry: deliveryWorker.adapterRegistry });
  return {
    repository: repo,
    identityService,
    threadService,
    preferenceService,
    notificationService,
    conversationService,
    workflowService,
    intelligenceService,
    inboundService,
    webhookService,
    deliveryWorker,
    orchestrator,
    adapterRegistry: deliveryWorker.adapterRegistry,
    configurationValidator,
  };
}
