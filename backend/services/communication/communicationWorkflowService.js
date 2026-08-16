import { buildDedupeKey, nowIso } from './communicationUtils.js';

const WORKFLOW_THREAD_TYPES = Object.freeze({
  marketplace: 'marketplace_inquiry',
  dealer: 'general',
  garage: 'general',
  parts: 'general',
  insurance: 'general',
  finance: 'finance',
  diaspora_import: 'import',
  container_logistics: 'container',
  referral: 'referral',
  government_public_service: 'general',
  trust_safety: 'trust_safety',
  support: 'support',
});

export class CommunicationWorkflowService {
  constructor({ repository, threadService, conversationService } = {}) {
    this.repository = repository;
    this.threadService = threadService;
    this.conversationService = conversationService;
  }

  assertWorkflow(workflow) {
    if (!WORKFLOW_THREAD_TYPES[workflow]) {
      const error = new Error(`Unsupported communication workflow: ${workflow}`);
      error.statusCode = 400;
      throw error;
    }
  }

  async ensureBusinessConversation(input = {}) {
    const workflow = String(input.business_workflow || input.workflow || '').trim();
    this.assertWorkflow(workflow);
    const subjectType = input.subject_type || workflow;
    const subjectId = String(input.subject_id || '').trim();
    if (!subjectId) {
      const error = new Error('subject_id is required for a business conversation.');
      error.statusCode = 400;
      throw error;
    }
    const participants = Array.isArray(input.participants) ? input.participants : [];
    if (participants.length < 2) {
      const error = new Error('A business conversation requires at least two participants.');
      error.statusCode = 400;
      throw error;
    }

    const deterministicKey = input.thread_key || buildDedupeKey([
      'communications-2', workflow, input.tenant_id || 'platform', subjectType, subjectId,
    ]);
    const compatibilityPrimary = participants.find((p) => p.user_id)?.user_id || null;
    let { thread, created } = await this.threadService.resolveOrCreateThread({
      tenant_id: input.tenant_id || null,
      thread_key: deterministicKey,
      thread_type: input.thread_type || WORKFLOW_THREAD_TYPES[workflow],
      subject_type: subjectType,
      subject_id: subjectId,
      primary_user_id: compatibilityPrimary,
      primary_channel: input.primary_channel || 'in_app',
      priority: input.priority || 'normal',
      marketplace_listing_id: input.marketplace_listing_id || null,
      escrow_id: input.escrow_id || null,
      financing_application_id: input.financing_application_id || null,
      metadata: input.metadata || {},
    });
    thread = await this.repository.updateById('message_threads', thread.id, {
      business_workflow: workflow,
      conversation_type: input.conversation_type || workflow,
      funnel_stage: input.funnel_stage || thread.funnel_stage || 'conversation',
      conversion_status: input.conversion_status || thread.conversion_status || 'open',
      metadata: { ...(thread.metadata || {}), ...(input.metadata || {}) },
      updated_at: nowIso(),
    });

    const ensuredParticipants = [];
    for (const participantInput of participants) {
      ensuredParticipants.push(await this.conversationService.ensureParticipant(thread.id, participantInput));
    }

    if (input.initial_message?.text) {
      const senderRole = input.initial_message.sender_role;
      const sender = ensuredParticipants.find((p) => (p.stakeholder_role || p.role) === senderRole)
        || ensuredParticipants.find((p) => p.id === input.initial_message.sender_participant_id);
      if (!sender) {
        const error = new Error('Initial message sender is not a conversation participant.');
        error.statusCode = 400;
        throw error;
      }
      const clientMessageId = input.initial_message.client_message_id
        || buildDedupeKey(['workflow-initial', thread.id, input.initial_message.source_id || subjectId]);
      const existing = (await this.repository.list('messages', { thread_id: thread.id }))
        .find((row) => row.client_message_id === clientMessageId);
      if (!existing) {
        const message = await this.threadService.recordMessage(thread, {
          direction: input.initial_message.direction || 'inbound',
          message_type: input.initial_message.message_type || 'text',
          sender_participant_id: sender.id,
          sender_user_id: sender.user_id || null,
          channel: input.initial_message.channel || 'in_app',
          provider: input.initial_message.provider || null,
          client_message_id: clientMessageId,
          content_text: String(input.initial_message.text),
          content_json: {
            original_authoritative: true,
            ai_derived: false,
            business_workflow: workflow,
            subject_type: subjectType,
            subject_id: subjectId,
            ...(input.initial_message.metadata || {}),
          },
          status: input.initial_message.status || 'received',
          thread_status: 'open',
        });
        await this.conversationService.recordAnalytics({
          threadId: thread.id,
          messageId: message.id,
          participantId: sender.id,
          eventType: created ? 'conversation_started' : 'message_received',
          workflow,
          funnelStage: thread.funnel_stage || 'conversation',
          attribution: input.attribution || {},
          metadata: { subject_type: subjectType, subject_id: subjectId },
        });
      }
    }

    return { thread, participants: ensuredParticipants, created };
  }
}

export const communicationWorkflowTypes = Object.freeze(Object.keys(WORKFLOW_THREAD_TYPES));
