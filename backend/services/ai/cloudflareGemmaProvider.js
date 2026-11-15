import {
  CARUP_AI_MODEL,
  CARUP_AI_PROVIDER,
  inspectAiRuntimeConfig,
  resolveAiRuntimeConfig,
} from './aiRuntimeConfig.js';
import { normalizeSupportedImage } from './aiCapabilities.js';

const CLOUDFLARE_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

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

function redactSecrets(value, secrets = []) {
  let safe = String(value ?? '');
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[REDACTED]');
  }
  return safe;
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

export function classifyCloudflareFailure(status) {
  if (status === 429) {
    return { code: 'AI_RATE_LIMITED', retryable: true };
  }
  if (status === 529) {
    return { code: 'AI_CAPACITY_UNAVAILABLE', retryable: true };
  }
  if (status === 401 || status === 403) {
    return { code: 'AI_PROVIDER_AUTH_FAILED', retryable: false };
  }
  if (status >= 500) {
    return { code: 'AI_PROVIDER_UNAVAILABLE', retryable: true };
  }
  if (status >= 400) {
    return { code: 'AI_PROVIDER_REJECTED', retryable: false };
  }
  return { code: 'AI_PROVIDER_ERROR', retryable: false };
}

function providerErrorMessage(payload, status, secrets) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const detail = errors
    .map((entry) => [entry?.code, entry?.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
  return redactSecrets(
    detail || ('Cloudflare Workers AI returned HTTP ' + status + '.'),
    secrets,
  );
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
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = resolveAiRuntimeConfig(env);
  const secrets = [config.apiToken, config.accountId];

  if (!config.configured) {
    throw new CarUpAiProviderError(
      'Cloudflare Workers AI is unavailable because required server credentials are missing: ' +
        config.missingEnv.join(', ') + '.',
      { code: 'AI_PROVIDER_UNAVAILABLE' },
    );
  }

  if (typeof fetchImpl !== 'function') {
    throw new CarUpAiProviderError(
      'Cloudflare Workers AI transport is unavailable.',
      { code: 'AI_TRANSPORT_UNAVAILABLE' },
    );
  }

  const body = buildGemmaRequestBody({
    systemPrompt,
    userPrompt,
    image,
    expectJson,
    maxTokens,
  });

  const controller = new AbortController();
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, ms);

  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  let response;
  try {
    response = await fetchImpl(
      CLOUDFLARE_AI_BASE + '/' + encodeURIComponent(config.accountId) + '/ai/run/' + config.model,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.apiToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) {
        throw new CarUpAiProviderError(
          'Cloudflare Workers AI request timed out after ' + ms + 'ms.',
          { code: 'AI_TIMEOUT', retryable: true },
        );
      }
      throw new CarUpAiProviderError(
        'Cloudflare Workers AI request was aborted.',
        { code: 'AI_ABORTED', retryable: false },
      );
    }

    throw new CarUpAiProviderError(
      'Cloudflare Workers AI transport failed: ' +
        redactSecrets(error?.message || 'unknown transport error', secrets),
      { code: 'AI_TRANSPORT_ERROR', retryable: true },
    );
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', forwardAbort);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const classification = classifyCloudflareFailure(response.status);
    throw new CarUpAiProviderError(
      providerErrorMessage(payload, response.status, secrets),
      {
        code: classification.code,
        retryable: classification.retryable,
        status: response.status,
      },
    );
  }

  const content = readGemmaResponseContent(payload);
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
    usage: payload?.result?.usage ?? null,
  };
}

export function createCloudflareGemmaProvider({
  env = process.env,
  fetchImpl = globalThis.fetch,
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
