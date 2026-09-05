import { supabase } from '../../db/supabase.js';

/**
 * Dealer reputation — a READ and a RECOMPUTE, deliberately separated.
 *
 * `calculateDealerReputation` used to be both at once, behind an UNAUTHENTICATED GET. It computed a
 * 75.0-baseline score and WROTE it to `stakeholder_profiles.trust_score` on every call, then handed
 * the anonymous caller a verification tier derived from it. Two consequences:
 *
 *   · any crawler re-scored every dealer it visited, and
 *   · a dealer with zero escrows was published as 75 / 'Standard Verified' with nothing behind it.
 *
 * That written column is consumed as authority elsewhere — trustEnforcementEngine reads it to
 * propagate stakeholder risk onto every one of that seller's vehicles, and insuranceService prices
 * premiums off it — so a GET was quietly moving trust across the platform.
 *
 * The split: the read publishes only what was actually stored, and the recompute is the single
 * writer, reachable only from an authenticated, role-checked route.
 */

/** The escrow-derived score. Pure: computes, never writes. */
function scoreFromEscrows(escrows) {
  const total = escrows?.length || 0;
  const completed = escrows?.filter(e => e.status === 'Completed').length || 0;
  const disputed = escrows?.filter(e => e.status === 'Disputed').length || 0;

  let baseReputation = 75.0;
  if (total > 0) {
    const successRatio = completed / total;
    baseReputation += (successRatio * 15.0) + (completed * 2.0) - (disputed * 10.0);
  }
  return {
    score: parseFloat(Math.min(100.0, Math.max(10.0, baseReputation)).toFixed(1)),
    stats: { totalEscrows: total, completedEscrows: completed, disputedEscrows: disputed },
  };
}

/**
 * A tier is a statement about a MEASURED score. An unmeasured dealer has no tier — publishing
 * 'Standard Verified' for one would be the fabrication this split exists to remove.
 */
function tierFor(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score >= 90.0 ? 'Diamond Certified Dealer' : 'Standard Verified';
}

/**
 * PURE READ. Publishes the stored reputation and nothing else.
 *
 * `reputation_state` distinguishes the three answers a caller must be able to tell apart:
 *   'recorded'    — a score has been computed and stored
 *   'unmeasured'  — the profile exists but carries no score. NOT a zero, and NOT a 75.
 *   'not_found'   — no such stakeholder profile
 */
export async function readDealerReputation(dealerId) {
  const { data: profile, error } = await supabase
    .from('stakeholder_profiles').select('user_id, trust_score').eq('user_id', dealerId).maybeSingle();

  if (error) return { dealerId, reputation_state: 'unavailable', reputationScore: null, verificationTier: null };
  if (!profile) return { dealerId, reputation_state: 'not_found', reputationScore: null, verificationTier: null };

  const stored = typeof profile.trust_score === 'number' && Number.isFinite(profile.trust_score)
    ? profile.trust_score
    : null;

  return {
    dealerId,
    reputation_state: stored === null ? 'unmeasured' : 'recorded',
    reputationScore: stored,
    verificationTier: tierFor(stored),
  };
}

/**
 * RECOMPUTE AND PERSIST. The single writer of `stakeholder_profiles.trust_score` in this service.
 * Callers must be authenticated and role-checked — see the route that mounts it.
 */
export async function recalculateDealerReputation(dealerId) {
  const { data: profile } = await supabase
    .from('stakeholder_profiles').select('*').eq('user_id', dealerId).maybeSingle();
  if (!profile) return { error: 'Dealer profile not found' };

  const { data: escrows } = await supabase
    .from('safepay_escrows').select('status').eq('seller_id', dealerId);

  const { score, stats } = scoreFromEscrows(escrows);

  const { error: writeError } = await supabase
    .from('stakeholder_profiles').update({ trust_score: score }).eq('user_id', dealerId);
  if (writeError) throw new Error(`Failed to persist dealer reputation: ${writeError.message}`);

  return {
    dealerId,
    reputation_state: 'recorded',
    reputationScore: score,
    verificationTier: tierFor(score),
    stats,
  };
}
