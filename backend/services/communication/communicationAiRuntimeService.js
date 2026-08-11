const SYSTEM_GUARDRAIL = `You are CarUp Communications AI Assist.
You may summarize, translate, and draft suggested replies from the supplied canonical conversation only.
Never invent transaction facts, prices, identities, approvals, legal conclusions, insurance/finance decisions, escrow release decisions, or compliance outcomes.
Do not overwrite or reinterpret the user's authoritative message.
A suggested reply is a draft for a human to review; never claim it was sent.
If a request requires a regulated or high-impact decision, recommend human review.`;

function transcript(detail, limit = 24) {
  return (detail?.messages || []).slice(-limit).map((message) => {
    const role = message.author?.is_self ? 'Current user' : (message.author?.display_name || message.author?.stakeholder_role || 'Participant');
    return `${role}: ${message.text || ''}`;
  }).join('\n');
}

function latestSourceMessage(detail, requestedId = null) {
  const messages = detail?.messages || [];
  if (requestedId) return messages.find((row) => String(row.id) === String(requestedId)) || null;
  return [...messages].reverse().find((row) => String(row.text || '').trim()) || null;
}

export class CommunicationAiRuntimeService {
  constructor({ conversationService, intelligenceService, provider } = {}) {
    this.conversationService = conversationService;
    this.intelligenceService = intelligenceService;
    this.provider = provider;
  }

  health() {
    return this.provider?.health?.() || { available: false, provider: null, model: null, mode: 'unconfigured' };
  }

  async suggestReply(threadId, actor = {}, { source_message_id: sourceMessageId = null } = {}) {
    const detail = await this.conversationService.getConversation(threadId, actor);
    const source = latestSourceMessage(detail, sourceMessageId);
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `Draft one concise, professional reply for the current CarUp user to review before sending.\n\nConversation:\n${transcript(detail)}`,
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      source_message_id: source?.id || null,
      derivation_type: 'suggested_reply',
      output_text: generated.text,
      model_provider: generated.provider,
      model_name: generated.model,
      human_approved_for_send: false,
      provenance: { runtime: 'communications_ai_assist', auto_send: false },
    }, actor);
  }

  async summarize(threadId, actor = {}) {
    const detail = await this.conversationService.getConversation(threadId, actor);
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `Summarize this CarUp conversation factually in at most five bullets. Preserve uncertainty and do not add facts.\n\nConversation:\n${transcript(detail)}`,
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      derivation_type: 'summary',
      output_text: generated.text,
      model_provider: generated.provider,
      model_name: generated.model,
      provenance: { runtime: 'communications_ai_assist' },
    }, actor);
  }

  async translate(threadId, actor = {}, { source_message_id: sourceMessageId, target_language: targetLanguage } = {}) {
    if (!sourceMessageId || !targetLanguage) {
      const error = new Error('Translation requires source_message_id and target_language.');
      error.statusCode = 400;
      throw error;
    }
    const detail = await this.conversationService.getConversation(threadId, actor);
    const source = latestSourceMessage(detail, sourceMessageId);
    if (!source) {
      const error = new Error('Source message was not found in this conversation.');
      error.statusCode = 404;
      throw error;
    }
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `Translate the exact message below into ${targetLanguage}. Return only the translation. Preserve names, numbers, identifiers, and meaning.\n\n${source.text || ''}`,
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      source_message_id: source.id,
      derivation_type: 'translation',
      output_text: generated.text,
      target_language: String(targetLanguage),
      model_provider: generated.provider,
      model_name: generated.model,
      provenance: { runtime: 'communications_ai_assist', source_text_unchanged: true },
    }, actor);
  }
}
