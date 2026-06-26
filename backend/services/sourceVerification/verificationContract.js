/**
 * Source Verification Contract — Workstream 2.
 *
 * The common interface every Zimbabwe registry adapter (ZIMRA, CVR, ZINARA, VID, CID)
 * implements. The orchestrator (sourceVerificationService.js) only ever talks to this
 * contract, so adapters can move from SANDBOX to PARTNER_FILE to LIVE without changing
 * the engine, routes, persistence, or UI.
 *
 * HONESTY IS STRUCTURAL. Every adapter declares its operating `mode`, and every result
 * carries that mode through to storage and the buyer-facing coverage view. A sandbox or
 * manual result can never be presented as a live government API confirmation; an
 * unavailable/no_record result can never be presented as a clear/verified result.
 */

export const PROVIDERS = ['zimra', 'cvr', 'zinara', 'vid', 'cid'];

// Operating modes — the honesty marker. Ordered from strongest to weakest evidence.
export const VERIFICATION_MODES = [
  'live',                  // real approved provider endpoint + credential
  'partner_file',          // signed CSV/JSON import from an approved operator
  'manual_verification',   // authorized reviewer recorded a result with evidence
  'sandbox',               // provider-compatible synthetic fixtures (staging/tests only)
  'unavailable',           // source not queried / could not provide data
];

// Verification outcomes. unavailable and no_record are first-class — NOT match.
export const VERIFICATION_RESULTS = [
  'match',
  'mismatch',
  'no_record',
  'unavailable',
  'manual_review',
  'high_risk',
];

export const ERROR_CLASSES = [
  'timeout',
  'malformed_response',
  'unauthorized',
  'rate_limited',
  'provider_error',
  'not_contracted',
];

export const QUERY_TYPES = ['vin', 'plate', 'chassis', 'engine'];

const REQUIRED_METHODS = ['getMode', 'verify'];

/** Throws unless an adapter satisfies the contract. Called at registration time. */
export function assertAdapterShape(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter must be an object');
  if (!PROVIDERS.includes(adapter.provider)) {
    throw new Error(`adapter.provider must be one of ${PROVIDERS.join('|')} (got ${adapter.provider})`);
  }
  if (!adapter.displayName) throw new Error(`adapter ${adapter.provider}: displayName is required`);
  if (!Array.isArray(adapter.supportedQueryTypes) || adapter.supportedQueryTypes.length === 0) {
    throw new Error(`adapter ${adapter.provider}: supportedQueryTypes must be a non-empty array`);
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== 'function') {
      throw new Error(`adapter ${adapter.provider}: missing method ${m}()`);
    }
  }
  return true;
}

/**
 * Validate + normalize a result returned by an adapter's verify(). Guarantees the
 * orchestrator always persists a well-formed, honest row. Throws on contract violation
 * so a malformed adapter can never silently write a misleading result.
 */
export function normalizeVerificationResult(provider, raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`adapter ${provider}: verify() must return an object`);
  }
  if (!VERIFICATION_MODES.includes(raw.mode)) {
    throw new Error(`adapter ${provider}: invalid mode "${raw.mode}"`);
  }
  if (!VERIFICATION_RESULTS.includes(raw.result)) {
    throw new Error(`adapter ${provider}: invalid result "${raw.result}"`);
  }
  if (raw.error_class != null && !ERROR_CLASSES.includes(raw.error_class)) {
    throw new Error(`adapter ${provider}: invalid error_class "${raw.error_class}"`);
  }
  // Structural honesty guards — refuse to persist a self-contradictory result.
  if (raw.mode === 'unavailable' && !['unavailable', 'no_record'].includes(raw.result)) {
    throw new Error(`adapter ${provider}: mode 'unavailable' cannot report result '${raw.result}'`);
  }
  if (raw.result === 'unavailable' && raw.mode !== 'unavailable') {
    throw new Error(`adapter ${provider}: result 'unavailable' requires mode 'unavailable'`);
  }
  let confidence = raw.confidence;
  if (confidence != null) {
    confidence = Number(confidence);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`adapter ${provider}: confidence must be between 0 and 1`);
    }
  } else {
    confidence = null;
  }
  // An unavailable/no_record result must never carry high confidence in a positive sense.
  if (['unavailable', 'no_record'].includes(raw.result) && confidence != null && confidence > 0.5) {
    throw new Error(`adapter ${provider}: '${raw.result}' cannot carry confidence > 0.5`);
  }
  return {
    provider,
    mode: raw.mode,
    result: raw.result,
    confidence,
    source_record_id: raw.source_record_id ?? null,
    retrieved_at: raw.retrieved_at ?? null,
    identity_fields: raw.identity_fields && typeof raw.identity_fields === 'object' ? raw.identity_fields : {},
    mismatch_flags: Array.isArray(raw.mismatch_flags) ? raw.mismatch_flags : [],
    error_class: raw.error_class ?? null,
    raw_payload: raw.raw_payload ?? null,
    legal_basis: raw.legal_basis ?? null,
  };
}

/** Adapter registry so the orchestrator + routes resolve adapters by provider id. */
const registry = new Map();

export function registerAdapter(adapter) {
  assertAdapterShape(adapter);
  registry.set(adapter.provider, adapter);
  return adapter;
}

export function getAdapter(provider) {
  return registry.get(provider) || null;
}

export function listAdapters() {
  return [...registry.values()].map((a) => ({
    provider: a.provider,
    displayName: a.displayName,
    mode: a.getMode(),
    supportedQueryTypes: a.supportedQueryTypes,
  }));
}

/** Test-only: clear the registry between suites. */
export function _resetRegistry() {
  registry.clear();
}

export default {
  PROVIDERS,
  VERIFICATION_MODES,
  VERIFICATION_RESULTS,
  ERROR_CLASSES,
  QUERY_TYPES,
  assertAdapterShape,
  normalizeVerificationResult,
  registerAdapter,
  getAdapter,
  listAdapters,
};
