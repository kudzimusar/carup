/**
 * The Communications AI provider (OC-4B, AI wave 2).
 *
 *   CommunicationAiRuntimeService (guardrail prompt, derivation types, preserved originals,
 *   human-approved send, high-risk routing — unchanged)
 *     → generate() here
 *         · GENERAL TEXT (summary, suggested reply, translation, intent, entities, next-best action)
 *             → domainAdvisoryAdapter.requestAdvisoryText → CarUp AI gateway → Cloudflare Gemma
 *         · MEDIA (audio transcription, image) — MULTIMODAL DEFERRED
 *             → the explicitly configured media provider (Groq Whisper / vision), unchanged
 *
 * The two routes never substitute for each other. A text request is never sent to the media
 * provider, and a gateway failure is a governed 503/502 — not a quiet retry on another vendor, which
 * would send conversation content to a service the operator did not choose and make an outage look
 * like a success. The media provider is consulted ONLY for a request that carries media.
 *
 * Contract kept for the runtime: health() and generate({ systemPrompt, userPrompt, media }) →
 * { text, provider, model } — plus the advisory provenance the gateway attests.
 */
import { AiAdvisoryError, requestAdvisoryText, inspectAdvisoryRuntime } from '../ai/domainAdvisoryAdapter.js';

const TEXT_TIMEOUT_MS = 30_000;

// Gateway failure codes that mean "no answer is available right now / here" (governed 503). Every
// other failure is an error in the answer itself (governed 502).
const UNAVAILABLE_CODES = new Set([
  'AI_PROVIDER_UNAVAILABLE', 'AI_TRANSPORT_UNAVAILABLE', 'AI_RATE_LIMITED', 'AI_CAPACITY_UNAVAILABLE',
  'AI_TIMEOUT', 'AI_TRANSPORT_ERROR', 'AI_ABORTED', 'AI_PROVIDER_AUTH_FAILED', 'AI_MODEL_REQUIRED',
]);

function governedError(message, statusCode, code, { retryable = false } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.retryable = retryable;
  return error;
}

function toGovernedError(error) {
  if (!(error instanceof AiAdvisoryError)) {
    return governedError('Communications AI is unavailable.', 503, 'communication_ai_provider_unavailable');
  }
  if (error.code === 'AI_EMPTY_RESPONSE') {
    return governedError('Communications AI provider returned no usable text.', 502, 'communication_ai_empty_response');
  }
  if (UNAVAILABLE_CODES.has(error.code)) {
    return governedError('Communications AI is unavailable.', 503, 'communication_ai_provider_unavailable', { retryable: error.retryable });
  }
  return governedError('Communications AI provider returned an unusable answer.', 502, 'communication_ai_provider_error');
}

const hasMedia = (media) => (Array.isArray(media) ? media : []).some((item) => item?.mimeType && item?.dataBase64);

export class CommunicationAiAssistProvider {
  constructor({ gateway = null, mediaProvider = null, mediaUnavailableReason = null } = {}) {
    this.deps = gateway ? { gateway } : {};
    this.mediaProvider = mediaProvider;
    this.mediaUnavailableReason = mediaUnavailableReason;
  }

  health() {
    let runtime = null;
    try {
      const inspection = inspectAdvisoryRuntime(this.deps);
      runtime = inspection?.ok ? inspection.runtime : null;
    } catch {
      runtime = null;
    }
    const textAvailable = runtime?.configured === true;
    const media = this.mediaProvider?.health?.() || {
      provider: null, model: null, available: false, mode: 'unconfigured', multimodal: false,
      reason: this.mediaUnavailableReason || 'No Communications media provider is configured.',
    };
    return {
      provider: runtime?.provider ?? null,
      model: runtime?.model ?? null,
      available: textAvailable,
      mode: textAvailable ? 'real' : 'unconfigured',
      authority: 'advisory',
      // Truthful capability reporting: text is the gateway's; vision and audio are the media
      // provider's, and are claimed only when that provider genuinely has them.
      multimodal: Boolean(media.available && media.multimodal),
      capabilities: {
        text: textAvailable,
        vision: Boolean(media.available && media.capabilities?.vision),
        audio_transcription: Boolean(media.available && media.capabilities?.audio_transcription),
      },
      routes: { text: 'carup_ai_gateway', media: media.provider || null },
      media,
    };
  }

  async generate({ systemPrompt, userPrompt, media = [] } = {}) {
    if (hasMedia(media)) {
      // MULTIMODAL DEFERRED: media keeps its explicit provider. No media provider → fail closed;
      // never describe an artifact the model did not receive.
      if (!this.mediaProvider) {
        throw governedError(this.mediaUnavailableReason || 'Communications AI media analysis is not configured.', 503, 'communication_ai_provider_unavailable');
      }
      return this.mediaProvider.generate({ systemPrompt, userPrompt, media });
    }

    let answer;
    try {
      answer = await requestAdvisoryText(
        { systemPrompt, userPrompt, timeoutMs: TEXT_TIMEOUT_MS, purpose: 'Communications AI' },
        this.deps,
      );
    } catch (error) {
      throw toGovernedError(error);
    }
    return {
      text: answer.text,
      provider: answer.provider,
      model: answer.model,
      execution: answer.execution,
      machine_output: true,
      authority: 'advisory',
    };
  }
}

export default CommunicationAiAssistProvider;
