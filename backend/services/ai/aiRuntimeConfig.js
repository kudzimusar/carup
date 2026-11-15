/**
 * Canonical CarUp AI runtime configuration — AI-01-B.
 *
 * This is server-side configuration only. Browser/mobile bundles must never
 * receive Cloudflare credentials. Phase B has exactly one canonical provider
 * and one canonical model; alternate providers are not hidden behind fallback.
 */

export const CARUP_AI_PROVIDER = 'cloudflare';
export const CARUP_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const CARUP_AI_REQUIRED_ENV = Object.freeze([
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
]);

export class CarUpAiConfigError extends Error {
  constructor(message, code = 'AI_CONFIG_INVALID') {
    super(message);
    this.name = 'CarUpAiConfigError';
    this.code = code;
  }
}

function normalized(value) {
  return String(value ?? '').trim();
}

export function resolveAiRuntimeConfig(env = process.env) {
  const provider = normalized(env.CARUP_AI_PROVIDER || CARUP_AI_PROVIDER).toLowerCase();
  const model = normalized(env.CARUP_AI_MODEL || CARUP_AI_MODEL);

  if (provider !== CARUP_AI_PROVIDER) {
    throw new CarUpAiConfigError(
      'Unsupported CARUP_AI_PROVIDER "' + provider + '". AI-01-B permits only "' + CARUP_AI_PROVIDER + '"; no provider fallback is configured.',
      'AI_PROVIDER_UNSUPPORTED',
    );
  }

  if (model !== CARUP_AI_MODEL) {
    throw new CarUpAiConfigError(
      'Unsupported CARUP_AI_MODEL "' + model + '". AI-01-B is pinned to "' + CARUP_AI_MODEL + '".',
      'AI_MODEL_UNSUPPORTED',
    );
  }

  const accountId = normalized(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = normalized(env.CLOUDFLARE_API_TOKEN);

  return Object.freeze({
    provider,
    model,
    accountId,
    apiToken,
    configured: Boolean(accountId && apiToken),
    missingEnv: CARUP_AI_REQUIRED_ENV.filter((name) => !normalized(env[name])),
  });
}

/**
 * Safe inspection seam. It deliberately reports only names/presence; never
 * account identifiers or token values.
 */
export function inspectAiRuntimeConfig(env = process.env) {
  const config = resolveAiRuntimeConfig(env);
  return Object.freeze({
    provider: config.provider,
    model: config.model,
    configured: config.configured,
    requiredEnv: [...CARUP_AI_REQUIRED_ENV],
    missingEnv: [...config.missingEnv],
  });
}
