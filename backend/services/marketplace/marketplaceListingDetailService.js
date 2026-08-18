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
 */

import {
  LISTING_SELECT_COLUMNS,
  buildMarketplaceListingSummary,
  fetchCanonicalTrustByVin,
  fetchListingRelatedRows,
  filterVisibleVehicles,
  shouldShowFixtures,
} from './listingSummaryService.js';
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
  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } = related;

  const evidenceRows = evidenceByVin.get(vin) || [];
  const partSentryRows = partSentryByVin.get(vin) || [];
  const imageRows = imagesByVin.get(vin) || [];

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

  const media = [...imageRows]
    .sort((a, b) => {
      if (Boolean(a?.is_primary) !== Boolean(b?.is_primary)) return a?.is_primary ? -1 : 1;
      return (Number(a?.display_order) || 0) - (Number(b?.display_order) || 0);
    })
    .filter((row) => row?.image_url)
    .map((row) => ({ url: row.image_url, type: 'image', is_primary: Boolean(row.is_primary) }));

  return {
    ...listingSummary,
    listing_type: 'vehicle',
    // Public audience only ever sees public listings; admins see the true governed status.
    public_status: audience === 'admin' ? deriveListingPublicStatus(vehicle.status) : 'public',
    risk_status: trust_summary.risk_status,
    short_description: buildShortDescription(listingSummary),
    description: buildDescription(listingSummary),
    media,
    seller_summary: buildSellerSummary(listingSummary),
    trust_summary,
    verification_summary,
    pricing_summary,
    safety_warnings: PUBLIC_SAFETY_WARNINGS,
    transaction_intent: buildTransactionIntent(trust_summary),
  };
}
