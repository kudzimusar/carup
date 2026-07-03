/**
 * Deterministic provider simulators — Full Activation.
 *
 * One scenario engine for EVERY provider capability (government/insurance/finance/escrow).
 * A simulated call is selected deterministically from the request (a VIN, an application id,
 * or an explicit `scenario`) so staging/UAT and automated tests can drive each path on
 * demand. Every simulated result is honestly labelled with its `mode` — a simulator value
 * can NEVER be presented as official/live clearance (enforced by the caller + DB mode column).
 *
 * Scenario matrix (required by the canonical doc §59):
 *   success · mismatch · no_record · high_risk · unavailable · timeout · rate_limit ·
 *   malformed · invalid_signature · duplicate_webhook · outage
 */
export const SIM_SCENARIOS = [
  'success', 'mismatch', 'no_record', 'high_risk', 'unavailable',
  'timeout', 'rate_limit', 'malformed', 'invalid_signature', 'duplicate_webhook', 'outage',
];

// Map a simulator scenario to the append-only attempt `outcome` enum.
export const SCENARIO_OUTCOME = {
  success: 'ok', mismatch: 'mismatch', no_record: 'no_record', high_risk: 'high_risk',
  unavailable: 'unavailable', timeout: 'timeout', rate_limit: 'rate_limited', malformed: 'malformed',
  invalid_signature: 'invalid_signature', duplicate_webhook: 'duplicate', outage: 'unavailable',
};

/** Deterministically choose a scenario from a request. Explicit `scenario` wins. */
export function resolveScenario(req = {}) {
  if (req.scenario && SIM_SCENARIOS.includes(req.scenario)) return req.scenario;
  const key = String(req.vin || req.value || req.reference || '').toUpperCase();
  if (key.includes('MISMATCH')) return 'mismatch';
  if (key.includes('NORECORD')) return 'no_record';
  if (key.includes('STOLEN') || key.includes('RISK')) return 'high_risk';
  if (key.includes('UNAVAIL')) return 'unavailable';
  if (key.includes('TIMEOUT')) return 'timeout';
  if (key.includes('RATELIMIT')) return 'rate_limit';
  if (key.includes('MALFORMED')) return 'malformed';
  if (key.includes('OUTAGE')) return 'outage';
  return 'success';
}

/**
 * Produce a deterministic simulated provider response for a capability + scenario.
 * Returns { scenario, outcome, retryable, confidence, data, error_category }.
 */
export function simulateProvider(capabilityType, req = {}) {
  const scenario = resolveScenario(req);
  const outcome = SCENARIO_OUTCOME[scenario];
  const retryable = ['timeout', 'rate_limit'].includes(scenario);
  const base = { scenario, outcome, retryable, mode: req.mode || 'sandbox' };

  if (scenario === 'timeout') return { ...base, error_category: 'timeout', confidence: null, data: null };
  if (scenario === 'rate_limit') return { ...base, error_category: 'rate_limited', confidence: null, data: null };
  if (scenario === 'malformed') return { ...base, error_category: 'malformed_response', confidence: null, data: { junk: true } };
  if (scenario === 'outage' || scenario === 'unavailable') return { ...base, error_category: scenario === 'outage' ? 'provider_error' : 'unavailable', confidence: null, data: null };
  if (scenario === 'no_record') return { ...base, confidence: 0.2, data: capabilityData(capabilityType, 'no_record') };
  if (scenario === 'high_risk') return { ...base, confidence: 0.9, data: capabilityData(capabilityType, 'high_risk') };
  if (scenario === 'mismatch') return { ...base, confidence: 0.6, data: capabilityData(capabilityType, 'mismatch') };
  return { ...base, confidence: 0.85, data: capabilityData(capabilityType, 'success') };
}

// Capability-shaped, honestly-labelled synthetic payloads (never real institution data).
function capabilityData(capabilityType, scenario) {
  const tag = 'SIMULATED';
  switch (capabilityType) {
    case 'government_source':
      return { tag, reference: `SIM-GOV-${scenario.toUpperCase()}`, note: 'simulator — not official clearance' };
    case 'insurance':
      return { tag, eligibility: scenario === 'success' ? 'eligible' : scenario === 'mismatch' ? 'conditional' : scenario === 'high_risk' ? 'declined' : 'manual_review', conditions: scenario === 'mismatch' ? ['valid_vid_required'] : [], reference: `SIM-INS-${scenario.toUpperCase()}` };
    case 'finance':
      return { tag, eligibility: scenario === 'success' ? 'potentially_eligible' : scenario === 'mismatch' ? 'conditional' : scenario === 'high_risk' ? 'declined' : 'manual_review', reference: `SIM-FIN-${scenario.toUpperCase()}` };
    case 'escrow':
      return { tag, transaction_state: scenario === 'success' ? 'funded_sandbox' : scenario === 'high_risk' ? 'blocked' : 'pending', reference: `SIM-ESC-${scenario.toUpperCase()}` };
    default:
      return { tag, reference: `SIM-${scenario.toUpperCase()}` };
  }
}

export default { SIM_SCENARIOS, SCENARIO_OUTCOME, resolveScenario, simulateProvider };
