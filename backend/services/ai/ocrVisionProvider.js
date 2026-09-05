/**
 * The OCR vision provider boundary.
 *
 * Document Intelligence asks this module for "the configured vision provider" and gets one
 * object with a stable shape. Which provider that is comes from CARUP_OCR_PROVIDER and nothing
 * else — there is deliberately NO automatic fallback. A provider that is down or unconfigured
 * produces an honest failure, never a silent switch to a different model whose readings would
 * then be attributed to the wrong provenance.
 *
 * Adding a provider here does not change what a reading MEANS. Document Intelligence still
 * observes and the domain authorities still decide; every provider's output is projected onto
 * CarUp's own document schema and dropped where it cannot be verified.
 */

import { askGeminiVision, GEMINI_VISION_MODEL } from './GeminiClient.js';
import { askCloudflareVision, CLOUDFLARE_VISION_MODEL, isCloudflareVisionConfigured, TRANSPORTS } from './CloudflareVisionClient.js';

export const DEFAULT_OCR_PROVIDER = 'cloudflare';

/**
 * Models this project has REJECTED, and may not silently become the selected model again.
 *
 * `@cf/meta/llama-3.2-11b-vision-instruct` reads clean documents well — which is exactly why it is
 * named here. Shown the corpus non-document fixture (a landscape photograph containing no text and
 * no document) it returned a complete invented Zimbabwean identity with legible:true and
 * confidence 1, reproducibly, across three prompt variants at temperature 0. Good clean-document
 * performance is not a reason to reselect it. Reinstating it requires a separately governed
 * investigation proving materially different behaviour, not a configuration change.
 */
export const REJECTED_MODELS = {
  '@cf/meta/llama-3.2-11b-vision-instruct':
    'REJECTED 2026-09-05 — fabricated 8 identity fields from the non-document landscape fixture at confidence 1.',
};

/** The model Cloudflare OCR runs, overridable for a governed evaluation of another candidate. */
export function resolveCloudflareModel(env = process.env) {
  const model = String(env.CARUP_OCR_MODEL || CLOUDFLARE_VISION_MODEL).trim();
  if (REJECTED_MODELS[model]) {
    throw new Error(`Refusing to use "${model}": ${REJECTED_MODELS[model]}`);
  }
  if (!TRANSPORTS[model]) {
    throw new Error(`No verified Workers AI transport for "${model}". Probe its image and response shape before enabling it.`);
  }
  return model;
}

const cloudflareProvider = {
  id: 'cloudflare',
  get model() { return resolveCloudflareModel(); },
  isConfigured: () => isCloudflareVisionConfigured(),
  requiredEnv: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  async extract({ systemPrompt, textPrompt, images, jsonSchema, timeoutMs }) {
    const { content, usage } = await askCloudflareVision(systemPrompt, textPrompt, images, jsonSchema, {
      model: resolveCloudflareModel(),
      timeoutMs,
    });
    return { content, usage };
  },
};

/**
 * Gemini remains implemented and selectable, but is NOT the default and is not used during the
 * Cloudflare certification. It stays so the boundary demonstrably supports more than one
 * provider, and so a deliberate switch is a configuration change rather than a code change.
 */
const geminiProvider = {
  id: 'gemini',
  model: GEMINI_VISION_MODEL,
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  requiredEnv: ['GEMINI_API_KEY'],
  async extract({ systemPrompt, textPrompt, images, timeoutMs }) {
    const content = await askGeminiVision(systemPrompt, textPrompt, images, true, {
      generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
      timeoutMs,
    });
    return { content, usage: null };
  },
};

const PROVIDERS = new Map([
  [cloudflareProvider.id, cloudflareProvider],
  [geminiProvider.id, geminiProvider],
]);

export function resolveVisionProvider(env = process.env) {
  const requested = String(env.CARUP_OCR_PROVIDER || DEFAULT_OCR_PROVIDER).trim().toLowerCase();
  const provider = PROVIDERS.get(requested);
  if (!provider) {
    throw new Error(
      `Unknown OCR provider "${requested}". Configured providers: ${[...PROVIDERS.keys()].join(', ')}.`,
    );
  }
  return provider;
}

/**
 * Wraps a bare function seam as a provider, for tests that observe or simulate the provider call.
 * The identity it reports is the caller's to state, so a test can never accidentally claim a
 * reading came from a provider that was never contacted.
 */
export function providerFromClient(client, { id = 'test-double', model = 'test-double' } = {}) {
  return {
    id,
    model,
    isConfigured: () => true,
    requiredEnv: [],
    async extract({ systemPrompt, textPrompt, images, jsonSchema, timeoutMs }) {
      const content = await client(systemPrompt, textPrompt, images, jsonSchema, { timeoutMs });
      return content && typeof content === 'object' && 'content' in content
        ? { content: content.content, usage: content.usage ?? null }
        : { content, usage: null };
    },
  };
}
