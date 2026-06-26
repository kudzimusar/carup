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
import { supabase } from '../../db/supabase.js';
import { evaluateCompleteness } from '../evidence/completenessEvaluator.js';
import { getCoverage } from '../sourceVerification/sourceVerificationService.js';

export const CALCULATION_VERSION = 'trust-decision-1.0.0';

const PUBLIC = 'public';
const PRIVATE = 'private';

function dim(status, value, reasonCodes = [], extra = {}) {
  return {
    status,
    value,
    reason_codes: reasonCodes,
    visibility: extra.visibility || PUBLIC,
    source_facts: extra.source_facts || [],
    manual_override: extra.manual_override || null,
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
  const hasPlate = vehicle && (vehicle.plate_number || vehicle.temp_plate_id);
  if (hasPlate) present.push('plate_or_temp'); else missing.push('plate_or_temp');

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
  if (reasons.length === 0) return dim('clear', 'clear', [], {});
  const severe = highRisk.length > 0 || (fraudInput && fraudInput.severity === 'high');
  return dim(severe ? 'high' : 'watch', severe ? 'high' : 'watch', reasons, { visibility: PUBLIC });
}

/**
 * Honest placeholder for a dimension whose module is not yet evaluated for this vehicle.
 * Never reported as clear/eligible — it is explicitly 'not_evaluated'.
 */
function notEvaluated(note, visibility = PUBLIC) {
  return dim('not_evaluated', null, [`pending_module:${note}`], { visibility });
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
    evidence_completeness: completeness
      ? dim(completeness.is_publishable ? 'complete' : 'incomplete', `${completeness.completeness_percent}%`,
          (completeness.blocking_gaps || []).map((g) => `blocking:${g}`),
          { rest: { pending_gaps: completeness.pending_gaps || [] } })
      : notEvaluated('completeness'),
    evidence_confidence: completeness
      ? dim('evaluated', confidenceBand(completeness.completeness_percent), [], {})
      : notEvaluated('confidence'),
    source_coverage: sourceCoverageDimension(coverage),
    source_conflicts: sourceConflictDimension(coverage),
    fraud_risk: fraudDimension(coverage, fraudInput),
    dealer_compliance: dealerCompliance || notEvaluated('dealer_compliance'),
    publication_eligibility: completeness
      ? dim(completeness.is_publishable ? 'publishable' : 'blocked',
          completeness.publication_status,
          completeness.is_publishable ? [] : (completeness.blocking_gaps || []).map((g) => `blocking:${g}`))
      : notEvaluated('publication'),
    insurance_eligibility: insurance || notEvaluated('insurance', PUBLIC),
    finance_eligibility: finance || notEvaluated('finance', PRIVATE),
    escrow_eligibility: escrow || notEvaluated('escrow', PUBLIC),
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
    overall_trust: { status: decision.overall_trust.status, value: decision.overall_trust.value },
    dimensions: publicDims,
    known_limitations: decision.known_limitations,
  };
}

/** Fetch dimension inputs for a VIN and assemble the decision. */
export async function getTrustDecision(vin, opts = {}) {
  let vehicle = opts.vehicle || null;
  if (!vehicle) {
    try {
      const { data } = await supabase
        .from('vehicles')
        .select('vin, make, model, year, chassis_number, engine_number, plate_number, temp_plate_id, tenant_id')
        .eq('vin', vin)
        .maybeSingle();
      vehicle = data || {};
    } catch { vehicle = {}; }
  }
  let completeness = null;
  try { completeness = await evaluateCompleteness(vin); } catch { /* dimension stays not_evaluated */ }
  let coverage = [];
  try { coverage = await getCoverage(vin); } catch { /* coverage stays empty */ }

  return assembleDecision({
    vin,
    vehicle,
    completeness,
    coverage,
    fraudInput: opts.fraudInput || null,
    dealerCompliance: opts.dealerCompliance || null,
    insurance: opts.insurance || null,
    finance: opts.finance || null,
    escrow: opts.escrow || null,
    now: opts.now || new Date().toISOString(),
  });
}

export default { CALCULATION_VERSION, assembleDecision, toPublicDecision, getTrustDecision };
