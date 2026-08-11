import { CommunicationRepository } from './communicationRepository.js';
import { CommunicationIdentityService } from './communicationIdentityService.js';
import { CommunicationThreadService } from './communicationThreadService.js';
import { CommunicationNotificationService } from './communicationNotificationService.js';
import { CommunicationConversationService } from './communicationConversationService.js';
import { CommunicationWorkflowService } from './communicationWorkflowService.js';
import { CommunicationIntelligenceService } from './communicationIntelligenceService.js';
import { CommunicationInboundService } from './communicationInboundService.js';
import { CommunicationWebhookService } from './communicationWebhookService.js';
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
  const conversationService = new CommunicationConversationService({
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
  const webhookService = new CommunicationWebhookService({ repository: repo, inboundService });
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
