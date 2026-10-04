/**
 * The ONE Cloudflare Workers AI transport (OC-3C).
 *
 * CarUp calls Workers AI under two POLICIES, and they used to be two transports:
 *   - the certified OCR policy (CloudflareVisionClient.js — Qwen, the model OCR 1.0 certified), and
 *   - the general inference policy (cloudflareGemmaProvider.js — Gemma, behind carUpAiGateway.js,
 *     converged from PR #217).
 * Each re-implemented credentials, the URL, the HTTP call, the timeout, error parsing and secret
 * handling, and they had already drifted (one bounded with AbortSignal.timeout and named nothing
 * but the HTTP status, the other forwarded a caller's AbortSignal, classified 429/529/401/5xx and
 * redacted secrets). This module is that machinery, once:
 *
 *   credentials · URL · one POST · timeout + caller abort · failure classification ·
 *   secret redaction · execution metadata
 *
 * It owns NO policy. It never chooses a model, builds a prompt, shapes a request body or reads an
 * answer out of a response envelope — each policy does that, so the OCR request a model was
 * certified on is byte-for-byte the request it still receives. It makes exactly one attempt: no
 * retry, no fallback to another model or vendor. Credentials are server-side environment only.
 */

export const CLOUDFLARE_PROVIDER = 'cloudflare';
export const CLOUDFLARE_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';
export const CLOUDFLARE_REQUIRED_ENV = Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
export const DEFAULT_CLOUDFLARE_TIMEOUT_MS = 60_000;

const normalized = (value) => String(value ?? '').trim();

/**
 * The server-side credentials, trimmed. `missingEnv` names what is absent — never a value. A
 * whitespace-only value is absent: sending it would spend a request to learn the same thing.
 */
export function resolveCloudflareCredentials(env = process.env) {
  const accountId = normalized(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = normalized(env.CLOUDFLARE_API_TOKEN);
  return Object.freeze({
    accountId,
    apiToken,
    configured: Boolean(accountId && apiToken),
    missingEnv: CLOUDFLARE_REQUIRED_ENV.filter((name) => !normalized(env[name])),
  });
}

export function isCloudflareConfigured(env = process.env) {
  return resolveCloudflareCredentials(env).configured;
}

/** The run endpoint for one model on one account. */
export function cloudflareRunUrl(accountId, model) {
  return `${CLOUDFLARE_AI_BASE}/${encodeURIComponent(accountId)}/ai/run/${model}`;
}

/**
 * A transport failure, typed. `code` says what kind; `retryable` whether the same request could
 * succeed later; `status` the HTTP status when there was one; `providerErrors` Cloudflare's own
 * `errors[]` entries as "code: message" strings — redacted, like `message` and `detail`.
 */
export class CloudflareAiTransportError extends Error {
  constructor(message, {
    code = 'AI_PROVIDER_ERROR',
    status = null,
    retryable = false,
    model = null,
    providerErrors = [],
    detail = null,
    timeoutMs = null,
    missingEnv = [],
  } = {}) {
    super(message);
    this.name = 'CloudflareAiTransportError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.provider = CLOUDFLARE_PROVIDER;
    this.model = model;
    this.providerErrors = providerErrors;
    this.detail = detail;
    this.timeoutMs = timeoutMs;
    this.missingEnv = missingEnv;
  }
}

/** HTTP status → failure kind (converged from PR #217's provider). */
export function classifyCloudflareFailure(status) {
  if (status === 429) return { code: 'AI_RATE_LIMITED', retryable: true };
  if (status === 529) return { code: 'AI_CAPACITY_UNAVAILABLE', retryable: true };
  if (status === 401 || status === 403) return { code: 'AI_PROVIDER_AUTH_FAILED', retryable: false };
  if (status >= 500) return { code: 'AI_PROVIDER_UNAVAILABLE', retryable: true };
  if (status >= 400) return { code: 'AI_PROVIDER_REJECTED', retryable: false };
  return { code: 'AI_PROVIDER_ERROR', retryable: false };
}

/** Below this length a value is redacted only where it stands alone (see redactSecrets). */
const SUBSTRING_REDACTION_MIN_LENGTH = 8;
const TOKEN_CHAR = '[A-Za-z0-9_-]';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces every secret with [REDACTED]. A secret of 8+ characters (every Cloudflare account id is
 * 32, every API token 40) is replaced wherever it occurs. A shorter value is replaced only where it
 * stands alone as a token: replacing it as a substring would erase its letters from every word of
 * the message — a one-letter "token" turned "Authentication error" into "Au[REDACTED]hen…".
 */
export function redactSecrets(value, secrets = []) {
  let safe = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || !secret) continue;
    if (secret.length >= SUBSTRING_REDACTION_MIN_LENGTH) {
      safe = safe.split(secret).join('[REDACTED]');
    } else {
      safe = safe.replace(new RegExp(`(?<!${TOKEN_CHAR})${escapeRegExp(secret)}(?!${TOKEN_CHAR})`, 'g'), '[REDACTED]');
    }
  }
  return safe;
}

/**
 * POST one request body to one model — exactly one attempt.
 *
 * `body` is the policy's request, sent verbatim. `fetchImpl` is resolved at CALL time (default
 * `globalThis.fetch`), so a test double or a later runtime fetch is honoured. `timeoutMs` bounds the
 * call (default 60s); a caller's `signal` is forwarded, and the two are told apart: a timeout is
 * AI_TIMEOUT (retryable), a caller abort is AI_ABORTED (not).
 *
 * Returns `{ payload, result, status, durationMs }`; throws CloudflareAiTransportError otherwise.
 */
export async function invokeCloudflareModel({
  model,
  body,
  env = process.env,
  fetchImpl = null,
  timeoutMs = DEFAULT_CLOUDFLARE_TIMEOUT_MS,
  signal = null,
} = {}) {
  if (!model) {
    throw new CloudflareAiTransportError('Cloudflare Workers AI requires an explicit model; none was given.', { code: 'AI_MODEL_REQUIRED' });
  }

  const credentials = resolveCloudflareCredentials(env);
  const secrets = [credentials.apiToken, credentials.accountId];
  if (!credentials.configured) {
    throw new CloudflareAiTransportError(
      `Cloudflare Workers AI is unavailable because required server credentials are missing: ${credentials.missingEnv.join(', ')}.`,
      { code: 'AI_PROVIDER_UNAVAILABLE', model, missingEnv: [...credentials.missingEnv] },
    );
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new CloudflareAiTransportError('Cloudflare Workers AI transport is unavailable.', { code: 'AI_TRANSPORT_UNAVAILABLE', model });
  }

  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_CLOUDFLARE_TIMEOUT_MS;
  const controller = new AbortController();
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

  const startedAt = Date.now();
  let response;
  try {
    response = await doFetch(cloudflareRunUrl(credentials.accountId, model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiToken}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) {
        throw new CloudflareAiTransportError(`Cloudflare Workers AI request timed out after ${ms}ms.`, {
          code: 'AI_TIMEOUT', retryable: true, model, timeoutMs: ms,
        });
      }
      throw new CloudflareAiTransportError('Cloudflare Workers AI request was aborted.', { code: 'AI_ABORTED', model });
    }
    const detail = redactSecrets(error?.message || 'unknown transport error', secrets);
    throw new CloudflareAiTransportError(`Cloudflare Workers AI transport failed: ${detail}`, {
      code: 'AI_TRANSPORT_ERROR', retryable: true, model, detail,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', forwardAbort);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    // Say WHY. Cloudflare returns a structured error list; a bare status hides an expired token, a
    // missing Workers AI permission and a rate limit behind one indistinguishable message.
    const { code, retryable } = classifyCloudflareFailure(response.status);
    const providerErrors = (Array.isArray(payload?.errors) ? payload.errors : [])
      .map((entry) => redactSecrets([entry?.code, entry?.message].filter((part) => part !== undefined && part !== null && part !== '').join(': '), secrets))
      .filter(Boolean);
    throw new CloudflareAiTransportError(
      providerErrors.length ? providerErrors.join('; ') : `Cloudflare Workers AI returned HTTP ${response.status}.`,
      { code, retryable, status: response.status, model, providerErrors },
    );
  }

  return {
    payload,
    result: payload?.result ?? null,
    status: response.status,
    durationMs: Date.now() - startedAt,
  };
}

export default {
  CLOUDFLARE_PROVIDER,
  CLOUDFLARE_AI_BASE,
  CLOUDFLARE_REQUIRED_ENV,
  DEFAULT_CLOUDFLARE_TIMEOUT_MS,
  resolveCloudflareCredentials,
  isCloudflareConfigured,
  cloudflareRunUrl,
  CloudflareAiTransportError,
  classifyCloudflareFailure,
  redactSecrets,
  invokeCloudflareModel,
};
