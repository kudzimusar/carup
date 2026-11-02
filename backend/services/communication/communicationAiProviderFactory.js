import { CommunicationAiAssistProvider } from './communicationAiAssistProvider.js';
import { CommunicationGroqProvider } from './communicationGroqProvider.js';

/**
 * Build the Communications AI provider (OC-4B, AI wave 2).
 *
 * GENERAL TEXT always runs on the CarUp AI gateway (Cloudflare Gemma) through the domain adapter.
 * No environment variable selects another text vendor: the general model is a platform decision
 * (aiRuntimeConfig), not a per-domain one.
 *
 * COMMUNICATION_AI_PROVIDER now selects only the MEDIA provider — the one capability that is
 * genuinely multimodal (MULTIMODAL DEFERRED: it has not converged on the gateway yet):
 *   groq    the default, and the provider Communications 2.0 certified on staging (Whisper audio;
 *           vision only where the account has a vision model).
 *   gemini  RETIRED. Communications 2.0 shipped with "Gemini = NOT REQUIRED"; general text now runs on
 *           the gateway, so it has no remaining role, and a key becoming available must not quietly
 *           bring it back.
 * Selection is explicit and never silently substituted: an unknown or retired value leaves media
 * analysis unavailable (governed 503) and says why in health().media.reason. Text is unaffected.
 */

const MEDIA_PROVIDERS = {
  groq: (options) => new CommunicationGroqProvider(options),
};

const RETIRED_MEDIA_PROVIDERS = {
  gemini: 'COMMUNICATION_AI_PROVIDER="gemini" is retired (OC-4B): Communications general text runs on the CarUp AI ' +
    'gateway, and media analysis runs on the explicitly configured media provider (groq).',
};

/** The supported MEDIA providers. General text has exactly one route: the CarUp AI gateway. */
export const SUPPORTED_AI_PROVIDERS = Object.keys(MEDIA_PROVIDERS);

export function createCommunicationAiProvider({ env = process.env, gateway = null, ...options } = {}) {
  const configured = String(env.COMMUNICATION_AI_PROVIDER || '').trim().toLowerCase();
  const name = configured || 'groq';

  let mediaProvider = null;
  let mediaUnavailableReason = null;
  if (RETIRED_MEDIA_PROVIDERS[name]) {
    mediaUnavailableReason = RETIRED_MEDIA_PROVIDERS[name];
  } else if (!MEDIA_PROVIDERS[name]) {
    mediaUnavailableReason = `COMMUNICATION_AI_PROVIDER="${configured}" is not a supported Communications media provider (${SUPPORTED_AI_PROVIDERS.join(', ')}).`;
  } else {
    // Constructed but keyless is still a real configuration answer: its health() reports
    // available:false and generate() throws the governed 503. Reported, never swapped.
    mediaProvider = MEDIA_PROVIDERS[name](options);
  }

  return new CommunicationAiAssistProvider({ gateway, mediaProvider, mediaUnavailableReason });
}

export default createCommunicationAiProvider;
