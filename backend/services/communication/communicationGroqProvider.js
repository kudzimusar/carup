/**
 * Groq adapter for Communications AI.
 *
 * Implements the same two-method contract CommunicationAiRuntimeService already consumes —
 * health() and generate({ systemPrompt, userPrompt, media }) — so nothing else in Communications
 * learns anything Groq-specific. The runtime keeps owning the guardrail prompt, the derivation
 * shape and the governance; this file only knows how to talk to one provider.
 *
 * Two capabilities, deliberately separated because they are different endpoints and conflating
 * them is how audio ends up smuggled into a chat payload as text:
 *
 *   · text and vision → POST /openai/v1/chat/completions
 *   · audio           → POST /openai/v1/audio/transcriptions  (Whisper, multipart)
 *
 * Vision is implemented and configurable, but is NOT usable on every account: the models available
 * to a given key are the account's capability list, and a key without a vision model must fail
 * closed rather than silently degrade an image into a text-only prompt and return a confident
 * answer about a picture it never saw.
 */

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Kept generous but finite: a hung provider call must not hold a request open indefinitely.
const DEFAULT_TIMEOUT_MS = 30_000;

function providerError(message, { statusCode = 502, code = 'communication_ai_provider_error' } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function unavailable(message) {
  return providerError(message, { statusCode: 503, code: 'communication_ai_provider_unavailable' });
}

const isAudio = (mimeType) => /^audio\//i.test(String(mimeType || ''));
const isImage = (mimeType) => /^image\//i.test(String(mimeType || ''));

export class CommunicationGroqProvider {
  constructor({
    apiKey = process.env.GROQ_API_KEY || process.env.CARUP_KIMI_GROQ_API_KEY,
    // Separately configurable on purpose: text, vision and audio are different models with
    // different availability, and one env var would force an account that has Whisper but no
    // vision model to choose between them.
    textModel = process.env.COMMUNICATION_AI_TEXT_MODEL || process.env.COMMUNICATION_AI_MODEL || 'llama-3.3-70b-versatile',
    visionModel = process.env.COMMUNICATION_AI_VISION_MODEL || null,
    audioModel = process.env.COMMUNICATION_AI_AUDIO_MODEL || 'whisper-large-v3',
    baseUrl = process.env.COMMUNICATION_AI_BASE_URL || GROQ_BASE_URL,
    timeoutMs = Number(process.env.COMMUNICATION_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiKey = apiKey;
    this.textModel = textModel;
    this.visionModel = visionModel;
    this.audioModel = audioModel;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
    this.provider = 'groq';
    // The runtime reads `model` for provenance; it is the text model unless a call routes elsewhere,
    // and every generate() result reports the model actually used rather than this default.
    this.model = textModel;
  }

  health() {
    return {
      provider: this.provider,
      model: this.textModel,
      available: Boolean(this.apiKey && this.fetchImpl),
      mode: 'real',
      // Truthful capability reporting: vision is only claimed when a vision model is configured.
      multimodal: Boolean(this.visionModel),
      capabilities: {
        text: Boolean(this.apiKey && this.fetchImpl),
        vision: Boolean(this.apiKey && this.fetchImpl && this.visionModel),
        audio_transcription: Boolean(this.apiKey && this.fetchImpl && this.audioModel),
      },
      models: { text: this.textModel, vision: this.visionModel, audio: this.audioModel },
    };
  }

  assertConfigured() {
    if (!this.apiKey || !this.fetchImpl) {
      throw unavailable('Communications AI provider is not configured.');
    }
  }

  async request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw providerError('Communications AI provider timed out.');
      // Never surface the underlying request object; it carries the Authorization header.
      throw providerError('Communications AI provider request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Whisper transcription. The artifact is sent as a file to the audio endpoint — the one place
   * where "media" must not be flattened into a prompt.
   */
  async transcribe(item) {
    this.assertConfigured();
    if (!this.audioModel) throw unavailable('Communications AI audio transcription is not configured.');

    const bytes = Buffer.from(item.dataBase64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: item.mimeType }), item.filename || 'audio');
    form.append('model', this.audioModel);
    form.append('response_format', 'json');

    const response = await this.request('/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw providerError(payload?.error?.message || `Communications AI provider returned HTTP ${response.status}.`);
    }
    const text = String(payload?.text || '').trim();
    if (!text) {
      throw providerError('Communications AI provider returned no usable text.', { code: 'communication_ai_empty_response' });
    }
    return { text, provider: this.provider, model: this.audioModel };
  }

  async generate({ systemPrompt, userPrompt, media = [] } = {}) {
    this.assertConfigured();

    const items = (Array.isArray(media) ? media : []).filter((m) => m?.mimeType && m?.dataBase64);
    const audio = items.filter((m) => isAudio(m.mimeType));
    const images = items.filter((m) => isImage(m.mimeType));
    const others = items.filter((m) => !isAudio(m.mimeType) && !isImage(m.mimeType));

    // A single audio artifact is a transcription job, not a chat completion.
    if (audio.length && !images.length && !others.length) {
      return this.transcribe(audio[0]);
    }

    // Anything the configured models genuinely cannot read must fail closed. Answering anyway would
    // produce a confident description of an artifact the model never received — the exact failure
    // an "AI derivation" must never have.
    if (images.length && !this.visionModel) {
      throw unavailable(
        'Communications AI vision is not configured for this provider account; image analysis is unavailable.',
      );
    }
    if (others.length) {
      throw unavailable(
        `Communications AI cannot interpret media type ${others[0].mimeType} with the configured provider models.`,
      );
    }
    if (audio.length && (images.length || others.length)) {
      throw unavailable('Communications AI cannot mix audio transcription with other media in one request.');
    }

    const model = images.length ? this.visionModel : this.textModel;
    const content = [{ type: 'text', text: userPrompt || '' }];
    for (const image of images) {
      content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` } });
    }

    const response = await this.request('/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: images.length ? content : (userPrompt || '') },
        ],
        temperature: 0.2,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw providerError(payload?.error?.message || `Communications AI provider returned HTTP ${response.status}.`);
    }
    const text = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      throw providerError('Communications AI provider returned no usable text.', { code: 'communication_ai_empty_response' });
    }
    return { text, provider: this.provider, model };
  }
}
