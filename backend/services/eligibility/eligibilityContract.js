/**
 * Shared Eligibility Provider Framework — Workstream C.
 *
 * One contract for every eligibility capability (insurance, finance). Providers declare a
 * `mode` and answer a request with a decision. Gates run BEFORE the provider: if identity
 * is unresolved, a critical fraud case is open, publication is invalid, the dealer is
 * suspended, source coverage is insufficient, or consent is missing, the request fails
 * closed (not_eligible) or routes to manual_review — the provider is never even called.
 *
 * A provider must NEVER silently fall back from live to sandbox in production.
 */
export const CAPABILITIES = ['insurance', 'finance'];

export const PROVIDER_MODES = ['live', 'sandbox', 'partner_file', 'manual_review', 'unavailable'];

export const ELIGIBILITY_STATUSES = [
  'not_requested', 'pending', 'eligible', 'conditionally_eligible', 'potentially_eligible',
  'manual_review', 'not_eligible', 'unavailable', 'expired', 'failed',
];

export const ERROR_CATEGORIES = ['timeout', 'malformed_response', 'unauthorized', 'rate_limited', 'provider_error', 'gate_failed'];

/**
 * Evaluate the trust gates. Returns { allowed, route, reasons }:
 *   allowed=false, route='not_eligible' for hard blocks (identity/fraud/publication/dealer)
 *   allowed=false, route='manual_review' for soft blocks (insufficient source coverage, missing consent for finance)
 *   allowed=true otherwise.
 * Pure — no I/O — so it is fully unit testable.
 */
export function evaluateGates(capability, ctx = {}) {
  const reasons = [];
  // Hard, fail-closed blocks.
  if (ctx.identity_status && ctx.identity_status !== 'complete') { reasons.push('identity_unresolved'); return block(reasons); }
  if (ctx.fraud_block) { reasons.push('fraud_block_active'); return block(reasons); }
  if (ctx.publication_status && !['publishable', 'published'].includes(ctx.publication_status)) {
    reasons.push('publication_invalid'); return block(reasons);
  }
  if (ctx.dealer_suspended) { reasons.push('dealer_suspended'); return block(reasons); }

  // Soft blocks -> manual review.
  if (capability === 'finance' && !ctx.consent_reference) { reasons.push('consent_missing'); return review(reasons); }
  if (ctx.source_coverage_connected != null && ctx.min_source_coverage != null &&
      ctx.source_coverage_connected < ctx.min_source_coverage) {
    reasons.push('insufficient_source_coverage'); return review(reasons);
  }
  return { allowed: true, route: null, reasons };
}
function block(reasons) { return { allowed: false, route: 'not_eligible', reasons }; }
function review(reasons) { return { allowed: false, route: 'manual_review', reasons }; }

/**
 * Deterministic SANDBOX provider. Scenario is selected from the VIN so staging/UAT/tests
 * can drive each path:
 *   VIN contains 'ELIGCOND'  -> conditionally_eligible / potentially_eligible (finance)
 *   VIN contains 'ELIGMANUAL'-> manual_review
 *   VIN contains 'ELIGNO'    -> not_eligible
 *   VIN contains 'ELIGUNAVAIL' -> unavailable (mode unavailable)
 *   VIN contains 'ELIGTIMEOUT' -> failed (error timeout)
 *   otherwise                -> eligible
 */
export function buildSandboxEligibilityProvider(capability, opts = {}) {
  const id = opts.providerId || `${capability}_sandbox`;
  return {
    capability,
    providerId: id,
    getMode() {
      if (opts.isEnabled && opts.isEnabled() === false) return 'unavailable';
      return 'sandbox';
    },
    async decide(request) {
      const vin = String(request.vin || '').toUpperCase();
      if (opts.isEnabled && opts.isEnabled() === false) {
        return { mode: 'unavailable', status: 'unavailable', error_category: 'provider_error', conditions: [], response_reference: null };
      }
      if (vin.includes('ELIGUNAVAIL')) return { mode: 'unavailable', status: 'unavailable', error_category: 'timeout', conditions: [] };
      if (vin.includes('ELIGTIMEOUT')) return { mode: 'sandbox', status: 'failed', error_category: 'timeout', conditions: [] };
      if (vin.includes('ELIGNO')) return { mode: 'sandbox', status: 'not_eligible', conditions: ['risk_too_high'], response_reference: `${id}-NO` };
      if (vin.includes('ELIGMANUAL')) return { mode: 'sandbox', status: 'manual_review', conditions: ['needs_human_review'], response_reference: `${id}-MR` };
      if (vin.includes('ELIGCOND')) {
        return { mode: 'sandbox', status: capability === 'finance' ? 'potentially_eligible' : 'conditionally_eligible',
          conditions: capability === 'finance' ? ['proof_of_income_required'] : ['valid_vid_required'],
          validity_days: 30, response_reference: `${id}-COND` };
      }
      return { mode: 'sandbox', status: 'eligible', conditions: [], validity_days: 30, response_reference: `${id}-OK` };
    },
  };
}

export default { CAPABILITIES, PROVIDER_MODES, ELIGIBILITY_STATUSES, ERROR_CATEGORIES, evaluateGates, buildSandboxEligibilityProvider };
