/**
 * Vehicle identity resolution — Milestone 2 (master plan §6.4).
 *
 * Matches an incoming normalized record to a known vehicle using progressively weaker
 * signals, producing a confidence score. High-confidence matches auto-link; anything
 * ambiguous is routed to the human resolution queue — uncertain evidence is NEVER
 * silently attached to a vehicle (master plan §6.4, §2.1).
 */

// Auto-link only at/above this confidence; below -> human review queue.
export const AUTO_LINK_THRESHOLD = 0.9;

// Per-signal confidence weights (strongest identifier wins).
const METHOD_CONFIDENCE = {
  vin: 0.99,
  chassis: 0.92,
  engine: 0.8,
  source_vehicle_id: 0.75,
  plate: 0.7,
  auction_lot: 0.6,
  make_model_year: 0.3,
};

function norm(v) {
  return v == null ? null : String(v).trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * @param identity   normalized.identity from a source record
 * @param lookups    { findByVin, findByChassis, findByPlate } async fns -> vehicle row|null
 * @returns {Promise<{ vin: string|null, confidence: number, method: string|null,
 *                      requiresReview: boolean, candidates: Array }>}
 */
export async function resolveIdentity(identity = {}, lookups = {}) {
  const candidates = [];

  const tryMatch = async (method, value, finder) => {
    if (!value || typeof finder !== 'function') return;
    const vehicle = await finder(value);
    if (vehicle && vehicle.vin) {
      candidates.push({ vin: vehicle.vin, method, confidence: METHOD_CONFIDENCE[method] || 0 });
    }
  };

  await tryMatch('vin', norm(identity.vin), lookups.findByVin);
  await tryMatch('chassis', norm(identity.chassis_number), lookups.findByChassis);
  await tryMatch('plate', norm(identity.plate_number), lookups.findByPlate);

  // make/model/year alone is never enough to attach — record it as a weak candidate only.
  if (!candidates.length && identity.make && identity.model && identity.year) {
    candidates.push({ vin: null, method: 'make_model_year', confidence: METHOD_CONFIDENCE.make_model_year });
  }

  if (!candidates.length) {
    return { vin: null, confidence: 0, method: null, requiresReview: true, candidates: [] };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  // Conflict: two different VINs matched at high confidence -> always review.
  const distinctVins = new Set(candidates.filter((c) => c.vin).map((c) => c.vin));
  const conflicting = distinctVins.size > 1;

  const requiresReview = conflicting || !best.vin || best.confidence < AUTO_LINK_THRESHOLD;

  return {
    vin: requiresReview ? null : best.vin,
    confidence: best.confidence,
    method: best.method,
    requiresReview,
    candidates,
  };
}

export default { AUTO_LINK_THRESHOLD, resolveIdentity };
