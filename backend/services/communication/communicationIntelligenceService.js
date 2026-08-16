import { nowIso } from './communicationUtils.js';

const ALLOWED_DERIVATIONS = new Set([
  'summary', 'translation', 'transcript', 'intent', 'entity_extraction',
  'suggested_reply', 'image_classification', 'document_extraction', 'next_best_action',
]);

export class CommunicationIntelligenceService {
  constructor({ repository, conversationService } = {}) {
    this.repository = repository;
    this.conversationService = conversationService;
  }

  async recordDerivation(input = {}, actor = {}) {
    const derivationType = String(input.derivation_type || input.type || '').trim();
    if (!ALLOWED_DERIVATIONS.has(derivationType)) {
      const error = new Error(`Unsupported communication derivation: ${derivationType}`);
      error.statusCode = 400;
      throw error;
    }
    const threadId = input.thread_id;
    if (!threadId) throw new Error('thread_id is required for a communication derivation.');

    if (actor?.id || actor?.userId) {
      await this.conversationService.assertParticipantAccess(threadId, actor, 'read');
    }

    let sourceMessage = null;
    if (input.source_message_id) {
      sourceMessage = await this.repository.findOne('messages', { id: input.source_message_id });
      if (!sourceMessage || sourceMessage.thread_id !== threadId) {
        const error = new Error('Source message does not belong to this conversation.');
        error.statusCode = 400;
        throw error;
      }
    }

    const derivation = await this.repository.insert('message_derivations', {
      thread_id: threadId,
      source_message_id: sourceMessage?.id || null,
      derivation_type: derivationType,
      source_language: input.source_language || sourceMessage?.language || null,
      target_language: input.target_language || null,
      model_provider: input.model_provider || null,
      model_name: input.model_name || null,
      model_version: input.model_version || null,
      output_text: input.output_text || null,
      output_json: {
        derived: true,
        original_message_unchanged: true,
        ...(input.output_json || {}),
      },
      confidence: input.confidence ?? null,
      provenance: {
        generated_at: nowIso(),
        source_message_id: sourceMessage?.id || null,
        human_approved_for_send: Boolean(input.human_approved_for_send),
        ...(input.provenance || {}),
      },
      human_reviewed: Boolean(input.human_reviewed),
      reviewed_by: input.reviewed_by || null,
      created_at: nowIso(),
    });

    await this.conversationService.recordAnalytics({
      threadId,
      messageId: sourceMessage?.id || null,
      eventType: derivationType === 'suggested_reply' ? 'ai_assisted_response' : `ai_${derivationType}`,
      workflow: input.business_workflow || null,
      metadata: {
        derivation_id: derivation.id,
        derivation_type: derivationType,
        model_name: input.model_name || null,
        human_reviewed: Boolean(input.human_reviewed),
      },
    });
    return derivation;
  }

  async listDerivations(threadId, actor = {}) {
    await this.conversationService.assertParticipantAccess(threadId, actor, 'read');
    return this.repository.list('message_derivations', { thread_id: threadId }, { order: { column: 'created_at', ascending: true } });
  }

  async createSuggestedReply({ thread_id: threadId, source_message_id: sourceMessageId = null, text, ...metadata } = {}, actor = {}) {
    return this.recordDerivation({
      thread_id: threadId,
      source_message_id: sourceMessageId,
      derivation_type: 'suggested_reply',
      output_text: text,
      ...metadata,
    }, actor);
  }

  async createTranslation({ thread_id: threadId, source_message_id: sourceMessageId, text, source_language: sourceLanguage, target_language: targetLanguage, ...metadata } = {}, actor = {}) {
    if (!sourceMessageId || !targetLanguage) throw new Error('Translation requires source_message_id and target_language.');
    return this.recordDerivation({
      thread_id: threadId,
      source_message_id: sourceMessageId,
      derivation_type: 'translation',
      output_text: text,
      source_language: sourceLanguage || null,
      target_language: targetLanguage,
      ...metadata,
    }, actor);
  }
}
