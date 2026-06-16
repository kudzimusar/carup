/**
 * Marketplace listing-detail assembler (GET /api/marketplace/listings/:id).
 *
 * Returns a fully sanitized MarketplaceListingDetail (summary + trust/verification/pricing summaries +
 * media + seller summary + safety warnings + SafePay-ready intent contract). Only PUBLIC, non-fixture,
 * eligible listings resolve — everything else 404s (NotFoundError). Never echoes owner_id/tenant_id or
 * any private trust/evidence/identity data.
 */

import {
  LISTING_SELECT_COLUMNS,
  buildMarketplaceListingSummary,
  fetchListingRelatedRows,
  filterVisibleVehicles,
} from './listingSummaryService.js';
import { buildTrustSummary, buildVerificationSummary } from './marketplaceTrustSummaryService.js';
import { buildPricingSummary } from './marketplacePricingService.js';
import { NotFoundError } from '../../utils/errors.js';

const PUBLIC_SAFETY_WARNINGS = [
  'Do not pay outside CarUp.',
  'Use the verified inquiry flow to contact the seller.',
  'An independent inspection is recommended before purchase.',
  'Public trust badges are evidence-based and backend-governed.',
  'Report any listing that asks you to transact off-platform.',
];

function buildSellerSummary(listingSummary) {
  return {
    display_label: listingSummary.seller_display_label,
    seller_type: listingSummary.seller_type,
    public_profile_enabled: Boolean(listingSummary.seller_public_profile_enabled),
    location: listingSummary.location || 'Zimbabwe',
    country: 'ZW',
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
  if (summary.mileage) parts.push(`Approx. ${Number(summary.mileage).toLocaleString()} km.`);
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

  // Admin may view any non-fixture listing (including suppressed); public sees only visible listings.
  const visible = filterVisibleVehicles([candidate], { showFixtures });
  if (!visible.length && audience !== 'admin') {
    throw new NotFoundError('Listing not found');
  }
  // For admin, still hide fixtures unless explicitly allowed.
  if (!visible.length && audience === 'admin' && filterVisibleVehicles([candidate], { showFixtures: true }).length === 0) {
    throw new NotFoundError('Listing not found');
  }
  const vehicle = candidate;

  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } =
    await fetchListingRelatedRows(supabaseClient, [vin]);

  const evidenceRows = evidenceByVin.get(vin) || [];
  const partSentryRows = partSentryByVin.get(vin) || [];
  const imageRows = imagesByVin.get(vin) || [];

  const listingSummary = buildMarketplaceListingSummary({
    vehicle,
    evidenceRows,
    partSentryRows,
    ownershipCount: (ownershipByVin.get(vin) || []).length,
    imageRows,
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
    public_status: 'public',
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
