/**
 * Image similarity + same-vehicle validation — Milestone 3A/3B (master plan §7.3, §8.3).
 *
 * Builds on the M1 perceptual-hash abstraction. Near-duplicate detection finds reused/
 * re-saved images; same-vehicle confidence combines hard identity signals (VIN/chassis/
 * plate) with visual similarity as SUPPORTING evidence (never the sole basis — §8.3).
 */
import { hammingDistance, isNearDuplicate } from '../evidence/perceptualHash.js';

export const NEAR_DUP_THRESHOLD = 10; // bits / 64

/**
 * Find near-duplicate evidence for a given perceptual hash across a candidate set.
 * @returns array of { id, vin, distance } sorted by closeness
 */
export function findNearDuplicates(perceptualHash, candidates, threshold = NEAR_DUP_THRESHOLD) {
  if (!perceptualHash) return [];
  return (candidates || [])
    .filter((c) => c.perceptual_hash)
    .map((c) => ({ id: c.id, vin: c.vin, distance: hammingDistance(perceptualHash, c.perceptual_hash) }))
    .filter((c) => c.distance <= threshold)
    .sort((a, b) => a.distance - b.distance);
}

/** Cross-vehicle image-reuse alert: same perceptual hash appearing under a DIFFERENT vin. */
export function detectCrossVehicleReuse(evidence, candidates, threshold = NEAR_DUP_THRESHOLD) {
  const dups = findNearDuplicates(evidence.perceptual_hash, candidates, threshold);
  return dups.filter((d) => d.vin && d.vin !== evidence.vin);
}

function norm(v) { return v == null ? null : String(v).trim().toUpperCase().replace(/\s+/g, ''); }

/**
 * Same-vehicle confidence between two evidence records.
 * Hard identity match dominates; perceptual similarity only nudges confidence.
 * @returns { confidence: 0..1, basis: string[] }
 */
export function sameVehicleConfidence(a, b) {
  const basis = [];
  let confidence = 0;

  if (a.vin && b.vin && norm(a.vin) === norm(b.vin)) { confidence = Math.max(confidence, 0.99); basis.push('vin'); }
  if (a.chassis_number && b.chassis_number && norm(a.chassis_number) === norm(b.chassis_number)) { confidence = Math.max(confidence, 0.95); basis.push('chassis'); }
  if (a.normalized_plate_number && b.normalized_plate_number && norm(a.normalized_plate_number) === norm(b.normalized_plate_number)) { confidence = Math.max(confidence, 0.75); basis.push('plate'); }

  // Visual similarity as supporting signal only.
  if (a.perceptual_hash && b.perceptual_hash) {
    const near = isNearDuplicate(a.perceptual_hash, b.perceptual_hash, 16);
    if (near) { confidence = Math.max(confidence, basis.length ? confidence + 0.01 : 0.4); basis.push('visual'); }
  }

  return { confidence: Math.min(1, confidence), basis };
}

export default { NEAR_DUP_THRESHOLD, findNearDuplicates, detectCrossVehicleReuse, sameVehicleConfidence };
