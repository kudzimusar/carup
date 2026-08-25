/**
 * Shared Eligibility Provider Framework — insurance + finance.
 *
 * Providers answer only after server-derived gates. Missing identity/publication/fraud/dealer facts
 * are never interpreted as clear. Hard contradictions are not_eligible; unresolved risk/compliance
 * and insufficient source/consent evidence route to manual_review.
 */
export const CAPABILITIES = ['insurance', 'finance'];
export const PROVIDER_MODES = ['live', 'sandbox', 'partner_file', 'manual_review', 'unavailable'];
export const ELIGIBILITY_STATUSES = [
  'not_requested', 'pending', 'eligible', 'conditionally_eligible', 'potentially_eligible',
  'manual_review', 'not_eligible', 'unavailable', 'expired', 'failed',
];
export const ERROR_CATEGORIES = ['timeout', 'malformed_response', 'unauthorized', 'rate_limited', 'provider_error', 'gate_failed'];

export function evaluateGates(capability, ctx = {}) {
  const reasons = [];

  // Identity and publication are hard prerequisites. Missing is not a pass.
  if (ctx.identity_status !== 'complete') {
    reasons.push(ctx.identity_status ? 'identity_unresolved' : 'identity_status_unknown');
    return block(reasons);
  }
  if (!['publishable', 'published'].includes(ctx.publication_status)) {
    reasons.push(ctx.publication_status ? 'publication_invalid' : 'publication_status_unknown');
    return block(reasons);
  }

  // A confirmed fraud/dealer block is hard. Unknown risk/compliance requires a human decision rather
  // than letting a sandbox/live provider infer that silence means clear.
  if (ctx.fraud_block === true) {
    reasons.push('fraud_block_active');
    return block(reasons);
  }
  if (ctx.fraud_block !== false) {
    reasons.push('fraud_status_unknown');
    return review(reasons);
  }
  if (ctx.dealer_suspended === true) {
    reasons.push('dealer_suspended');
    return block(reasons);
  }
  if (ctx.dealer_suspended !== false) {
    reasons.push('dealer_status_unknown');
    return review(reasons);
  }

  if (capability === 'finance' && !ctx.consent_reference) {
    reasons.push('consent_missing');
    return review(reasons);
  }
  if (ctx.source_coverage_connected == null || ctx.min_source_coverage == null) {
    reasons.push('source_coverage_unknown');
    return review(reasons);
  }
  if (ctx.source_coverage_connected < ctx.min_source_coverage) {
    reasons.push('insufficient_source_coverage');
    return review(reasons);
  }

  return { allowed: true, route: null, reasons };
}

function block(reasons) { return { allowed: false, route: 'not_eligible', reasons }; }
function review(reasons) { return { allowed: false, route: 'manual_review', reasons }; }

/** Deterministic SANDBOX provider for staging/tests. Never silently becomes live. */
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
        return {
          mode: 'sandbox',
          status: capability === 'finance' ? 'potentially_eligible' : 'conditionally_eligible',
          conditions: capability === 'finance' ? ['proof_of_income_required'] : ['valid_vid_required'],
          validity_days: 30,
          response_reference: `${id}-COND`,
        };
      }
      return { mode: 'sandbox', status: 'eligible', conditions: [], validity_days: 30, response_reference: `${id}-OK` };
    },
  };
}

export default {
  CAPABILITIES,
  PROVIDER_MODES,
  ELIGIBILITY_STATUSES,
  ERROR_CATEGORIES,
  evaluateGates,
  buildSandboxEligibilityProvider,
};
