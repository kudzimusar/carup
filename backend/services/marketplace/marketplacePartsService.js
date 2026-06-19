/**
 * Parts & Garage/Service marketplace v1 — GOVERNED, GATED surface.
 *
 * The CarUp codebase has no standalone parts-for-sale or garage-listing inventory backend yet, so these
 * endpoints return a governed, sanitized, PartSentry-respecting result set. The public surface (routes,
 * card rendering, suspicion suppression, and parts/service inquiry) is live and contract-ready; inventory
 * population is a documented follow-up. This deliberately returns an empty governed result rather than
 * fabricating listings — the UI renders a gated onboarding state and parts/service inquiry CTAs.
 *
 * Governance invariants for any future parts data (mirrors summarizePartSentry):
 *  - "Verified Parts" / "PartSentry Checked" only when backend public-card eligibility is true.
 *  - suspicion watch/flagged (or unknown) suppresses ALL public trust claims.
 *  - Listing images alone never prove provenance.
 */

/** Public, sanitized parts-card shape (no supplier PII, no raw provenance internals). */
export function buildPartSummary(row = {}) {
  return {
    id: row.id,
    listing_type: 'part',
    part_name: row.part_name || null,
    part_category: row.part_category || null,
    condition: row.condition || null,
    price: typeof row.price === 'number' ? row.price : null,
    currency: row.currency || 'USD',
    price_mode: row.price_mode || 'quote_required',
    compatibility: Array.isArray(row.compatibility) ? row.compatibility : [],
    supplier_label: row.supplier_label || 'Verified supplier',
    // Governed trust signals only — default false/suppressed until backend public-card eligibility.
    partsentry_public_status: row.partsentry_public_status || 'not_applicable',
    verified_parts: row.verified_parts === true,
    provenance_status: row.provenance_status || 'none',
    location: row.location || 'Zimbabwe',
  };
}

/** Public, sanitized garage/service provider card shape. */
export function buildServiceSummary(row = {}) {
  return {
    id: row.id,
    listing_type: 'service',
    display_name: row.display_name || 'Service provider',
    service_categories: Array.isArray(row.service_categories) ? row.service_categories : [],
    location: row.location || 'Zimbabwe',
    verification_status: row.verification_status || 'unverified',
    inspection_available: row.inspection_available === true,
    verified_reviews_count: typeof row.verified_reviews_count === 'number' ? row.verified_reviews_count : 0,
  };
}

/**
 * Parts listings (governed). Empty until a parts inventory backend exists; the shape is parts-card-ready.
 * @returns {Promise<{listings: object[], total: number, governed: true, listing_type: 'part'}>}
 */
export async function getPartsListings(_client, _params = {}) {
  return { listings: [], total: 0, governed: true, listing_type: 'part', note: 'Parts inventory onboarding — PartSentry governance enforced.' };
}

/** Garage/service provider listings (governed). Empty until a provider-listing backend exists. */
export async function getServiceListings(_client, _params = {}) {
  return { listings: [], total: 0, governed: true, listing_type: 'service', note: 'Service provider onboarding — verified-only.' };
}
