import { ReferralAgentGatewayService } from '../referral/referralAgentGatewayServiceSafe.js';
import { ReferralChannelGatewayService } from '../referral/referralChannelGatewayService.js';
import { ReferralEngineService } from '../referral/referralEngineService.js';
import { CommunicationAiService } from './communicationAiService.js';
import { COMMUNICATION_EVENTS, normalizeChannel, nowIso } from './communicationUtils.js';
import { COMMUNICATION_AUDIT_EVENTS, logCommunicationAuditEvent } from './communicationAuditLog.js';

export class CommunicationInboundService {
  constructor({
    repository,
    identityService,
    threadService,
    notificationService,
    referralChannelGateway = null,
    aiService = null,
  } = {}) {
    this.repository = repository;
    this.identityService = identityService;
    this.threadService = threadService;
    this.notificationService = notificationService;
    this.referralChannelGateway = referralChannelGateway;
    this.aiService = aiService || new CommunicationAiService();
  }

  getReferralChannelGateway() {
    if (this.referralChannelGateway) return this.referralChannelGateway;
    this.referralChannelGateway = new ReferralChannelGatewayService({
      agentGateway: new ReferralAgentGatewayService({ referralService: new ReferralEngineService() }),
    });
    return this.referralChannelGateway;
  }

  async ingest(input = {}, actor = {}) {
    const channel = normalizeChannel(input.channel);
    if (!channel) throw new Error('Unsupported communication channel.');
    const provider = input.provider || channel;
    const externalSenderId = String(input.externalSenderId || input.external_sender_id || input.sender_id || input.from || actor.actor_user_id || '').trim();
    if (!externalSenderId) throw new Error('Inbound message requires an external sender.');
    const text = input.text || input.message || input.caption || '';

    const identity = await this.identityService.resolveOrCreateIdentity({
      tenant_id: input.tenant_id || actor.actor_tenant_id || null,
      user_id: input.user_id || actor.actor_user_id || null,
      channel,
      provider,
      external_id: externalSenderId,
      display_name: input.display_name || null,
      authenticated: Boolean(input.user_id || actor.actor_user_id),
      consent_status: input.consent_status || input.consent?.status || 'unknown',
      metadata: { source: input.source || channel },
    });

    let referralResult = null;
    try {
      referralResult = await this.getReferralChannelGateway().processInbound(channel, {
        text,
        message: text,
        sender_id: externalSenderId,
        conversation_id: input.externalConversationId || input.conversation_id || input.thread_id || externalSenderId,
        thread_id: input.externalConversationId || input.thread_id || externalSenderId,
        message_id: input.providerMessageId || input.provider_message_id || input.message_id || null,
        referral_code: input.referralCode || input.referral_code || null,
        code: input.code || null,
        source: input.source || channel,
        payload: input.metadata || {},
      }, {
        ...actor,
        actor_type: 'agent',
        actor_user_id: actor.actor_user_id || input.user_id || null,
        actor_tenant_id: actor.actor_tenant_id || input.tenant_id || 'platform',
        gateway_trusted: Boolean(actor.gateway_trusted),
        surface: channel,
      });
    } catch (error) {
      referralResult = { success: false, error: error.message };
    }

    const classification = this.aiService.classify(text, {
      forceHuman: input.force_human || referralResult?.validation?.valid === false,
    });
    const aiAnswer = this.aiService.safeAnswer(text, {
      forceHuman: classification.handoffRequired,
    });
    const threadType = this.threadTypeForIntent(classification.intent);
    const priority = classification.intent === 'complaint' || classification.intent === 'fraud_report' ? 'high' : 'normal';

    let thread = input.thread?.id ? input.thread : null;
    let created = false;
    const targetThreadId = input.target_thread_id || input.threadId || input.thread_id || null;
    if (!thread && targetThreadId) {
      thread = await this.repository.findOne('message_threads', { id: targetThreadId });
      if (!thread) throw new Error('Target communication thread not found.');
    }
    if (!thread) {
      const resolved = await this.threadService.resolveOrCreateThread({
        tenant_id: input.tenant_id || actor.actor_tenant_id || null,
        thread_type: threadType,
        subject_type: input.subject_type || threadType,
        subject_id: input.subject_id || input.marketplace_listing_id || input.escrow_id || input.financing_application_id || null,
        primary_user_id: identity.user_id || input.user_id || null,
        external_identity_id: identity.id,
        external_conversation_id: input.externalConversationId || input.conversation_id || externalSenderId,
        primary_channel: channel,
        priority,
        status: classification.handoffRequired || aiAnswer.handoffRequired ? 'awaiting_human' : 'awaiting_ai',
        intent: classification.intent,
        referral_code_id: referralResult?.validation?.code?.id || null,
        referral_campaign_id: referralResult?.validation?.code?.campaign_id || null,
        marketplace_listing_id: input.marketplace_listing_id || null,
        escrow_id: input.escrow_id || null,
        financing_application_id: input.financing_application_id || null,
        metadata: {
          intent: classification.intent,
          referral_code: referralResult?.extracted_referral_code || null,
          referral_validation: referralResult?.validation?.valid ?? null,
          source_channel: channel,
        },
      });
      thread = resolved.thread;
      created = resolved.created;
    }

    const participant = await this.threadService.addParticipant(thread.id, {
      participant_type: identity.user_id ? 'user' : 'external_contact',
      user_id: identity.user_id || null,
      external_identity_id: identity.id,
      role: 'requester',
      display_name: identity.display_name || null,
    });

    const message = await this.threadService.recordMessage(thread, {
      direction: 'inbound',
      sender_participant_id: participant.id,
      sender_user_id: identity.user_id || null,
      channel,
      provider,
      provider_message_id: input.providerMessageId || input.provider_message_id || input.message_id || null,
      content_text: text,
      content_json: {
        canonical_event: COMMUNICATION_EVENTS.MESSAGE_RECEIVED,
        provider_timestamp: input.providerTimestamp || input.provider_timestamp || null,
        technical_metadata: input.metadata || {},
        referral: referralResult,
        classification,
      },
      status: 'received',
      thread_status: classification.handoffRequired || aiAnswer.handoffRequired ? 'awaiting_human' : 'awaiting_ai',
    });

    if (classification.handoffRequired || aiAnswer.handoffRequired) {
      await this.threadService.escalateThread(thread.id, classification.intent || 'human_request', {
        severity: priority === 'high' ? 'high' : 'normal',
        source: 'ai_policy',
        team: this.threadService.teamForThread(thread.thread_type || threadType),
      });
    } else if (this.notificationService && (identity.user_id || input.user_id)) {
      await this.notificationService.queueNotification({
        recipientUserId: identity.user_id || input.user_id,
        thread,
        notificationType: 'message_acknowledgement',
        channel,
        templateKey: 'message_acknowledgement_v1',
        variables: { topic: classification.intent, reference: thread.id },
        priority: 'normal',
        dedupeParts: ['ack', thread.id, message.id, channel],
      });
    }

    // Lifecycle audit (fail-soft): inbound receipt → AI classification → AI draft (item 2).
    const auditBase = { tenant_id: thread.tenant_id ?? null, thread_id: thread.id, message_id: message.id, channel };
    await logCommunicationAuditEvent(this.repository, {
      ...auditBase, event_type: COMMUNICATION_AUDIT_EVENTS.INBOUND_RECEIVED, actor_type: 'customer',
      actor_id: identity.user_id || null, correlation_id: message.provider_message_id || null, summary: 'Inbound message received',
    });
    await logCommunicationAuditEvent(this.repository, {
      ...auditBase, event_type: COMMUNICATION_AUDIT_EVENTS.AI_CLASSIFIED, actor_type: 'ai',
      summary: `AI classified as ${classification.intent || 'unknown'}`,
      metadata: { intent: classification.intent ?? null, handoff_required: Boolean(classification.handoffRequired || aiAnswer.handoffRequired) },
    });
    if (aiAnswer && (aiAnswer.reply || aiAnswer.draft)) {
      await logCommunicationAuditEvent(this.repository, {
        ...auditBase, event_type: COMMUNICATION_AUDIT_EVENTS.AI_DRAFTED, actor_type: 'ai',
        summary: aiAnswer.handoffRequired ? 'AI drafted a reply (pending human)' : 'AI drafted a reply',
      });
    }

    return {
      success: true,
      duplicate: false,
      created_thread: created,
      thread,
      message,
      identity,
      classification,
      ai: aiAnswer,
      referral: referralResult,
      reply: aiAnswer.reply || referralResult?.reply || 'CarUp received your message.',
      received_at: nowIso(),
    };
  }

  threadTypeForIntent(intent) {
    if (intent === 'marketplace_inquiry') return 'marketplace_inquiry';
    if (intent === 'finance_question') return 'finance';
    if (intent === 'escrow_question') return 'escrow';
    if (intent === 'referral_question') return 'referral';
    if (intent === 'complaint') return 'complaint';
    if (intent === 'fraud_report' || intent === 'safety_report') return 'trust_safety';
    return 'support';
  }
}
