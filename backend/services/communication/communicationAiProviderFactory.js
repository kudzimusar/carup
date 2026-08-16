import { CommunicationGeminiProvider } from './communicationGeminiProvider.js';
import { CommunicationGroqProvider } from './communicationGroqProvider.js';

/**
 * Choose the Communications AI provider explicitly.
 *
 * The canonical plan is provider-neutral: it requires a real provider, labelled derivations,
 * preserved originals and governed high-risk decisions — not one named vendor. Wiring
 * `new CommunicationGeminiProvider()` straight into the service factory made one vendor a release
 * dependency, which is what this boundary removes.
 *
 * Selection is explicit and never silently substituted. If the configured provider is unavailable,
 * health().available is false and the AI endpoints fail closed with the existing governed 503 —
 * falling back to a different vendor would quietly send content to a service the operator did not
 * choose, and would make an outage look like a success.
 */

const PROVIDERS = {
  groq: (options) => new CommunicationGroqProvider(options),
  gemini: (options) => new CommunicationGeminiProvider(options),
};

export const SUPPORTED_AI_PROVIDERS = Object.keys(PROVIDERS);

/**
 * An unconfigured provider still has to answer health() and fail closed on generate(), because the
 * health endpoint must be able to report "unconfigured" rather than throw, and every AI route must
 * refuse rather than fabricate.
 */
class UnconfiguredCommunicationAiProvider {
  constructor(reason) {
    this.provider = null;
    this.model = null;
    this.reason = reason;
  }

  health() {
    return { provider: null, model: null, available: false, mode: 'unconfigured', multimodal: false, reason: this.reason };
  }

  async generate() {
    const error = new Error(this.reason);
    error.statusCode = 503;
    error.code = 'communication_ai_provider_unavailable';
    throw error;
  }
}

export function createCommunicationAiProvider({ env = process.env, ...options } = {}) {
  const configured = String(env.COMMUNICATION_AI_PROVIDER || '').trim().toLowerCase();

  // Default only when nothing is configured, and default to the provider this release certifies.
  // An unrecognised value is a configuration error, not an invitation to guess.
  const name = configured || 'groq';
  const build = PROVIDERS[name];
  if (!build) {
    return new UnconfiguredCommunicationAiProvider(
      `COMMUNICATION_AI_PROVIDER="${configured}" is not a supported Communications AI provider (${SUPPORTED_AI_PROVIDERS.join(', ')}).`,
    );
  }

  const provider = build(options);
  // Constructed but keyless is still a real configuration answer: health() reports available:false
  // and generate() throws the governed 503. Reported here rather than swapped for another vendor.
  return provider;
}

export default createCommunicationAiProvider;
