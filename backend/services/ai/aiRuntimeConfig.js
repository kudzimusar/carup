/**
 * Canonical CarUp AI runtime configuration — the general inference POLICY's pins.
 *
 * Converged from PR #217 (AI-01-B, head 6c8ff6f7) by OC-3C. Server-side configuration only:
 * browser/mobile bundles must never receive Cloudflare credentials. There is exactly one canonical
 * provider and one canonical model for general inference; an alternate provider or model is
 * REFUSED, never hidden behind a fallback.
 *
 * This is not the OCR policy. Certified OCR keeps its own model authority (CARUP_OCR_PROVIDER /
 * CARUP_OCR_MODEL, ocrVisionProvider.js — Qwen); both policies share one transport
 * (cloudflareAiTransport.js), which owns the credentials. This module therefore reports whether
 * they are present, and never holds their values.
 */
import {
  CLOUDFLARE_PROVIDER,
  CLOUDFLARE_REQUIRED_ENV,
  resolveCloudflareCredentials,
} from './cloudflareAiTransport.js';

export const CARUP_AI_PROVIDER = CLOUDFLARE_PROVIDER;
export const CARUP_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const CARUP_AI_REQUIRED_ENV = CLOUDFLARE_REQUIRED_ENV;

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
      'Unsupported CARUP_AI_PROVIDER "' + provider + '". The CarUp AI gateway permits only "' + CARUP_AI_PROVIDER + '"; no provider fallback is configured.',
      'AI_PROVIDER_UNSUPPORTED',
    );
  }

  if (model !== CARUP_AI_MODEL) {
    throw new CarUpAiConfigError(
      'Unsupported CARUP_AI_MODEL "' + model + '". The CarUp AI gateway is pinned to "' + CARUP_AI_MODEL + '".',
      'AI_MODEL_UNSUPPORTED',
    );
  }

  const credentials = resolveCloudflareCredentials(env);
  return Object.freeze({
    provider,
    model,
    configured: credentials.configured,
    missingEnv: [...credentials.missingEnv],
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
