/**
 * Marketplace listing-detail assembler (GET /api/marketplace/listings/:id).
 *
 * Returns a fully sanitized MarketplaceListingDetail (summary + trust/verification/pricing summaries +
 * media + seller summary + safety warnings + SafePay-ready intent contract). Only PUBLIC, non-fixture,
 * eligible listings resolve — everything else 404s (NotFoundError). Never echoes owner_id/tenant_id,
 * registry identifiers (plate_number/normalized_plate_number/chassis_number), or any private
 * trust/evidence data. The whole payload derives from buildMarketplaceListingSummary and the trust/
 * verification/pricing summaries — the raw vehicle row is never spread into the response, and
 * LISTING_SELECT_COLUMNS does not fetch those identifiers in the first place.
 *
 * Issue #164 Phase 4: the seller and location facts this page states now come from the canonical
 * listing claim contract (`listingSummary.claims`, built in utils/publicVehicleProjection.js). This
 * file no longer holds a country literal, a fallback country or a category label standing in for a
 * seller's name; where nothing was recorded the payload says so in a state rather than filling the
 * gap with something plausible.
 *
 * ── Issue #164 Phase 5: THE SECOND MEDIA CONTRACT, AND ITS REMOVAL ─────────────────────────────
 * This file held the OTHER definition of "a publishable media URL", and it was the permissive one.
 * The shipped projection was:
 *
 *     const media = [...imageRows].sort(...).filter((row) => row?.image_url)
 *       .map((row) => ({ url: row.image_url, type: 'image', is_primary: Boolean(row.is_primary) }));
 *
 * Three defects, all reproduced against this code before it was changed:
 *
 *   1. `.filter(row => row?.image_url)` asks only whether the column is TRUTHY. Fed four rows whose
 *      urls were `data:image/png;base64,AAAA`, `javascript:alert(1)`, `photo.jpg` and one real https
 *      URL, this published ALL FOUR verbatim. The canonical contract publishes exactly one of them
 *      and records `unpublishable_count: 3`.
 *   2. `is_primary: Boolean(row.is_primary)` publishes EVERY claimant. Fed two rows that both claim
 *      primacy — which no index prevents — it published two "main photos" and left the consumer to
 *      arbitrate. Rule 6 demotes all but the first in sort order.
 *   3. The row's `id` was dropped, so this transport could not name a photograph. Continuity between
 *      the marketplace and the passport could only be argued by comparing URL STRINGS, and 3 of 3
 *      staging rows are site-relative `/uat/owner/*.svg` paths with no uniqueness constraint behind
 *      them — string equality there proves two surfaces printed the same characters, not that they
 *      showed the same picture.
 *
 * WHY THE `media` KEY IS KEPT RATHER THAN REPLACED. `listing_media` (the canonical envelope) is now
 * the authority on this payload, but `media` survives as a strictly-derived COMPATIBILITY VIEW,
 * because renaming it breaks live readers: `web/src/pages/VehicleDetail.tsx:1376` feeds `detail.media`
 * to its own listing-media projection AND requires `type === 'image'` on each entry, and
 * `mobile/utils/marketplaceApi.ts:57` declares the array shape. `media` is not a second computation
 * that could drift — every entry is `listing_media.items[i]` plus the one legacy key, and
 * `issue164-phase5-marketplace-convergence.test.js` pins that derivation to exact equality. A VIEW
 * cannot disagree with its source; a second projection can, and that is the distinction between this
 * and the `plate_status` duplication Phase 4 removed.
 */

import {
  LISTING_SELECT_COLUMNS,
  buildMarketplaceListingSummary,
  fetchCanonicalTrustByVin,
  fetchListingRelatedRows,
  filterVisibleVehicles,
  listingImageRowsForVin,
  shouldShowFixtures,
} from './listingSummaryService.js';
import { toListingMediaBlock } from '../../utils/vehicleMediaProjection.js';
import { getFixtureExclusion } from './marketplaceClassificationRules.js';
import { buildTrustSummary, buildVerificationSummary } from './marketplaceTrustSummaryService.js';
import { buildPricingSummary } from './marketplacePricingService.js';
import { deriveListingPublicStatus } from './marketplaceModerationService.js';
import { NotFoundError } from '../../utils/errors.js';

const PUBLIC_SAFETY_WARNINGS = [
  'Do not pay outside CarUp.',
  'Use the verified inquiry flow to contact the seller.',
  'An independent inspection is recommended before purchase.',
  'Public trust badges are evidence-based and backend-governed.',
  'Report any listing that asks you to transact off-platform.',
];

/**
 * The seller block of the detail payload.
 *
 * Two fabrications lived here. `location: listingSummary.location || 'Zimbabwe'` turned an absent
 * location into a country claim, and `country: 'ZW'` was a literal that no column fed at all — a
 * detail page asserting a country for a vehicle whose location had never been recorded, and one
 * that would go on asserting it after the seller recorded a different one. Both are replaced by the
 * governed claim: the composed label when parts are recorded, otherwise null with the state that
 * says whether nothing is held or something is withheld.
 *
 * The `*_claim` fields carry the stated pairs so a consumer that wants provenance can read it
 * without the flat fields having to encode two things at once.
 */
function buildSellerSummary(listingSummary) {
  const { seller, location } = listingSummary.claims;
  return {
    display_label: listingSummary.seller_display_label,
    display_label_state: listingSummary.seller_display_label_state,
    seller_type: listingSummary.seller_type,
    seller_type_claim: seller.seller_type,
    public_profile_enabled: listingSummary.seller_public_profile_enabled === true,
    // Channel KINDS only, never an address — and `not_recorded` here, because this path resolves
    // no contact channels. Phase 0 removed a fabricated phone number from a surface that had
    // invented one to fill exactly this hole.
    contact_channel: seller.contact_channel,
    location: listingSummary.location,
    location_state: listingSummary.location_state,
    location_claim: location,
  };
}

function buildShortDescription(summary) {
  const bits = [summary.year, summary.make, summary.model].filter(Boolean).join(' ');
  const condition = String(summary.condition_category || '').replace(/_/g, ' ');
  return condition && condition !== 'unknown' ? `${bits} — ${condition}` : bits;
}

function buildDescription(summary) {
  const parts = [];
  const headline = [summary.year, summary.make, summary.model].filter(Boolean).join(' ');
  if (headline) parts.push(`${headline} listed on the CarUp marketplace.`);
  // `!== null`, not truthiness: a recorded 0 km is a fact about a delivery-mileage vehicle, and
  // dropping it here would have made a genuine zero indistinguishable from a never-captured odometer
  // in the one sentence a shopper actually reads.
  if (summary.mileage !== null && summary.mileage !== undefined) {
    parts.push(`Approx. ${Number(summary.mileage).toLocaleString()} km.`);
  }
  if (summary.fuel_type) parts.push(`${summary.fuel_type} engine.`);
  if (summary.transmission) parts.push(`${summary.transmission} transmission.`);
  parts.push('Trust and verification details are backend-governed — see the trust summary.');
  return parts.join(' ');
}

function buildTransactionIntent(trustSummary) {
  const blocked = trustSummary.risk_status === 'blocked';
  return {
    transaction_intent_id: null,
    payment_readiness_status: blocked ? 'not_ready' : 'inquiry_only',
    escrow_required: true,
    deposit_allowed: false,
    operator_review_required: trustSummary.risk_status !== 'clear',
    fraud_hold_status: blocked ? 'hold' : 'none',
  };
}

/**
 * @param {object} supabaseClient
 * @param {string} vin
 * @param {{ audience?: 'public'|'admin', showFixtures?: boolean }} [options]
 * @returns {Promise<object>} MarketplaceListingDetail
 */
export async function getMarketplaceListingDetail(supabaseClient, vin, { audience = 'public', showFixtures } = {}) {
  if (!vin) throw new NotFoundError('Listing not found');

  const { data: rows, error } = await supabaseClient
    .from('vehicles')
    .select(LISTING_SELECT_COLUMNS)
    .eq('vin', vin);
  if (error) throw error;

  const candidate = Array.isArray(rows) ? rows[0] : rows;
  if (!candidate) throw new NotFoundError('Listing not found');

  if (audience === 'admin') {
    // Admins may inspect ANY non-fixture listing (incl. suppressed / rejected / flagged / pending) —
    // the exact listings they must moderate. Apply ONLY the fixture guard, never the public-status
    // filter (which would 404 every quarantined listing).
    const showFx = showFixtures ?? shouldShowFixtures();
    if (!showFx && getFixtureExclusion(candidate) !== null) {
      throw new NotFoundError('Listing not found');
    }
  } else {
    // Public/buyer audience: only publicly-visible, non-fixture listings resolve.
    const visible = filterVisibleVehicles([candidate], { showFixtures });
    if (!visible.length) throw new NotFoundError('Listing not found');
  }
  const vehicle = candidate;

  const [related, trustByVin] = await Promise.all([
    fetchListingRelatedRows(supabaseClient, [vin]),
    // THE SAME READ THE LIST USES. `fetchCanonicalTrustByVin` is the cache-only batch path, so the
    // detail page reports exactly what the card reported for this VIN — same score, same
    // evaluation_state, same calculation_version. Recomputing here instead would let the detail
    // publish a number the list had withheld, which is the list-84/detail-90 split again with
    // better provenance.
    fetchCanonicalTrustByVin(supabaseClient, [vin]),
  ]);
  const { evidenceByVin, partSentryByVin, ownershipByVin } = related;

  const evidenceRows = evidenceByVin.get(vin) || [];
  const partSentryRows = partSentryByVin.get(vin) || [];
  // ARRAY when `listing_images` was consulted, `null` when the read did not resolve. Passing `[]`
  // for a failed read is how a query error becomes the sentence "the seller added no photos".
  const imageRows = listingImageRowsForVin(related, vin);

  const listingSummary = buildMarketplaceListingSummary({
    vehicle,
    evidenceRows,
    partSentryRows,
    ownershipCount: (ownershipByVin.get(vin) || []).length,
    imageRows,
    canonicalTrust: trustByVin.get(vin) || null,
  });

  const trust_summary = buildTrustSummary({ vehicle, listingSummary, evidenceRows, partSentryRows, audience });
  const verification_summary = buildVerificationSummary({ vehicle, listingSummary, evidenceRows, partSentryRows });
  const pricing_summary = buildPricingSummary({ listingSummary, listingType: 'vehicle' });

  // THE ONE PROJECTION. Sorting, primacy arbitration, url classification, identity gating and the
  // unpublishable count are all decided in `toListingMediaBlock` — this file decides none of them.
  const listing_media = toListingMediaBlock(imageRows);

  /**
   * The compatibility view. `type: 'image'` is a statement about the ROW'S SOURCE — it came from
   * `listing_images` rather than from some future video or document entry — and must never be read
   * as a claim that the asset at `url` is an image. Nothing validates the asset; `url_form` is the
   * only thing this contract asserts about the string, and it now travels here too.
   *
   * `not_loaded` cannot be expressed in an array, so it arrives here as `[]` — indistinguishable
   * from "no photos" to a consumer reading only this key. `listing_media.state` is the ONLY place
   * on this payload where "we did not look" can be stated, which is why the envelope is published
   * and why it, not this array, is the authority.
   */
  const media = listing_media.items.map((item) => ({
    media_id: item.media_id,
    url: item.url,
    url_form: item.url_form,
    position: item.position,
    is_primary: item.is_primary,
    type: 'image',
  }));

  return {
    ...listingSummary,
    listing_type: 'vehicle',
    // Public audience only ever sees public listings; admins see the true governed status.
    public_status: audience === 'admin' ? deriveListingPublicStatus(vehicle.status) : 'public',
    risk_status: trust_summary.risk_status,
    short_description: buildShortDescription(listingSummary),
    description: buildDescription(listingSummary),
    // THE AUTHORITY on this payload: state / items / unpublishable_count / empty_statement.
    listing_media,
    // Derived from it, never computed beside it. See the header note on why the key survives.
    media,
    seller_summary: buildSellerSummary(listingSummary),
    trust_summary,
    verification_summary,
    pricing_summary,
    safety_warnings: PUBLIC_SAFETY_WARNINGS,
    transaction_intent: buildTransactionIntent(trust_summary),
  };
}
