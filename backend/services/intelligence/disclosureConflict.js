/**
 * Seller disclosure conflict engine — Milestone 3C (master plan §9).
 *
 * Extracts structured claims from immutable listing snapshots and compares them against
 * historical evidence. It NEVER labels a seller fraudulent and never auto-publishes: every
 * conflict is neutral, evidence-based, and defaults to reviewer_state 'pending_review'
 * (master plan §9.4, §9.6). The exact original claim text is retained internally.
 */

const CLAIMS_TABLE = 'disclosure_claims';
const CONFLICTS_TABLE = 'disclosure_conflicts';

// Claim detection rules: keyword/phrase -> claim_type. Conservative, transparent.
const CLAIM_RULES = [
  { type: 'no_accident_history', re: /\b(no accident|accident[- ]free|never (had an )?accident|no damage)\b/i },
  { type: 'original_paint', re: /\b(original paint|never repainted|factory paint)\b/i },
  { type: 'no_major_repairs', re: /\b(no major repairs?|never repaired|no body ?work)\b/i },
  { type: 'genuine_mileage', re: /\b(genuine mileage|original mileage|verified mileage|low mileage)\b/i },
  { type: 'single_owner', re: /\b(one owner|single owner|1 owner|first owner)\b/i },
  { type: 'recently_inspected', re: /\b(recently inspected|fresh inspection|just serviced|new roadworthy)\b/i },
  { type: 'never_imported', re: /\b(never imported|locally owned|local car|not imported)\b/i },
];

/** Extract structured claims from a listing snapshot. Returns claim objects (not persisted). */
export function extractClaims(snapshot = {}) {
  const text = `${snapshot.title || ''}\n${snapshot.description || ''}`;
  const claims = [];
  for (const rule of CLAIM_RULES) {
    const m = text.match(rule.re);
    if (m) {
      claims.push({
        vin: snapshot.vin || null,
        listing_snapshot_id: snapshot.id || null,
        claim_type: rule.type,
        original_text: m[0],
        normalized_claim: { asserted: true, claim: rule.type },
        confidence: 0.8,
      });
    }
  }
  // Structured-field claims.
  if (snapshot.claimed_accident_status && /no|none|clean/i.test(snapshot.claimed_accident_status)) {
    claims.push({ vin: snapshot.vin || null, listing_snapshot_id: snapshot.id || null, claim_type: 'no_accident_history', original_text: snapshot.claimed_accident_status, normalized_claim: { asserted: true, source: 'field' }, confidence: 0.9 });
  }
  return claims;
}

/**
 * Compare a claim against an evidence context and classify a potential conflict.
 * evidence: { hasAccidentEvidence, hasRepairEvidence, hasStructuralRepair, hasImportEvidence,
 *             repaintFindings, mileageRegression, accidentEvidenceIds, importEvidenceIds }
 * Returns a conflict object (not persisted) or null when supported/not applicable.
 */
export function classifyConflict(claim, evidence = {}) {
  const mk = (classification, severity, evidence_ids, summary, internal) => ({
    vin: claim.vin,
    claim_id: claim.id || null,
    conflict_type: claim.claim_type,
    classification,
    evidence_ids: evidence_ids || [],
    confidence: 0.75,
    severity,
    reviewer_state: 'pending_review',
    public_summary: summary,
    internal_explanation: internal,
  });

  switch (claim.claim_type) {
    case 'no_accident_history':
      if (evidence.hasAccidentEvidence) {
        return mk('strong_conflict', 'high', evidence.accidentEvidenceIds || [],
          'Historical evidence indicates possible accident/damage history while the listing states no accident. This may be a disclosure conflict and requires reviewer confirmation.',
          'claim no_accident_history vs accident-class evidence present');
      }
      if (evidence.hasRepairEvidence || (evidence.repaintFindings || 0) > 0) {
        return mk('possible_conflict', 'medium', evidence.repairEvidenceIds || [],
          'Historical repair/paint evidence exists while the listing states no accident. This may warrant reviewer attention.',
          'claim no_accident_history vs repair/repaint evidence');
      }
      return null;
    case 'original_paint':
      if ((evidence.repaintFindings || 0) > 0) {
        return mk('possible_conflict', 'medium', evidence.repaintEvidenceIds || [],
          'A possible repaint was detected in historical evidence while the listing states original paint. Requires reviewer confirmation.',
          'claim original_paint vs repaint temporal finding');
      }
      return null;
    case 'no_major_repairs':
      if (evidence.hasStructuralRepair) {
        return mk('possible_conflict', 'medium', evidence.repairEvidenceIds || [],
          'Historical structural/major repair evidence exists while the listing states no major repairs. Requires reviewer confirmation.',
          'claim no_major_repairs vs structural repair evidence');
      }
      return null;
    case 'genuine_mileage':
      if (evidence.mileageRegression) {
        return mk('strong_conflict', 'high', evidence.mileageEvidenceIds || [],
          'Recorded mileage readings appear inconsistent over time while the listing states genuine mileage. This may be a disclosure conflict and requires reviewer confirmation.',
          'claim genuine_mileage vs mileage regression');
      }
      return null;
    case 'never_imported':
      if (evidence.hasImportEvidence) {
        return mk('strong_conflict', 'high', evidence.importEvidenceIds || [],
          'Historical import evidence exists while the listing states the vehicle was never imported. Requires reviewer confirmation.',
          'claim never_imported vs import evidence');
      }
      return null;
    default:
      return null;
  }
}

export async function persistClaims(supabase, claims) {
  const out = [];
  for (const c of claims) {
    const { data, error } = await supabase.from(CLAIMS_TABLE).insert(c).select();
    if (error) throw new Error(`claim write failed: ${error.message}`);
    out.push(Array.isArray(data) ? data[0] : data);
  }
  return out;
}

export async function persistConflict(supabase, conflict) {
  const { data, error } = await supabase.from(CONFLICTS_TABLE).insert(conflict).select();
  if (error) throw new Error(`conflict write failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

/** Record a seller response + append to the immutable correction history (master plan §9.5). */
export async function applySellerResponse(supabase, conflictId, { response, actorId }) {
  const { data: rows } = await supabase.from(CONFLICTS_TABLE).select('*').eq('id', conflictId).limit(1);
  const conflict = (Array.isArray(rows) ? rows : []).filter(Boolean)[0];
  if (!conflict) throw new Error('conflict not found');
  const history = Array.isArray(conflict.correction_history) ? conflict.correction_history : [];
  history.push({ at: new Date().toISOString(), actor: actorId || null, response });
  const { data, error } = await supabase.from(CONFLICTS_TABLE).update({
    seller_response: response, seller_response_at: new Date().toISOString(),
    correction_history: history, updated_at: new Date().toISOString(),
  }).eq('id', conflictId).select();
  if (error) throw new Error(`seller response write failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

export default { extractClaims, classifyConflict, persistClaims, persistConflict, applySellerResponse };
