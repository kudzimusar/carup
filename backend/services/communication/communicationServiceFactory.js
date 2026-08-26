import { CommunicationRepository } from './communicationRepository.js';
import { CommunicationIdentityService } from './communicationIdentityService.js';
import { CommunicationThreadService } from './communicationThreadService.js';
import { CommunicationTemplateService } from './communicationTemplateService.js';
import { CommunicationGovernedTemplateService } from './communicationGovernedTemplateService.js';
import { CommunicationProductNotificationService } from './communicationProductNotificationService.js';
import { CommunicationCanonicalConversationService } from './communicationCanonicalConversationService.js';
import { CommunicationWorkflowService } from './communicationWorkflowService.js';
import { CommunicationStakeholderContractService } from './communicationStakeholderContractService.js';
import { CommunicationIntelligenceService } from './communicationIntelligenceService.js';
import { CommunicationAnalyticsService } from './communicationAnalyticsService.js';
import { createCommunicationAiProvider } from './communicationAiProviderFactory.js';
import { CommunicationAiRuntimeService } from './communicationAiRuntimeService.js';
import { CommunicationMediaService } from './communicationMediaService.js';
import { CommunicationCampaignService } from './communicationCampaignService.js';
import { CommunicationInboundService } from './communicationInboundService.js';
import { CommunicationCanonicalWebhookService } from './communicationCanonicalWebhookService.js';
import { createEmailReplyTokenService } from './emailReplyTokenService.js';
import { createMarketingUnsubscribeService } from './marketingUnsubscribeService.js';
import { ResendInboundResolver } from './resendWebhookService.js';
import { createResendInboundContentService } from './resendInboundContentService.js';
import { CommunicationDeliveryWorker } from './communicationDeliveryWorker.js';
import { renderEmailForNotification } from './emailExperience/renderEmail.js';
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

export function createCommunicationServices({ repository = null, adapterRegistry = null, aiProvider = null, storageClient = null } = {}) {
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
  const stakeholderService = new CommunicationStakeholderContractService({
    repository: repo,
    workflowService,
  });
  const intelligenceService = new CommunicationIntelligenceService({
    repository: repo,
    conversationService,
  });
  const mediaService = new CommunicationMediaService({
    repository: repo,
    conversationService,
    threadService,
    storageClient: storageClient || repo.client || null,
  });
  const analyticsService = new CommunicationAnalyticsService({ repository: repo });
  // Provider chosen explicitly by configuration rather than hard-wired to one vendor; the
  // canonical plan requires a real provider, not a named one.
  const communicationAiProvider = aiProvider || createCommunicationAiProvider();
  const aiRuntimeService = new CommunicationAiRuntimeService({
    conversationService,
    intelligenceService,
    mediaService,
    provider: communicationAiProvider,
  });
  // E5/E7: minted per marketing send so the recipient's own copy carries a working unsubscribe.
  const unsubscribeService = createMarketingUnsubscribeService({ supabase: repo.client });
  const campaignService = new CommunicationCampaignService({
    repository: repo,
    unsubscribeService,
    threadService,
    conversationService,
    preferenceService,
    notificationService,
    templateService,
  });
  const inboundService = new CommunicationInboundService({
    repository: repo,
    identityService,
    threadService,
    notificationService,
    conversationService,
  });
  // E4 inbound reply routing. Both of these take the raw Supabase client (they issue .from().select()
  // directly), not the repository wrapper. Until they were injected here, handleResendInboundWebhook
  // rejected every signed inbound reply with "Resend inbound routing is not configured."
  const replyTokenService = createEmailReplyTokenService({ supabase: repo.client, env: process.env });
  const inboundResolver = new ResendInboundResolver({ supabase: repo.client, replyTokenService });
  // Resend's email.received carries metadata only; the real body is fetched by email_id.
  const inboundContentService = createResendInboundContentService({});
  const webhookService = new CommunicationCanonicalWebhookService({
    repository: repo,
    inboundService,
    inboundResolver,
    replyTokenService,
    inboundContentService,
    notificationService,
  });
  const deliveryWorker = new CommunicationDeliveryWorker({
    repository: repo,
    adapterRegistry: registry,
    notificationService,
    // G2 — the canonical Email renderer, injected here so there is one wiring point for every route
    // and worker rather than an import buried in the dispatch path.
    emailRenderer: renderEmailForNotification,
    // G5 — the same service the inbound resolver uses, so outbound minting and inbound resolution
    // can never drift onto two different token authorities.
    replyTokenService,
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
    stakeholderService,
    intelligenceService,
    mediaService,
    analyticsService,
    aiProvider: communicationAiProvider,
    aiRuntimeService,
    campaignService,
    inboundService,
    replyTokenService,
    unsubscribeService,
    inboundResolver,
    inboundContentService,
    webhookService,
    deliveryWorker,
    orchestrator,
    adapterRegistry: deliveryWorker.adapterRegistry,
    configurationValidator,
  };
}
