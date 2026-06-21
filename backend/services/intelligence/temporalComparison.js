/**
 * Temporal visual comparison engine — Milestone 3B (master plan §8).
 *
 * Compares per-component observations across two evidence sets of the SAME vehicle (different
 * dates) and produces a structured, reviewable temporal finding. It never states a change as
 * confirmed — public summaries are cautious ("appears", "likely") and every finding defaults
 * to reviewer_state 'pending_review' (master plan §8.7). Same-vehicle confidence gates
 * publication: low confidence routes to review, never to the public report (§8.3, §8.9).
 */
import { sameVehicleConfidence } from '../ai/similarityService.js';

const TABLE = 'temporal_findings';

// Below this same-vehicle confidence, a comparison cannot be auto-surfaced (needs review).
export const SAME_VEHICLE_MIN = 0.75;

const SEVERITY_BY_TYPE = {
  replaced: 'high', newly_damaged: 'high', removed_missing: 'high',
  repainted_colour_mismatch: 'medium', worsened: 'medium', repaired: 'low',
  improved: 'info', unchanged: 'info', unable_to_compare: 'info',
};

/**
 * Classify a component's change between two observation snapshots.
 * Each obs: { present, damaged, repainted, replaced, missing, colour, severity }
 */
export function classifyComponentChange(earlier = {}, later = {}) {
  if (earlier.insufficient || later.insufficient) return 'unable_to_compare';
  if (later.replaced) return 'replaced';
  if (earlier.present && later.missing) return 'removed_missing';
  if (!earlier.damaged && later.damaged) return 'newly_damaged';
  if (earlier.damaged && !later.damaged && (later.repainted || later.repaired)) return 'repaired';
  if (later.repainted && earlier.colour && later.colour && earlier.colour !== later.colour) return 'repainted_colour_mismatch';
  if (earlier.damaged && later.damaged && (Number(later.severity) || 0) > (Number(earlier.severity) || 0)) return 'worsened';
  if (earlier.damaged && later.damaged && (Number(later.severity) || 0) < (Number(earlier.severity) || 0)) return 'improved';
  return 'unchanged';
}

function cautiousSummary(component, findingType, earlierDate, laterDate) {
  const comp = String(component || 'component').replace(/_/g, ' ');
  switch (findingType) {
    case 'replaced':
      return `The ${comp} appears different between ${earlierDate} and ${laterDate}; replacement is possible and requires reviewer confirmation.`;
    case 'newly_damaged':
      return `The ${comp} appears undamaged in ${earlierDate} evidence but shows possible damage in ${laterDate} evidence; requires reviewer confirmation.`;
    case 'repaired':
      return `The ${comp} appears damaged in ${earlierDate} and repaired by ${laterDate}; requires reviewer confirmation.`;
    case 'repainted_colour_mismatch':
      return `The ${comp} appears to show a possible colour/paint change between ${earlierDate} and ${laterDate}; requires reviewer confirmation.`;
    case 'removed_missing':
      return `The ${comp} appears present in ${earlierDate} but not visible in ${laterDate} evidence; requires reviewer confirmation.`;
    case 'worsened':
      return `The ${comp} condition appears to have worsened between ${earlierDate} and ${laterDate}.`;
    default:
      return null; // unchanged / improved / unable_to_compare get no public alert
  }
}

/**
 * Build a temporal finding object (not persisted). Returns null for non-noteworthy changes.
 */
export function buildTemporalFinding({ vin, component, earlierSet, laterSet, earlierObs, laterObs, model = 'mock-v1' }) {
  const findingType = classifyComponentChange(earlierObs, laterObs);
  const svc = sameVehicleConfidence(earlierSet || {}, laterSet || {});

  const noteworthy = !['unchanged', 'improved', 'unable_to_compare'].includes(findingType);
  const earlierDate = earlierSet?.event_date || 'earlier';
  const laterDate = laterSet?.event_date || 'later';

  return {
    vin,
    finding_type: findingType,
    component,
    earlier_set_id: earlierSet?.id || null,
    later_set_id: laterSet?.id || null,
    earlier_date: earlierSet?.event_date || null,
    later_date: laterSet?.event_date || null,
    supporting_asset_ids: [
      ...(earlierObs?.asset_ids || []),
      ...(laterObs?.asset_ids || []),
    ],
    model,
    confidence: Math.min(svc.confidence, 0.85), // visual inference is never asserted as certain
    severity: SEVERITY_BY_TYPE[findingType] || 'info',
    reviewer_state: 'pending_review',
    same_vehicle_confidence: svc.confidence,
    public_summary: noteworthy ? cautiousSummary(component, findingType, earlierDate, laterDate) : null,
    internal_explanation: `classify(${component}): ${findingType}; same-vehicle basis=[${svc.basis.join(',')}] conf=${svc.confidence}`,
    _noteworthy: noteworthy,
    _publishable: noteworthy && svc.confidence >= SAME_VEHICLE_MIN,
  };
}

export async function persistTemporalFinding(supabase, finding) {
  const { _noteworthy, _publishable, ...row } = finding;
  const { data, error } = await supabase.from(TABLE).insert(row).select();
  if (error) throw new Error(`temporal finding write failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

export async function listTemporalFindings(supabase, vin) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('vin', vin).order('created_at', { ascending: false });
  if (error) throw new Error(`temporal findings list failed: ${error.message}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

export default { SAME_VEHICLE_MIN, classifyComponentChange, buildTemporalFinding, persistTemporalFinding, listTemporalFindings };
