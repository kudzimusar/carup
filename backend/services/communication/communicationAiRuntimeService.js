const SYSTEM_GUARDRAIL = `You are CarUp Communications AI Assist.
You may summarize, translate, extract intent/entities, interpret user-provided media, and draft suggested replies from the supplied canonical conversation only.
Never invent transaction facts, prices, identities, approvals, legal conclusions, insurance/finance decisions, escrow release decisions, or compliance outcomes.
Do not overwrite or reinterpret the user's authoritative message or original artifact.
A suggested reply or next-best action is a draft for a human to review; never claim it was sent or executed.
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

function derivationForPart(part = {}) {
  if (part.part_type === 'audio') return 'transcript';
  if (part.part_type === 'image' || part.part_type === 'video') return 'image_classification';
  if (part.part_type === 'document') return 'document_extraction';
  return 'summary';
}

function promptForPart(part = {}) {
  if (part.part_type === 'audio') {
    return 'Transcribe the user-provided audio accurately. Preserve names, numbers, vehicle identifiers and uncertainty. Do not infer missing words.';
  }
  if (part.part_type === 'image') {
    return 'Describe the user-provided image for this automotive conversation. Extract visible vehicle/part/document facts only when clearly observable. Flag uncertainty and do not invent identity, condition, ownership or authenticity claims.';
  }
  if (part.part_type === 'video') {
    return 'Summarize the user-provided video for this automotive conversation. Report only observable facts and flag uncertainty. Do not infer ownership, authenticity, safety or legal conclusions.';
  }
  if (part.part_type === 'document') {
    return 'Extract the important user-provided document facts relevant to this CarUp conversation. Preserve names, dates, references and amounts exactly where visible, flag uncertainty, and do not make legal/finance/insurance decisions.';
  }
  return 'Summarize this user-provided artifact factually.';
}

export class CommunicationAiRuntimeService {
  constructor({ conversationService, intelligenceService, mediaService = null, provider } = {}) {
    this.conversationService = conversationService;
    this.intelligenceService = intelligenceService;
    this.mediaService = mediaService;
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

  async detectIntent(threadId, actor = {}, { source_message_id: sourceMessageId = null } = {}) {
    const detail = await this.conversationService.getConversation(threadId, actor);
    const source = latestSourceMessage(detail, sourceMessageId);
    if (!source) {
      const error = new Error('No source message is available for intent detection.');
      error.statusCode = 404;
      throw error;
    }
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `Identify the likely intent of the exact CarUp message below. Be concise and include uncertainty when needed. Do not decide finance, insurance, escrow, legal, government or trust outcomes.\n\n${source.text || ''}`,
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      source_message_id: source.id,
      derivation_type: 'intent',
      output_text: generated.text,
      model_provider: generated.provider,
      model_name: generated.model,
      provenance: { runtime: 'communications_ai_assist', source_text_unchanged: true },
    }, actor);
  }

  async extractEntities(threadId, actor = {}, { source_message_id: sourceMessageId = null } = {}) {
    const detail = await this.conversationService.getConversation(threadId, actor);
    const source = latestSourceMessage(detail, sourceMessageId);
    if (!source) {
      const error = new Error('No source message is available for entity extraction.');
      error.statusCode = 404;
      throw error;
    }
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `Extract only explicitly stated useful entities from the exact CarUp message below: vehicle make/model/year, VIN/plate/reference, location, date/time, amount/currency, person/business names, and requested action. Return concise text; do not infer missing entities.\n\n${source.text || ''}`,
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      source_message_id: source.id,
      derivation_type: 'entity_extraction',
      output_text: generated.text,
      model_provider: generated.provider,
      model_name: generated.model,
      provenance: { runtime: 'communications_ai_assist', source_text_unchanged: true },
    }, actor);
  }

  async nextBestAction(threadId, actor = {}) {
    const detail = await this.conversationService.getConversation(threadId, actor);
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `Suggest one safe next action for the current CarUp user based only on this conversation. The output is advisory for human review, not an automated decision or action. If this is finance, insurance, escrow, government, legal, compliance or trust/safety, route the decision to the appropriate human.\n\nConversation:\n${transcript(detail)}`,
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      derivation_type: 'next_best_action',
      output_text: generated.text,
      model_provider: generated.provider,
      model_name: generated.model,
      human_approved_for_send: false,
      provenance: { runtime: 'communications_ai_assist', auto_execute: false },
    }, actor);
  }

  async analyzeMedia(threadId, actor = {}, { part_id: partId } = {}) {
    if (!partId || !this.mediaService) {
      const error = new Error('A stored message part is required for media analysis.');
      error.statusCode = 400;
      throw error;
    }
    const media = await this.mediaService.downloadPartBytes(partId, actor);
    if (String(media.message.thread_id) !== String(threadId)) {
      const error = new Error('Message part does not belong to this conversation.');
      error.statusCode = 400;
      throw error;
    }
    const generated = await this.provider.generate({
      systemPrompt: SYSTEM_GUARDRAIL,
      userPrompt: `${promptForPart(media.part)}\n\nConversation context:\n${transcript(await this.conversationService.getConversation(threadId, actor), 12)}`,
      media: [{
        mimeType: media.part.mime_type || 'application/octet-stream',
        dataBase64: media.buffer.toString('base64'),
      }],
    });
    return this.intelligenceService.recordDerivation({
      thread_id: threadId,
      source_message_id: media.message.id,
      derivation_type: derivationForPart(media.part),
      output_text: generated.text,
      model_provider: generated.provider,
      model_name: generated.model,
      provenance: {
        runtime: 'communications_ai_multimodal',
        source_part_id: media.part.id,
        source_artifact_unchanged: true,
        auto_execute: false,
      },
      output_json: { source_part_id: media.part.id, part_type: media.part.part_type },
    }, actor);
  }
}
