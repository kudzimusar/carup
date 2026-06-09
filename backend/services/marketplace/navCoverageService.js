/**
 * Marketplace Navigation Coverage (Navigation Intelligence — data-driven nav gate).
 *
 * READ-ONLY. Reports how many REAL, public, marketplace-eligible listings exist per nav category/tag,
 * using the SAME truth rules as the public marketplace (listMarketplaceListings already hides
 * fixtures/demo rows, counts only public/available listings, and exposes no owner_id/tenant_id).
 * A category/tag is "active" only when its live count >= the promotion threshold.
 *
 * No PII: returns counts + booleans only (never listings/owner_id/tenant_id).
 */
import { listMarketplaceListings } from './listingSummaryService.js';
import { NAV_PROMOTION_THRESHOLD } from './marketplaceClassificationRules.js';

const COVERAGE_CATEGORIES = ['locally_used', 'recently_imported'];
const COVERAGE_TAGS = ['dealer_verified'];
// Governed/manual signals are NEVER activated by coverage alone (require governed workflows).
const GOVERNED_DEFERRED = ['passport_verified', 'partsentry_checked', 'brand_new', 'second_hand'];

async function countFor(supabaseClient, params) {
  const result = await listMarketplaceListings(supabaseClient, { ...params, limit: 1 });
  return Number(result.total) || 0;
}

export async function getMarketplaceNavCoverage(supabaseClient, opts = {}) {
  const threshold = opts.threshold ?? NAV_PROMOTION_THRESHOLD;

  const categories = {};
  for (const c of COVERAGE_CATEGORIES) {
    const count = await countFor(supabaseClient, { category: c });
    categories[c] = { count, active: count >= threshold };
  }

  const tags = {};
  for (const t of COVERAGE_TAGS) {
    const count = await countFor(supabaseClient, { tag: t });
    tags[t] = { count, active: count >= threshold };
  }

  return {
    threshold,
    categories,
    tags,
    governed_deferred: GOVERNED_DEFERRED, // listed for transparency; never auto-activated by coverage
  };
}
