/**
 * The general inference POLICY on Cloudflare Workers AI: Gemma, behind the CarUp AI gateway.
 *
 * Converged from PR #217 (AI-01-B, head 6c8ff6f7) by OC-3C. The request body and the answer
 * envelope are #217's, unchanged (buildGemmaRequestBody / readGemmaResponseContent). #217's own
 * HTTP client — credentials, URL, fetch, timeout and caller abort, failure classification and
 * secret redaction — is now the shared cloudflareAiTransport.js, the same transport the certified
 * OCR policy uses. Exactly one attempt; no retry, no fallback to another model or vendor.
 */
import {
  CARUP_AI_MODEL,
  CARUP_AI_PROVIDER,
  inspectAiRuntimeConfig,
  resolveAiRuntimeConfig,
} from './aiRuntimeConfig.js';
import { normalizeSupportedImage } from './aiCapabilities.js';
import {
  CloudflareAiTransportError,
  classifyCloudflareFailure,
  invokeCloudflareModel,
} from './cloudflareAiTransport.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

/** Failure classification is the transport's; re-exported for #217's callers and suite. */
export { classifyCloudflareFailure };

export class CarUpAiProviderError extends Error {
  constructor(message, {
    code = 'AI_PROVIDER_ERROR',
    status = null,
    retryable = false,
    provider = CARUP_AI_PROVIDER,
    model = CARUP_AI_MODEL,
  } = {}) {
    super(message);
    this.name = 'CarUpAiProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
    this.model = model;
  }
}

function cleanPrompt(value) {
  return String(value ?? '').trim();
}

function validateImage(image) {
  return normalizeSupportedImage(image, { operation: 'Gemma image inference' });
}

export function buildGemmaRequestBody({
  systemPrompt = '',
  userPrompt = '',
  image = null,
  expectJson = false,
  maxTokens = DEFAULT_MAX_TOKENS,
} = {}) {
  const system = cleanPrompt(systemPrompt);
  let user = cleanPrompt(userPrompt);

  if (!system && !user) {
    throw new CarUpAiProviderError(
      'Gemma inference requires a systemPrompt or userPrompt.',
      { code: 'AI_PROMPT_REQUIRED' },
    );
  }

  if (expectJson) {
    user = (user ? user + '\n\n' : '') +
      'Return only one valid JSON value. Do not use Markdown fences or prose outside the JSON.';
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });

  if (image) {
    const normalizedImage = validateImage(image);
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: user },
        {
          type: 'image_url',
          image_url: {
            url: 'data:' + normalizedImage.mimeType + ';base64,' + normalizedImage.base64,
          },
        },
      ],
    });
  } else {
    messages.push({ role: 'user', content: user });
  }

  return {
    messages,
    temperature: 0,
    max_tokens: Number(maxTokens) > 0 ? Number(maxTokens) : DEFAULT_MAX_TOKENS,
  };
}

export function readGemmaResponseContent(payload) {
  return payload?.result?.choices?.[0]?.message?.content
    ?? payload?.result?.choices?.[0]?.text
    ?? null;
}

/** The transport's typed failure, as this policy's error — same code, status, retryable, message. */
function asProviderError(error, model) {
  if (!(error instanceof CloudflareAiTransportError)) return error;
  return new CarUpAiProviderError(error.message, {
    code: error.code,
    status: error.status,
    retryable: error.retryable,
    model,
  });
}

export async function invokeCloudflareGemma({
  systemPrompt = '',
  userPrompt = '',
  image = null,
  expectJson = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens = DEFAULT_MAX_TOKENS,
  signal = null,
  env = process.env,
  fetchImpl = null,
} = {}) {
  const config = resolveAiRuntimeConfig(env);

  // Refuse before building anything — and before spending provider capacity — when the server
  // credentials are absent (presence comes from the transport; the values never reach this module).
  if (!config.configured) {
    throw new CarUpAiProviderError(
      'Cloudflare Workers AI is unavailable because required server credentials are missing: ' +
        config.missingEnv.join(', ') + '.',
      { code: 'AI_PROVIDER_UNAVAILABLE' },
    );
  }

  const body = buildGemmaRequestBody({
    systemPrompt,
    userPrompt,
    image,
    expectJson,
    maxTokens,
  });

  let invocation;
  try {
    invocation = await invokeCloudflareModel({
      model: config.model,
      body,
      env,
      fetchImpl,
      timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    throw asProviderError(error, config.model);
  }

  const content = readGemmaResponseContent(invocation.payload);
  if (content === null || content === undefined || content === '') {
    throw new CarUpAiProviderError(
      'Cloudflare Workers AI returned an empty or malformed Gemma response.',
      { code: 'AI_MALFORMED_RESPONSE' },
    );
  }

  return {
    content,
    provenance: {
      provider: config.provider,
      model: config.model,
    },
    usage: invocation.payload?.result?.usage ?? null,
  };
}

export function createCloudflareGemmaProvider({
  env = process.env,
  fetchImpl = null,
} = {}) {
  return Object.freeze({
    id: CARUP_AI_PROVIDER,
    model: CARUP_AI_MODEL,
    inspect() {
      return inspectAiRuntimeConfig(env);
    },
    async generate(request = {}) {
      return invokeCloudflareGemma({ ...request, env, fetchImpl });
    },
  });
}
