/**
 * Unified Vehicle Trust Decision Model — Workstream 10.
 *
 * One coherent decision object that PRESERVES separate dimensions — it never collapses
 * identity, completeness, source coverage, conflicts, fraud, compliance, publication and
 * the eligibility gates into a single "verified" number. Each dimension carries its own
 * value, reason codes, source facts, freshness, visibility and (optional) manual override.
 *
 * The overall trust score is a TRANSPARENT, deterministic function of the dimensions —
 * never a raw AI output. AI may inform individual dimensions (advisory) but never sets a
 * governed decision here.
 *
 * The aggregation core `assembleDecision(inputs)` is pure (no I/O) so it is fully unit
 * testable; `getTrustDecision(vin)` fetches the dimension inputs and calls it.
 */
async function getDefaultClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}
import { evaluateCompleteness } from '../evidence/completenessEvaluator.js';
import { getCoverage } from '../sourceVerification/sourceVerificationService.js';
import { evaluateZimbabweRegistrationReadiness } from '../registration/zimbabweRegistrationLifecycle.js';

export const CALCULATION_VERSION = 'trust-decision-1.0.0';

const PUBLIC = 'public';
const PRIVATE = 'private';

function dim(status, value, reasonCodes = [], extra = {}) {
  return {
    status,
    value,
    reason_codes: reasonCodes,
    source_facts: extra.source_facts || [],
    policy_version: extra.policy_version || CALCULATION_VERSION,
    evaluated_at: extra.evaluated_at || null,
    staleness: extra.staleness || null,
    visibility: extra.visibility || PUBLIC,
    manual_override: extra.manual_override || null,
    override_actor: extra.override_actor || null,
    override_reason: extra.override_reason || null,
    ...extra.rest,
  };
}

/** Identity status from canonical vehicle fields + any source mismatch flags. */
function identityDimension(vehicle, sourceConflicts) {
  const present = [];
  const missing = [];
  for (const f of ['vin', 'chassis_number', 'engine_number']) {
    (vehicle && vehicle[f] ? present : missing).push(f);
  }
  if (sourceConflicts.length > 0) {
    return dim('conflict', 'identity_conflict', sourceConflicts.map((c) => `conflict:${c}`),
      { rest: { present, missing } });
  }
  if (missing.length === 0) {
    return dim('complete', 'identity_complete', [], { rest: { present, missing } });
  }
  return dim('incomplete', 'identity_incomplete', missing.map((m) => `missing:${m}`),
    { rest: { present, missing } });
}

/** Source coverage: how many of the 5 registries returned a usable result, by mode. */
function sourceCoverageDimension(coverage) {
  const byStatus = {};
  for (const c of coverage) byStatus[c.coverage_status] = (byStatus[c.coverage_status] || 0) + 1;
  const connected = coverage.filter((c) =>
    ['source_connected', 'partner_file_reviewed', 'carup_manual_reviewed'].includes(c.coverage_status)).length;
  const sandbox = coverage.filter((c) => c.coverage_status === 'sandbox_demonstration').length;
  const total = 5;
  const reasons = [];
  if (sandbox > 0) reasons.push(`sandbox_demonstration:${sandbox}`);
  if (connected > 0) reasons.push(`connected:${connected}`);
  const status = connected > 0 ? 'partial_coverage' : (sandbox > 0 ? 'demonstration_only' : 'no_coverage');
  return dim(status, `${connected}/${total}`, reasons, {
    rest: { connected, sandbox, evaluated: coverage.length, by_status: byStatus },
  });
}

/** Source conflicts: any registry that returned mismatch or high_risk. */
function sourceConflictDimension(coverage) {
  const conflicts = coverage.filter((c) => ['conflict_under_review', 'risk_flagged'].includes(c.coverage_status));
  if (conflicts.length === 0) return dim('no_conflicts', 'none', [], {});
  return dim('conflicts_present', String(conflicts.length),
    conflicts.map((c) => `${c.provider}:${c.coverage_status}`),
    { visibility: PUBLIC, rest: { providers: conflicts.map((c) => c.provider) } });
}

/** Fraud risk dimension. MVP: derived from source high_risk flags; WS3 will enrich. */
function fraudDimension(coverage, fraudInput) {
  const highRisk = coverage.filter((c) => c.coverage_status === 'risk_flagged').map((c) => c.provider);
  const reasons = highRisk.map((p) => `source_high_risk:${p}`);
  if (fraudInput && Array.isArray(fraudInput.signals)) {
    for (const s of fraudInput.signals) reasons.push(`signal:${s}`);
  }
  // Persisted fraud-engine summary: open_cases, highest_severity, blocks_publication.
  const caseSevere = fraudInput && (fraudInput.highest_severity === 'critical' || fraudInput.highest_severity === 'high' || fraudInput.blocks_publication === true);
  if (fraudInput && fraudInput.open_cases > 0) reasons.push(`open_fraud_cases:${fraudInput.open_cases}`);
  if (reasons.length === 0) return dim('clear', 'clear', [], {});
  const severe = highRisk.length > 0 || caseSevere || (fraudInput && fraudInput.severity === 'high');
  return dim(severe ? 'high' : 'watch', severe ? 'high' : 'watch', reasons, {
    visibility: PUBLIC,
    rest: { open_cases: fraudInput?.open_cases ?? 0, highest_severity: fraudInput?.highest_severity ?? null, blocks_publication: Boolean(fraudInput?.blocks_publication) },
  });
}

/** Render an eligibility dimension (insurance/finance/escrow) from a latest-status input. */
function eligibilityDimension(input, capability, visibility) {
  if (!input || !input.status || input.status === 'not_requested') return notEvaluated(capability, visibility);
  const conditions = Array.isArray(input.conditions) ? input.conditions : [];
  return dim(input.status, input.status, conditions.map((c) => `condition:${c}`), {
    visibility,
    evaluated_at: input.created_at || input.updated_at || null,
    rest: { mode: input.mode || null, validity_until: input.validity_until || null },
  });
}

/**
 * Honest placeholder for a dimension whose module is not yet evaluated for this vehicle.
 * Never reported as clear/eligible — it is explicitly 'not_evaluated'.
 */
function notEvaluated(note, visibility = PUBLIC) {
  return dim('not_evaluated', null, [`pending_module:${note}`], { visibility });
}

/** Render the dealer-compliance dimension from a compliance summary, or not_evaluated. */
function renderDealer(dealerCompliance) {
  if (!dealerCompliance) return notEvaluated('dealer_compliance');
  // Pass-through if already a dimension (has a status + reason_codes shape).
  if (dealerCompliance.reason_codes && dealerCompliance.status && dealerCompliance.value !== undefined) return dealerCompliance;
  const reasons = [];
  if (dealerCompliance.suspension_state === 'suspended') reasons.push('dealer_suspended');
  if (dealerCompliance.restriction_state === 'restricted') reasons.push('dealer_restricted');
  if (dealerCompliance.identity_status && dealerCompliance.identity_status !== 'verified') reasons.push('dealer_identity_unverified');
  const status = dealerCompliance.suspension_state === 'suspended' ? 'suspended'
    : dealerCompliance.restriction_state === 'restricted' ? 'restricted'
    : (dealerCompliance.can_publish ? 'compliant' : 'incomplete');
  return dim(status, status, reasons, {
    rest: {
      identity_status: dealerCompliance.identity_status ?? null,
      compliance_review_state: dealerCompliance.compliance_review_state ?? null,
      can_publish: Boolean(dealerCompliance.can_publish),
    },
  });
}

/** Publication eligibility = completeness gate AND no fraud block AND dealer not suspended. */
function publicationDimension(completeness, fraudInput, dealerCompliance) {
  if (!completeness) return notEvaluated('publication');
  const reasons = [];
  // blocking_gaps are {key,label}; this dimension is PUBLIC in toPublicDecision and its reason
  // codes are rendered, so interpolating the object publishes "blocking:[object Object]".
  if (!completeness.is_publishable) for (const g of (completeness.blocking_gaps || [])) reasons.push(`blocking:${g?.key ?? g}`);
  if (fraudInput && fraudInput.blocks_publication) reasons.push('fraud_block');
  if (dealerCompliance && dealerCompliance.suspension_state === 'suspended') reasons.push('dealer_suspended');
  const blocked = reasons.length > 0;
  return dim(blocked ? 'blocked' : 'publishable',
    blocked ? 'blocked' : completeness.publication_status, reasons);
}

/**
 * Pure aggregation. Returns the full decision object with separate dimensions and a
 * transparent overall score. No I/O.
 */
export function assembleDecision(inputs) {
  const {
    vin,
    vehicle = {},
    completeness = null,
    coverage = [],
    fraudInput = null,
    dealerCompliance = null,
    insurance = null,
    finance = null,
    escrow = null,
    now = null,
  } = inputs;

  const sourceConflictsList = coverage
    .filter((c) => ['conflict_under_review', 'risk_flagged'].includes(c.coverage_status))
    .map((c) => c.provider);

  const dimensions = {
    identity: identityDimension(vehicle, sourceConflictsList),
    registration_readiness: (() => {
      const readiness = evaluateZimbabweRegistrationReadiness({
        status: vehicle.registration_status,
        statusSource: vehicle.registration_status_source,
        plateNumber: vehicle.plate_number,
        tempPlateId: vehicle.temp_plate_id,
      });
      return dim(readiness.status, readiness.lifecycle_status, readiness.reason_codes, {
        rest: { publication_blocking: readiness.publication_blocking, label: readiness.label, source: readiness.source },
      });
    })(),
    evidence_completeness: completeness
      ? dim(completeness.is_publishable ? 'complete' : 'incomplete', `${completeness.completeness_percent}%`,
          // blocking_gaps are {key,label} objects; interpolating the object yields
          // "blocking:[object Object]", and these reason codes are rendered to buyers.
          (completeness.blocking_gaps || []).map((g) => `blocking:${g?.key ?? g}`),
          { rest: { pending_gaps: completeness.pending_gaps || [] } })
      : notEvaluated('completeness'),
    evidence_confidence: completeness
      ? dim('evaluated', confidenceBand(completeness.completeness_percent), [], {})
      : notEvaluated('confidence'),
    source_coverage: sourceCoverageDimension(coverage),
    source_conflicts: sourceConflictDimension(coverage),
    fraud_risk: fraudDimension(coverage, fraudInput),
    dealer_compliance: renderDealer(dealerCompliance),
    publication_eligibility: publicationDimension(completeness, fraudInput, dealerCompliance),
    insurance_eligibility: eligibilityDimension(insurance, 'insurance', PUBLIC),
    finance_eligibility: eligibilityDimension(finance, 'finance', PRIVATE),
    escrow_eligibility: eligibilityDimension(escrow, 'escrow', PUBLIC),
  };

  const { score, scoreReasons } = computeOverallScore(dimensions);

  return {
    vin,
    calculation_version: CALCULATION_VERSION,
    last_updated: now,
    overall_trust: dim(scoreBand(score), score, scoreReasons, { rest: { score } }),
    dimensions,
    known_limitations: deriveLimitations(dimensions),
  };
}

function confidenceBand(pct) {
  if (pct >= 80) return 'high';
  if (pct >= 40) return 'medium';
  return 'low';
}

function scoreBand(score) {
  if (score >= 75) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 1) return 'low';
  return 'insufficient_evidence';
}

/**
 * Transparent scoring. Starts at 0 (insufficient evidence) and adds only for positive,
 * governed signals; subtracts for conflicts/fraud. Never starts from a flattering
 * baseline — a vehicle with little evidence scores low, honestly.
 */
function computeOverallScore(dimensions) {
  let score = 0;
  const reasons = [];

  const comp = dimensions.evidence_completeness;
  if (comp.status !== 'not_evaluated' && typeof comp.value === 'string') {
    const pct = parseInt(comp.value, 10) || 0;
    const add = Math.round(pct * 0.5); // up to +50 for full completeness
    score += add;
    if (add) reasons.push(`completeness:+${add}`);
  }

  const cov = dimensions.source_coverage;
  if (cov.connected > 0) { score += cov.connected * 8; reasons.push(`sources_connected:+${cov.connected * 8}`); }
  // Sandbox demonstration contributes nothing to a real trust score (honesty).
  if (cov.sandbox > 0) reasons.push('sandbox_demonstration:+0');

  if (dimensions.identity.status === 'complete') { score += 10; reasons.push('identity_complete:+10'); }
  if (dimensions.identity.status === 'conflict') { score -= 20; reasons.push('identity_conflict:-20'); }

  if (dimensions.source_conflicts.status === 'conflicts_present') {
    const n = Number(dimensions.source_conflicts.value) || 1;
    score -= n * 15; reasons.push(`source_conflicts:-${n * 15}`);
  }
  if (dimensions.fraud_risk.status === 'high') { score -= 40; reasons.push('fraud_high:-40'); }
  else if (dimensions.fraud_risk.status === 'watch') { score -= 15; reasons.push('fraud_watch:-15'); }

  score = Math.max(0, Math.min(100, score));
  return { score, scoreReasons: reasons };
}

function deriveLimitations(dimensions) {
  const lims = [];
  if (dimensions.source_coverage.sandbox > 0) {
    lims.push('Some source results are SANDBOX demonstrations, not live government confirmations.');
  }
  if (dimensions.source_coverage.connected === 0) {
    lims.push('No live government/partner source is connected for this vehicle yet.');
  }
  if (dimensions.registration_readiness.status === 'not_recorded' || dimensions.registration_readiness.status === 'not_established') {
    lims.push('Zimbabwe registration stage has not been established from a recorded claim.');
  } else if (dimensions.registration_readiness.status === 'pending') {
    lims.push('Zimbabwe local registration is still in progress; this is a readiness limitation, not an adverse Trust finding.');
  } else if (dimensions.registration_readiness.status === 'temporary') {
    lims.push('This is recorded as a temporary foreign vehicle under TIP; ordinary sale eligibility requires review.');
  }
  for (const key of ['dealer_compliance', 'insurance_eligibility', 'finance_eligibility', 'escrow_eligibility']) {
    if (dimensions[key].status === 'not_evaluated') {
      lims.push(`${key.replace(/_/g, ' ')} has not been evaluated for this vehicle.`);
    }
  }
  return lims;
}

/** Buyer-safe projection: strips private dimensions and internal reason detail. */
export function toPublicDecision(decision) {
  const publicDims = {};
  for (const [k, d] of Object.entries(decision.dimensions)) {
    if (d.visibility === PRIVATE) continue;
    publicDims[k] = { status: d.status, value: d.value, reason_codes: d.reason_codes };
  }
  return {
    vin: decision.vin,
    calculation_version: decision.calculation_version,
    last_updated: decision.last_updated,
    // NO overall_trust. The canonical `trust` projection (canonicalTrustService.toPublicTrust) is
    // the single public statement of the position; carrying a second, live-recomputed score here
    // put both answers in one response body — buyers saw "50 · moderate" beside "Not evaluated"
    // for the same VIN at the same instant. This buyer-safe view explains a position through its
    // dimensions and reason codes; it does not restate it. The privileged branch keeps the full
    // decision, overall_trust included.
    dimensions: publicDims,
    known_limitations: decision.known_limitations,
  };
}

/** Fetch dimension inputs for a VIN and assemble the decision. */
export async function getTrustDecision(vin, opts = {}) {
  const client = opts.client ?? (await getDefaultClient());
  let vehicle = opts.vehicle || null;
  if (!vehicle) {
    const { data, error } = await client
      .from('vehicles')
      .select('vin, make, model, year, chassis_number, engine_number, plate_number, temp_plate_id, registration_status, registration_status_source, tenant_id')
      .eq('vin', vin)
      .maybeSingle();
    if (error) throw new Error(`Vehicle read error: ${error.message}`);
    vehicle = data || {};
  }
  const completeness = opts.completeness !== undefined
    ? opts.completeness
    : await evaluateCompleteness(vin, { client });

  const coverage = opts.coverage !== undefined
    ? opts.coverage
    : await getCoverage(vin, { client });

  // Each external dimension is fetched defensively — DB errors throw to fail closed,
  // while legitimate absence (0 rows) returns null cleanly.
  const fraudInput = opts.fraudInput !== undefined ? opts.fraudInput : await fetchFraudSummary(vin, client);
  const insurance = opts.insurance !== undefined ? opts.insurance : await fetchEligibility('insurance', vin, client);
  const finance = opts.finance !== undefined ? opts.finance : await fetchEligibility('finance', vin, client);
  const escrow = opts.escrow !== undefined ? opts.escrow : await fetchEscrow(vin, client);

  return assembleDecision({
    vin,
    vehicle,
    completeness,
    coverage,
    fraudInput,
    dealerCompliance: opts.dealerCompliance || null,
    insurance,
    finance,
    escrow,
    now: opts.now || new Date().toISOString(),
  });
}

async function fetchFraudSummary(vin, client) {
  const { data, error } = await client.from('fraud_cases')
    .select('status, highest_severity, blocks_publication').eq('vin', vin).eq('status', 'open');
  if (error) throw new Error(`Fraud summary read error: ${error.message}`);
  if (!data || data.length === 0) return null;
  const order = { low: 1, medium: 2, high: 3, critical: 4 };
  const highest = data.reduce((acc, c) => (order[c.highest_severity] > order[acc] ? c.highest_severity : acc), 'low');
  return { open_cases: data.length, highest_severity: highest, blocks_publication: data.some((c) => c.blocks_publication) };
}

async function fetchEligibility(capability, vin, client) {
  const { data, error } = await client.from('eligibility_requests')
    .select('status, conditions, mode, validity_until, created_at').eq('vin', vin).eq('capability', capability)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Eligibility read error on ${capability}: ${error.message}`);
  return (data && data[0]) || null;
}

async function fetchEscrow(vin, client) {
  const { data, error } = await client.from('escrow_trust_sessions')
    .select('*').eq('vin', vin).order('created_at', { ascending: false });
  if (error) throw new Error(`Escrow read error: ${error.message}`);
  return (data && data[0]) || null;
}

export default { CALCULATION_VERSION, assembleDecision, toPublicDecision, getTrustDecision };
