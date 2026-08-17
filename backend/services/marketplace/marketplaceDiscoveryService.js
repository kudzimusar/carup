/**
 * Marketplace discovery helpers: compare, recommendations, categories.
 * All reuse the sanitized listing pipeline (no raw vehicles(*), fixtures hidden, public-status only).
 */

import { supabase } from '../../db/supabase.js';
import {
  CONDITION_CATEGORIES,
  MARKETPLACE_TAGS,
  LISTING_SELECT_COLUMNS,
  buildMarketplaceListingSummary,
  fetchCanonicalTrustByVin,
  fetchListingRelatedRows,
  filterVisibleVehicles,
} from './listingSummaryService.js';
import { getMarketplaceListingDetail } from './marketplaceListingDetailService.js';
import { buildPricingSummary } from './marketplacePricingService.js';
import { buildTrustSummary } from './marketplaceTrustSummaryService.js';
import { ValidationError } from '../../utils/errors.js';

const MAX_COMPARE = 4;
const RECOMMENDATION_LIMIT = 8;
const PRICE_BAND = 0.3;

/**
 * Compare up to 4 listings. Returns sanitized detail-lite objects (summary + trust + pricing) for
 * side-by-side display. Missing/non-public VINs are silently dropped.
 */
export async function compareListings(client, vins = []) {
  const unique = [...new Set((vins || []).map((v) => String(v || '').trim()).filter(Boolean))];
  if (!unique.length) throw new ValidationError('Provide at least one listing to compare.');
  if (unique.length > MAX_COMPARE) throw new ValidationError(`Compare is limited to ${MAX_COMPARE} listings.`);

  const results = await Promise.all(
    unique.map(async (vin) => {
      try {
        const detail = await getMarketplaceListingDetail(client, vin, { audience: 'public' });
        return {
          vin: detail.vin,
          make: detail.make,
          model: detail.model,
          year: detail.year,
          price: detail.price,
          currency: detail.currency,
          mileage: detail.mileage,
          condition_category: detail.condition_category,
          trust_score: detail.trust_score,
          marketplace_tags: detail.marketplace_tags,
          trust_summary: detail.trust_summary,
          verification_summary: detail.verification_summary,
          pricing_summary: detail.pricing_summary,
          primary_image_url: detail.primary_image_url,
        };
      } catch {
        return null;
      }
    })
  );
  const listings = results.filter(Boolean);
  return { listings, total: listings.length };
}

/**
 * Same-make, price-band recommendations for a given listing. Applies the same fixture/public-status
 * hiding as the public list and returns summaries (never raw rows).
 */
export async function getMarketplaceRecommendations(client, vin, { limit = RECOMMENDATION_LIMIT } = {}) {
  if (!vin) throw new ValidationError('vin is required for recommendations.');
  const { data: anchorRows, error: anchorErr } = await client
    .from('vehicles')
    .select(LISTING_SELECT_COLUMNS)
    .eq('vin', vin);
  if (anchorErr) throw anchorErr;
  const anchor = Array.isArray(anchorRows) ? anchorRows[0] : anchorRows;
  if (!anchor) return { listings: [], total: 0 };

  const price = Number(anchor.price) || 0;
  const { data: candidates, error } = await client.from('vehicles').select(LISTING_SELECT_COLUMNS).eq('make', anchor.make);
  if (error) throw error;

  const visible = filterVisibleVehicles(candidates).filter((v) => v.vin !== vin);
  const banded = price > 0
    ? visible.filter((v) => {
        const p = Number(v.price) || 0;
        return p >= price * (1 - PRICE_BAND) && p <= price * (1 + PRICE_BAND);
      })
    : visible;

  const vins = banded.map((v) => v.vin).filter(Boolean);
  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } = await fetchListingRelatedRows(client, vins);
  // This surface is public. Without the canonical entry every listing publishes a null score while
  // the marketplace list publishes a real one for the same VIN — the same-VIN split, one file over.
  const canonicalTrustByVin = await fetchCanonicalTrustByVin(client, vins);

  const listings = banded
    .map((vehicle) =>
      buildMarketplaceListingSummary({
        vehicle,
        evidenceRows: evidenceByVin.get(vehicle.vin) || [],
        partSentryRows: partSentryByVin.get(vehicle.vin) || [],
        ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
        imageRows: imagesByVin.get(vehicle.vin) || [],
        canonicalTrust: canonicalTrustByVin.get(vehicle.vin) || null,
      })
    )
    // An unscored vehicle is not a zero: it ranks after every scored one, in its original order.
    .sort((a, b) => {
      const as = Number.isFinite(a.trust_score) ? a.trust_score : null;
      const bs = Number.isFinite(b.trust_score) ? b.trust_score : null;
      if (as === null && bs === null) return 0;
      if (as === null) return 1;
      if (bs === null) return -1;
      return bs - as;
    })
    .slice(0, limit);

  return { listings, total: listings.length };
}

/** Static marketplace taxonomy for category tabs / filter chips. */
export function getMarketplaceCategories() {
  return {
    listing_types: [
      { slug: 'vehicle', label: 'Vehicles' },
      { slug: 'part', label: 'Parts' },
      { slug: 'service', label: 'Garages & Services' },
      { slug: 'dealer_stock', label: 'Dealers' },
      { slug: 'import_request', label: 'Import to Zimbabwe' },
      { slug: 'container_space', label: 'Container Space' },
    ],
    condition_categories: CONDITION_CATEGORIES.map((slug) => ({ slug, label: slug.replace(/_/g, ' ') })),
    trust_tags: MARKETPLACE_TAGS.map((slug) => ({ slug, label: slug.replace(/_/g, ' ') })),
  };
}

export { buildPricingSummary, buildTrustSummary };
