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
    conversationService = null,
    referralChannelGateway = null,
    aiService = null,
  } = {}) {
    this.repository = repository;
    this.identityService = identityService;
    this.threadService = threadService;
    this.notificationService = notificationService;
    this.conversationService = conversationService;
    this.referralChannelGateway = referralChannelGateway;
    this.aiService = aiService || new CommunicationAiService();
  }

  getReferralChannelGateway() {
    if (this.referralChannelGateway) return this.referralChannelGateway;
    // Hand the referral engine the same Supabase client this service already reads through.
    // Constructed with no client it builds a repository that throws "Referral repository
    // requires a Supabase-compatible client" on every call, and because inbound referral
    // processing is best-effort the failure is swallowed into referralResult — so inbound
    // attribution silently never records. Every other construction site passes { client }.
    // Deliberately NOT falling back to the module-level client: an injected in-memory
    // repository has none, and inventing one there would put live calls into tests.
    this.referralChannelGateway = new ReferralChannelGatewayService({
      agentGateway: new ReferralAgentGatewayService({
        referralService: new ReferralEngineService({ client: this.repository?.client || null }),
      }),
    });
    return this.referralChannelGateway;
  }

  /**
   * Prefer explicit provider reply context over a recency guess.
   *
   * Meta WhatsApp sends the provider message id being replied to in message.context.id.
   * The parser passes that value as externalConversationId. Delivery attempts already
   * persist the provider message id together with the canonical CarUp message id, so
   * this gives us a deterministic bridge:
   * provider reply context -> delivery attempt -> canonical message -> conversation.
   *
   * The identity must also have a live binding to that exact conversation. This
   * prevents an unrelated/stale provider id from being used to jump conversations.
   */
  async resolveProviderReplyContext({ identity, channel, provider, externalConversationId } = {}) {
    const contextId = String(externalConversationId || '').trim();
    if (!identity?.id || !contextId) return null;

    const normalizedChannel = normalizeChannel(channel);
    const attempts = await this.repository.list('message_delivery_attempts', { provider_message_id: contextId });
    const candidates = new Map();

    for (const attempt of attempts) {
      if (!attempt?.message_id) continue;
      if (normalizedChannel && normalizeChannel(attempt.channel) !== normalizedChannel) continue;
      if (provider && attempt.provider && attempt.provider !== provider) continue;

      const outboundMessage = await this.repository.findOne('messages', { id: attempt.message_id });
      if (!outboundMessage?.thread_id) continue;

      const bindings = (await this.repository.list('conversation_channel_bindings', {
        thread_id: outboundMessage.thread_id,
        channel_identity_id: identity.id,
      }))
        .filter((binding) => binding.can_receive !== false)
        .filter((binding) => !normalizedChannel || binding.channel === normalizedChannel)
        .filter((binding) => !provider || !binding.provider || binding.provider === provider)
        .filter((binding) => !binding.expires_at || Date.parse(binding.expires_at) > Date.now());

      for (const binding of bindings) {
        const participant = await this.repository.findOne('message_participants', { id: binding.participant_id });
        if (!participant || participant.left_at || participant.thread_id !== outboundMessage.thread_id) continue;
        const thread = await this.repository.findOne('message_threads', { id: outboundMessage.thread_id });
        if (!thread) continue;
        candidates.set(thread.id, {
          thread,
          participant,
          binding,
          resolution: 'provider_reply_context',
          replied_to_message_id: outboundMessage.id,
          provider_message_id: contextId,
        });
      }
    }

    // Never guess if corrupted/ambiguous provider data resolves to multiple CarUp
    // conversations. The normal binding resolver can still use a separately
    // unambiguous active binding; otherwise the message lands in a safe new/support
    // path instead of leaking across business conversations.
    if (candidates.size !== 1) return null;
    return [...candidates.values()][0];
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
    let boundConversation = null;
    const targetThreadId = input.target_thread_id || input.threadId || input.thread_id || null;
    if (!thread && targetThreadId) {
      thread = await this.repository.findOne('message_threads', { id: targetThreadId });
      if (!thread) throw new Error('Target communication thread not found.');
    }

    // Communications 2.0: explicit provider reply context wins. If there is no
    // exact context match, fall back to the canonical identity/channel binding
    // resolver, which itself refuses ambiguous equal-recency candidates.
    if (!thread && !targetThreadId && this.conversationService) {
      const externalConversationId = input.externalConversationId || input.conversation_id || null;
      boundConversation = await this.resolveProviderReplyContext({
        identity,
        channel,
        provider,
        externalConversationId,
      });
      if (!boundConversation) {
        boundConversation = await this.conversationService.resolveInboundConversation({
          identity,
          channel,
          provider,
          externalConversationId,
        });
        if (boundConversation) boundConversation.resolution = boundConversation.resolution || 'active_channel_binding';
      }
      if (boundConversation?.thread) thread = boundConversation.thread;
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

    // When the inbound resolved to an existing conversation, THAT conversation's participant is the
    // authoritative sender. Calling ensureParticipant here instead used to mint a second participant
    // built from the INGRESS identity — physically reproduced on staging: a provider-ingress inbound
    // routed correctly to a tenant-owned Marketplace thread, then attributed the message to a new
    // participant carrying the platform-context (tenant-null) identity, linking that identity into
    // another tenant's conversation. The ingress identity is an ingress identity only; it must never
    // be projected into a conversation the resolver did not select it for.
    let participant;
    if (boundConversation?.participant) {
      const bound = boundConversation.participant;
      // Fail closed rather than manufacture a replacement: an invariant break here means the
      // resolution cannot be trusted, and inventing a participant is what caused the defect.
      if (!thread?.id
        || String(bound.thread_id) !== String(thread.id)
        || bound.left_at) {
        const error = new Error('Resolved inbound conversation participant failed thread/active invariants.');
        error.statusCode = 422;
        error.code = 'inbound_participant_invariant_failed';
        throw error;
      }
      participant = bound;
    } else if (this.conversationService) {
      // Genuinely unbound inbound: this is the only path allowed to create a participant.
      participant = await this.conversationService.ensureParticipant(thread.id, {
        participant_type: identity.user_id ? 'user' : 'external_contact',
        user_id: identity.user_id || null,
        external_identity_id: identity.id,
        stakeholder_role: 'requester',
        display_name: identity.display_name || null,
      });
    } else {
      participant = await this.threadService.addParticipant(thread.id, {
        participant_type: identity.user_id ? 'user' : 'external_contact',
        user_id: identity.user_id || null,
        external_identity_id: identity.id,
        role: 'requester',
        display_name: identity.display_name || null,
      });
    }
    // Attribution follows the SELECTED participant, never the ingress identity, so a tenant-owned
    // conversation is not silently credited to a platform-scoped user id.
    const senderUserId = boundConversation?.participant
      ? (participant.user_id || null)
      : (identity.user_id || null);

    const providerMessageId = input.providerMessageId || input.provider_message_id || input.message_id || null;
    const findExistingProviderMessage = async () => {
      if (!providerMessageId) return null;
      const matches = await this.repository.list('messages', { provider, provider_message_id: providerMessageId }, { limit: 1 });
      return matches[0] || null;
    };
    let message = await findExistingProviderMessage();
    let duplicateMessage = Boolean(message);
    if (!message) {
      try {
        message = await this.threadService.recordMessage(thread, {
          direction: 'inbound',
          sender_participant_id: participant.id,
          sender_user_id: senderUserId,
          channel,
          provider,
          provider_message_id: providerMessageId,
          content_text: text,
          content_json: {
            canonical_event: COMMUNICATION_EVENTS.MESSAGE_RECEIVED,
            original_authoritative: true,
            ai_derived: false,
            provider_timestamp: input.providerTimestamp || input.provider_timestamp || null,
            technical_metadata: input.metadata || {},
            referral: referralResult,
            classification,
            conversation_binding_id: boundConversation?.binding?.id || null,
            conversation_resolution: boundConversation?.resolution || null,
            replied_to_message_id: boundConversation?.replied_to_message_id || null,
          },
          status: 'received',
          // A provider reply that returned to a business conversation should
          // reopen/continue that conversation, not reclassify it as an AI queue.
          thread_status: boundConversation ? 'open' : (classification.handoffRequired || aiAnswer.handoffRequired ? 'awaiting_human' : 'awaiting_ai'),
        });
      } catch (error) {
        if (error.code !== '23505' || !providerMessageId) throw error;
        message = await findExistingProviderMessage();
        if (!message) throw error;
        duplicateMessage = true;
      }
    }

    if (boundConversation?.binding && !duplicateMessage && this.conversationService) {
      await this.conversationService.recordInboundBinding(boundConversation.binding, message);
      await this.repository.updateById('message_threads', thread.id, {
        last_inbound_at: message.created_at,
        status: 'open',
      }).catch(() => null);
      await this.conversationService.recordAnalytics({
        threadId: thread.id,
        messageId: message.id,
        participantId: participant.id,
        eventType: 'message_received',
        workflow: thread.business_workflow || thread.thread_type,
        funnelStage: thread.funnel_stage || 'conversation',
        metadata: {
          channel,
          provider,
          same_thread_return: true,
          resolution: boundConversation.resolution || 'active_channel_binding',
          replied_to_message_id: boundConversation.replied_to_message_id || null,
        },
      });
    }

    if (!boundConversation && !duplicateMessage && (classification.handoffRequired || aiAnswer.handoffRequired)) {
      await this.threadService.escalateThread(thread.id, classification.intent || 'human_request', {
        severity: priority === 'high' ? 'high' : 'normal',
        source: 'ai_policy',
        team: this.threadService.teamForThread(thread.thread_type || threadType),
      });
    } else if (!boundConversation && !duplicateMessage && this.notificationService && (identity.user_id || input.user_id)) {
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

    const auditBase = { tenant_id: thread.tenant_id ?? null, thread_id: thread.id, message_id: message.id, channel };
    await logCommunicationAuditEvent(this.repository, {
      ...auditBase, event_type: COMMUNICATION_AUDIT_EVENTS.INBOUND_RECEIVED, actor_type: 'customer',
      actor_id: identity.user_id || null, correlation_id: message.provider_message_id || null,
      summary: boundConversation ? 'Inbound message returned to canonical conversation' : 'Inbound message received',
      metadata: {
        same_thread_return: Boolean(boundConversation),
        conversation_binding_id: boundConversation?.binding?.id || null,
        resolution: boundConversation?.resolution || null,
        replied_to_message_id: boundConversation?.replied_to_message_id || null,
      },
    });
    await logCommunicationAuditEvent(this.repository, {
      ...auditBase, event_type: COMMUNICATION_AUDIT_EVENTS.AI_CLASSIFIED, actor_type: 'ai',
      summary: `AI classified as ${classification.intent || 'unknown'}`,
      metadata: { intent: classification.intent ?? null, handoff_required: Boolean(classification.handoffRequired || aiAnswer.handoffRequired), derived_only: true },
    });
    if (aiAnswer && (aiAnswer.reply || aiAnswer.draft)) {
      await logCommunicationAuditEvent(this.repository, {
        ...auditBase, event_type: COMMUNICATION_AUDIT_EVENTS.AI_DRAFTED, actor_type: 'ai',
        summary: aiAnswer.handoffRequired ? 'AI drafted a reply (pending human)' : 'AI drafted a reply',
        metadata: { derived_only: true },
      });
    }

    return {
      success: true,
      duplicate: duplicateMessage,
      created_thread: created,
      same_thread_return: Boolean(boundConversation),
      conversation_resolution: boundConversation?.resolution || null,
      replied_to_message_id: boundConversation?.replied_to_message_id || null,
      thread,
      message,
      identity,
      classification,
      ai: aiAnswer,
      referral: referralResult,
      reply: boundConversation ? null : (aiAnswer.reply || referralResult?.reply || 'CarUp received your message.'),
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
