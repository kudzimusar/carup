import { CommunicationRepository } from './communicationRepository.js';
import { CommunicationIdentityService } from './communicationIdentityService.js';
import { CommunicationThreadService } from './communicationThreadService.js';
import { CommunicationTemplateService } from './communicationTemplateService.js';
import { CommunicationGovernedTemplateService } from './communicationGovernedTemplateService.js';
import { CommunicationProductNotificationService } from './communicationProductNotificationService.js';
import { CommunicationCanonicalConversationService } from './communicationCanonicalConversationService.js';
import { CommunicationWorkflowService } from './communicationWorkflowService.js';
import { CommunicationIntelligenceService } from './communicationIntelligenceService.js';
import { CommunicationAnalyticsService } from './communicationAnalyticsService.js';
import { CommunicationGeminiProvider } from './communicationGeminiProvider.js';
import { CommunicationAiRuntimeService } from './communicationAiRuntimeService.js';
import { CommunicationInboundService } from './communicationInboundService.js';
import { CommunicationCanonicalWebhookService } from './communicationCanonicalWebhookService.js';
import { CommunicationDeliveryWorker } from './communicationDeliveryWorker.js';
import { CommunicationPreferenceService } from './communicationPreferenceService.js';
import { CommunicationMetaWhatsAppGovernedAdapter } from './communicationMetaWhatsAppGovernedAdapter.js';
import { createDefaultAdapterRegistry, assertRealTelegramAdapter } from './adapters/providerAdapters.js';
import { createCommunicationOrchestrator } from './communicationOrchestratorService.js';
import { createCommunicationConfigurationValidator } from './communicationConfigurationValidator.js';

function activateGovernedWhatsAppAdapter(registry, { injected = false } = {}) {
  if (injected) return registry;
  const adapter = registry.get('whatsapp');
  const health = adapter?.validateConfiguration?.() || {};
  if (adapter?.provider === 'meta_whatsapp_cloud_api' && health.mode !== 'fake') {
    registry.set('whatsapp', new CommunicationMetaWhatsAppGovernedAdapter({ env: process.env }));
  }
  return registry;
}

export function createCommunicationServices({ repository = null, adapterRegistry = null, aiProvider = null } = {}) {
  const repo = repository || new CommunicationRepository();
  const registry = activateGovernedWhatsAppAdapter(
    adapterRegistry || createDefaultAdapterRegistry(),
    { injected: Boolean(adapterRegistry) },
  );
  assertRealTelegramAdapter(registry);
  const identityService = new CommunicationIdentityService({ repository: repo });
  const threadService = new CommunicationThreadService({ repository: repo });
  const preferenceService = new CommunicationPreferenceService({ repository: repo });
  const templateService = new CommunicationGovernedTemplateService({
    repository: repo,
    fallbackService: new CommunicationTemplateService(),
  });
  const notificationService = new CommunicationProductNotificationService({
    repository: repo,
    threadService,
    preferenceService,
    templateService,
  });
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
  const analyticsService = new CommunicationAnalyticsService({ repository: repo });
  const communicationAiProvider = aiProvider || new CommunicationGeminiProvider();
  const aiRuntimeService = new CommunicationAiRuntimeService({
    conversationService,
    intelligenceService,
    provider: communicationAiProvider,
  });
  const inboundService = new CommunicationInboundService({
    repository: repo,
    identityService,
    threadService,
    notificationService,
    conversationService,
  });
  const webhookService = new CommunicationCanonicalWebhookService({
    repository: repo,
    inboundService,
    notificationService,
  });
  const deliveryWorker = new CommunicationDeliveryWorker({
    repository: repo,
    adapterRegistry: registry,
    notificationService,
  });
  const orchestrator = createCommunicationOrchestrator({
    repository: repo,
    threadService,
    notificationService,
    conversationService,
  });
  const configurationValidator = createCommunicationConfigurationValidator({ adapterRegistry: deliveryWorker.adapterRegistry });
  return {
    repository: repo,
    identityService,
    threadService,
    preferenceService,
    templateService,
    notificationService,
    conversationService,
    workflowService,
    intelligenceService,
    analyticsService,
    aiProvider: communicationAiProvider,
    aiRuntimeService,
    inboundService,
    webhookService,
    deliveryWorker,
    orchestrator,
    adapterRegistry: deliveryWorker.adapterRegistry,
    configurationValidator,
  };
}
