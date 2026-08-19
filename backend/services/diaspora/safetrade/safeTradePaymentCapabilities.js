/**
 * Issue #164 Phase 6B/6C — canonical SafeTrade payment capability registry.
 *
 * This is NOT a second provider activation registry. `providerPlatform/providerRegistry.js` remains
 * the control plane for credentials references, contracts, activation modes, kill switches and
 * health. This module answers a narrower question: what payment behaviour has CarUp actually proven
 * for an adapter?
 *
 * Critical semantics:
 * - `candidate_jurisdictions` means only "worth evaluating here". It is NOT support evidence.
 * - `supported_*: null` means unknown. Empty arrays mean verified unsupported everywhere/for all.
 * - capability `null` means unknown, never false-by-convenience and never true-by-marketing.
 * - a provider is callable for a capability only when that capability and every requested support
 *   dimension are explicitly proven, except the in-memory sandbox whose scope is test-only.
 * - collection does not imply regulated escrow, delayed release, split payment or payout.
 */

export const PAYMENT_CAPABILITIES = Object.freeze([
  'collect_payment',
  'authorize_hold',
  'capture',
  'refund',
  'partial_refund',
  'cancel',
  'retrieve_status',
  'payout_to_seller',
  'split_payment',
  'regulated_escrow',
  'delayed_release',
  'webhook_verify',
  'webhook_replay_resistant',
  'polling_fallback',
]);

export const CAPABILITY_EVIDENCE = Object.freeze({
  SANDBOX_PROVEN: 'sandbox_proven',
  EXTERNAL_TEST_PROVEN: 'external_test_proven',
  CANDIDATE_UNVERIFIED: 'candidate_unverified',
});

/** Automated PaymentProvider modes. `manual`/`partner_file` may be callable elsewhere in CarUp's
 * provider control plane, but they are not an automated money adapter and therefore never route here. */
export const PAYMENT_ADAPTER_CALLABLE_MODES = Object.freeze(['sandbox', 'pilot_live', 'live']);

function unknownCapabilities() {
  return Object.freeze(Object.fromEntries(PAYMENT_CAPABILITIES.map((key) => [key, null])));
}

function sandboxCapabilities() {
  return Object.freeze({
    collect_payment: true,
    authorize_hold: true,
    capture: true,
    refund: true,
    partial_refund: true,
    cancel: true,
    retrieve_status: true,
    payout_to_seller: true,
    split_payment: false,
    regulated_escrow: false,
    delayed_release: true,
    webhook_verify: true,
    webhook_replay_resistant: true,
    polling_fallback: true,
  });
}

/**
 * Static evidence descriptors. External providers deliberately remain unverified until official
 * test-mode evidence/credentials are exercised and recorded by a reviewed adapter change.
 *
 * `candidate_jurisdictions` comes from Issue #164's provider-priority amendment and is routing
 * discovery metadata only. `supported_countries/currencies/methods` stay null until proven.
 */
export const PAYMENT_PROVIDER_CAPABILITY_REGISTRY = Object.freeze({
  sandbox: Object.freeze({
    provider_key: 'sandbox',
    evidence_state: CAPABILITY_EVIDENCE.SANDBOX_PROVEN,
    test_only: true,
    candidate_jurisdictions: Object.freeze([]),
    supported_countries: null,
    supported_currencies: Object.freeze(['USD']),
    supported_methods: Object.freeze(['sandbox']),
    merchant_legal_eligibility: 'test_only',
    capabilities: sandboxCapabilities(),
  }),
  contipay: Object.freeze({
    provider_key: 'contipay',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['ZW', 'ZM', 'TZ']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  paynow: Object.freeze({
    provider_key: 'paynow',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['ZW']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  paypal: Object.freeze({
    provider_key: 'paypal',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['GLOBAL']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  stripe: Object.freeze({
    provider_key: 'stripe',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['ZA', 'TZ', 'GLOBAL_CONDITIONAL']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  pesapal: Object.freeze({
    provider_key: 'pesapal',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['ZM', 'TZ', 'MW']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  peach_payments: Object.freeze({
    provider_key: 'peach_payments',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['ZA']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  stitch: Object.freeze({
    provider_key: 'stitch',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['ZA']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  selcom: Object.freeze({
    provider_key: 'selcom',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['TZ']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
  paychangu: Object.freeze({
    provider_key: 'paychangu',
    evidence_state: CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    test_only: false,
    candidate_jurisdictions: Object.freeze(['MW']),
    supported_countries: null,
    supported_currencies: null,
    supported_methods: null,
    merchant_legal_eligibility: 'unknown',
    capabilities: unknownCapabilities(),
  }),
});

function normalized(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}
function upper(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}
function supportDecision(values, requested, field) {
  if (requested == null) return { allowed: false, reason: `${field}_required` };
  if (values === null) return { allowed: false, reason: `${field}_unknown` };
  return values.map((value) => String(value).toUpperCase()).includes(String(requested).toUpperCase())
    ? { allowed: true, reason: null }
    : { allowed: false, reason: `${field}_unsupported` };
}

export function getPaymentProviderCapabilities(providerKey) {
  const key = normalized(providerKey);
  return key ? PAYMENT_PROVIDER_CAPABILITY_REGISTRY[key] || null : null;
}

/**
 * Fail-closed capability decision. The sandbox is intentionally special: it is not a merchant rail,
 * so country/legal eligibility are not asserted at all; it can be used only when `testMode:true` and
 * method=`sandbox`. External adapters must prove every requested support dimension before becoming
 * callable.
 */
export function evaluatePaymentProviderCapability(providerKey, capability, context = {}) {
  if (!PAYMENT_CAPABILITIES.includes(capability)) {
    return Object.freeze({ allowed: false, state: 'unknown', reason: 'capability_not_registered' });
  }
  const provider = getPaymentProviderCapabilities(providerKey);
  if (!provider) {
    return Object.freeze({ allowed: false, state: 'unknown', reason: 'provider_not_registered' });
  }

  const capabilityValue = provider.capabilities[capability];
  if (capabilityValue === null) {
    return Object.freeze({ allowed: false, state: 'unknown', reason: 'capability_unknown' });
  }
  if (capabilityValue !== true) {
    return Object.freeze({ allowed: false, state: 'unsupported', reason: 'capability_unsupported' });
  }

  if (provider.test_only) {
    if (context.testMode !== true) {
      return Object.freeze({ allowed: false, state: 'test_only', reason: 'provider_test_only' });
    }
    const method = normalized(context.method);
    if (!method || !provider.supported_methods.includes(method)) {
      return Object.freeze({ allowed: false, state: 'test_only', reason: 'payment_method_unsupported' });
    }
    const currency = upper(context.currency);
    if (!currency || !provider.supported_currencies.includes(currency)) {
      return Object.freeze({ allowed: false, state: 'test_only', reason: 'currency_unsupported' });
    }
    return Object.freeze({
      allowed: true,
      state: CAPABILITY_EVIDENCE.SANDBOX_PROVEN,
      reason: null,
      provider_key: provider.provider_key,
      test_only: true,
    });
  }

  if (provider.merchant_legal_eligibility !== 'eligible') {
    return Object.freeze({ allowed: false, state: 'unknown', reason: 'merchant_legal_eligibility_unknown' });
  }
  const country = supportDecision(provider.supported_countries, upper(context.country), 'country');
  if (!country.allowed) return Object.freeze({ allowed: false, state: 'unknown', reason: country.reason });
  const currency = supportDecision(provider.supported_currencies, upper(context.currency), 'currency');
  if (!currency.allowed) return Object.freeze({ allowed: false, state: 'unknown', reason: currency.reason });
  const method = supportDecision(provider.supported_methods, normalized(context.method), 'payment_method');
  if (!method.allowed) return Object.freeze({ allowed: false, state: 'unknown', reason: method.reason });

  return Object.freeze({
    allowed: true,
    state: provider.evidence_state,
    reason: null,
    provider_key: provider.provider_key,
    test_only: false,
  });
}

export function assertPaymentProviderCapability(providerKey, capability, context = {}) {
  const decision = evaluatePaymentProviderCapability(providerKey, capability, context);
  if (!decision.allowed) {
    const error = new Error(
      `Payment provider '${providerKey || 'unknown'}' cannot perform '${capability}': ${decision.reason}`,
    );
    error.code = 'PAYMENT_CAPABILITY_UNAVAILABLE';
    error.capability = capability;
    error.reason = decision.reason;
    throw error;
  }
  return decision;
}

/** Candidate discovery only. Never returns a callable/supported claim. */
export function paymentProviderCandidatesForCountry(country) {
  const code = upper(country);
  if (!code) return [];
  return Object.values(PAYMENT_PROVIDER_CAPABILITY_REGISTRY)
    .filter((provider) => provider.candidate_jurisdictions.includes(code)
      || provider.candidate_jurisdictions.includes('GLOBAL'))
    .map((provider) => Object.freeze({
      provider_key: provider.provider_key,
      evidence_state: provider.evidence_state,
      candidate_only: provider.evidence_state === CAPABILITY_EVIDENCE.CANDIDATE_UNVERIFIED,
    }));
}

/**
 * Pure adapter-control-plane check. External automated payment calls must be represented by the
 * existing provider registry as an `escrow` provider, kill-switch OFF, healthy, and in an automated
 * mode. This function consumes a snapshot rather than querying the DB so routing stays deterministic
 * and testable; the provider platform remains the owner of the row itself.
 */
export function evaluatePaymentControlPlane(providerKey, snapshot, { testMode = false } = {}) {
  const key = normalized(providerKey);
  if (key === 'sandbox') {
    return Object.freeze({ allowed: testMode === true, reason: testMode === true ? null : 'sandbox_test_only' });
  }
  if (!snapshot || typeof snapshot !== 'object') {
    return Object.freeze({ allowed: false, reason: 'provider_control_plane_missing' });
  }
  if (normalized(snapshot.provider_key) !== key) {
    return Object.freeze({ allowed: false, reason: 'provider_control_plane_mismatch' });
  }
  if (snapshot.capability_type !== 'escrow') {
    return Object.freeze({ allowed: false, reason: 'provider_not_registered_for_escrow' });
  }
  if (snapshot.kill_switch_enabled !== false) {
    return Object.freeze({ allowed: false, reason: 'provider_kill_switch' });
  }
  if (!PAYMENT_ADAPTER_CALLABLE_MODES.includes(normalized(snapshot.activation_mode))) {
    return Object.freeze({ allowed: false, reason: 'provider_mode_not_automated_callable' });
  }
  if (normalized(snapshot.health_state) !== 'healthy') {
    return Object.freeze({ allowed: false, reason: 'provider_health_not_healthy' });
  }
  return Object.freeze({ allowed: true, reason: null });
}

/**
 * Country/currency/method/capability route resolver. It never chooses from candidate metadata.
 * `controlPlane` is an array of public-safe provider-registry snapshots (no secrets). The result
 * contains every proven callable key; callers may apply commercial preference only AFTER this safety
 * filter. With the current registry, external results are intentionally empty.
 */
export function resolvePaymentProviderRoutes({
  country,
  currency,
  method,
  capability,
  testMode = false,
  controlPlane = [],
} = {}) {
  const routes = [];
  const rejected = [];
  for (const provider of Object.values(PAYMENT_PROVIDER_CAPABILITY_REGISTRY)) {
    const context = provider.test_only
      ? { testMode, currency, method }
      : { testMode: false, country, currency, method };
    const capabilityDecision = evaluatePaymentProviderCapability(provider.provider_key, capability, context);
    if (!capabilityDecision.allowed) {
      rejected.push(Object.freeze({ provider_key: provider.provider_key, reason: capabilityDecision.reason }));
      continue;
    }
    const snapshot = (controlPlane || []).find((row) => normalized(row?.provider_key) === provider.provider_key) || null;
    const controlDecision = evaluatePaymentControlPlane(provider.provider_key, snapshot, { testMode });
    if (!controlDecision.allowed) {
      rejected.push(Object.freeze({ provider_key: provider.provider_key, reason: controlDecision.reason }));
      continue;
    }
    routes.push(Object.freeze({
      provider_key: provider.provider_key,
      evidence_state: provider.evidence_state,
      test_only: provider.test_only,
    }));
  }
  return Object.freeze({
    routes: Object.freeze(routes),
    rejected: Object.freeze(rejected),
  });
}

export default {
  PAYMENT_CAPABILITIES,
  CAPABILITY_EVIDENCE,
  PAYMENT_ADAPTER_CALLABLE_MODES,
  PAYMENT_PROVIDER_CAPABILITY_REGISTRY,
  getPaymentProviderCapabilities,
  evaluatePaymentProviderCapability,
  assertPaymentProviderCapability,
  paymentProviderCandidatesForCountry,
  evaluatePaymentControlPlane,
  resolvePaymentProviderRoutes,
};
