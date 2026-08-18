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
 *
 * ===========================================================================================
 * ISSUE #164 PHASE 4 — THE SIBLING PUBLIC SURFACES, CLOSED ON THE SAME TERMS AS THE VEHICLE.
 *
 * GET /api/marketplace/parts and /api/marketplace/services are UNAUTHENTICATED (marketplaceRoutes.js
 * :59 and :63), so every value these builders emit is a public claim, judged by the same rule as a
 * vehicle listing's: a missing fact publishes as an explicit unknown, never as a plausible default.
 * Four substitutions were doing exactly what the vehicle card's country literal did, and the row
 * shapes are still forward-looking — which is precisely why they had to go now, before a single row
 * exists to be described by them:
 *
 *   · `supplier_label: row.supplier_label || 'Verified supplier'` — THE CANONICAL EXAMPLE the claim
 *     contract's own header names. It is an unearned VERIFICATION claim, asserted by a fallback,
 *     about a supplier this platform has verified nothing about. It is strictly worse than the
 *     vehicle-side 'Verified dealer' it mirrors, because it would have been printed on the card of
 *     any supplier whose name we simply did not hold.
 *   · `display_name: row.display_name || 'Service provider'` — the generic-label form of the same
 *     defect (contract Rule 3, "a listing whose seller has published no name has no name to show,
 *     and inventing a category label to fill the gap is the same fabrication in a smaller font").
 *   · `location: row.location || 'Zimbabwe'` on BOTH builders — the country literal, one table over.
 *   · `currency: row.currency || 'USD'` — a number with no currency is not a price.
 *
 * NO REPLACEMENT LABEL IS INVENTED for any of them. Each is now a stated pair built with the
 * canonical contract's `statedValue()`, flattened onto the existing key plus a `*_state` companion
 * — the same shape marketplaceListingDetailService publishes for the vehicle seller block, so a
 * card renderer reads absence the same way on every surface. `sealClaimBlock()` is deliberately NOT
 * used: its declared blocks describe a VEHICLE listing (a location there is city/province/country,
 * not one free-text string), and widening LISTING_CLAIM_BLOCKS to fit a part is a reviewed change to
 * the contract, not a per-caller addition — which that helper refuses by design.
 *
 * A CONSUMER STILL TO UPDATE, recorded rather than reached into from here:
 * web/src/pages/MarketplaceCategoryPage.tsx:133 renders `{p.supplier_label} · {p.location}` with no
 * absent-state branch. Both are now null when unrecorded, which React renders as empty rather than
 * as a fabricated label — correct in substance, and it leaves a bare separator to tidy. That file
 * belongs to another lane; the listing arrays are empty today, so nothing renders either way.
 * ===========================================================================================
 */

import { statedValue } from '../../utils/publicVehicleProjection.js';

/** Public, sanitized parts-card shape (no supplier PII, no raw provenance internals). */
export function buildPartSummary(row = {}) {
  const currency = statedValue(row.currency);
  // The supplier's OWN published name, or nothing. Never a verification claim, never a category.
  const supplierLabel = statedValue(row.supplier_label);
  const location = statedValue(row.location);

  return {
    id: row.id,
    listing_type: 'part',
    part_name: row.part_name || null,
    part_category: row.part_category || null,
    condition: row.condition || null,
    price: typeof row.price === 'number' ? row.price : null,
    currency: currency.value,
    currency_state: currency.state,
    price_mode: row.price_mode || 'quote_required',
    compatibility: Array.isArray(row.compatibility) ? row.compatibility : [],
    supplier_label: supplierLabel.value,
    supplier_label_state: supplierLabel.state,
    // Governed trust signals only — default false/suppressed until backend public-card eligibility.
    // These stay as they are: `false` / 'not_applicable' / 'none' are the ABSENCE of a trust claim
    // rather than a substitute for a missing one, which is the opposite of the four values above.
    partsentry_public_status: row.partsentry_public_status || 'not_applicable',
    verified_parts: row.verified_parts === true,
    provenance_status: row.provenance_status || 'none',
    location: location.value,
    location_state: location.state,
  };
}

/** Public, sanitized garage/service provider card shape. */
export function buildServiceSummary(row = {}) {
  // The provider's OWN published name, or nothing. 'Service provider' described the category this
  // endpoint returns, not the business on the card.
  const displayName = statedValue(row.display_name);
  const location = statedValue(row.location);

  return {
    id: row.id,
    listing_type: 'service',
    display_name: displayName.value,
    display_name_state: displayName.state,
    service_categories: Array.isArray(row.service_categories) ? row.service_categories : [],
    location: location.value,
    location_state: location.state,
    // Fail-closed absence of a verification claim, not a stand-in for one — kept for the same
    // reason `verified_parts: false` is kept above.
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
